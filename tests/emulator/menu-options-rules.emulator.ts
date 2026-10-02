/* ==========================================================================
 *  Firestore Security Rules — επιλογές προϊόντος (milestone 3)
 *
 *  Τρέχει ΜΟΝΟ μέσα στον Firestore Emulator:   npm run test:rules
 *  (δες SETUP.md). Δεν τρέχει με το `npm test`.
 *
 *  Ελέγχει το block shops/{shopId}/menuItems του ./firestore.rules:
 *    • κανένας browser (ιδιοκτήτης, άλλο κατάστημα, πελάτης, admin από
 *      browser) δεν δημιουργεί/αλλάζει/σβήνει το `optionGroups` —
 *      το γράφει μόνο ο server (Admin SDK, εδώ: withSecurityRulesDisabled)
 *    • ο ιδιοκτήτης ΣΥΝΕΧΙΖΕΙ να αλλάζει διαθεσιμότητα / βασικά πεδία και να
 *      σβήνει προϊόντα ΠΟΥ ΕΧΟΥΝ επιλογές
 *    • οι υπάρχοντες έλεγχοι (τιμή, shopId, ξένο κατάστημα) μένουν
 *    • ο κατάλογος με επιλογές διαβάζεται δημόσια
 *
 *  Milestone 4 (στο τέλος του αρχείου): το block shops/{shopId} — ωράριο
 *  (`openingHours`) και ζώνες ΤΚ (`deliveryZones`) μόνο από τον server,
 *  παύση (`active`) μόνο boolean, οι υπόλοιπες εγγραφές όπως πριν.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/* ------------------------- Φραγμός: ΠΟΤΕ παραγωγή ------------------------- */

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-buka";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;

if (!EMULATOR_HOST) {
  throw new Error(
    "Λείπει το FIRESTORE_EMULATOR_HOST. Τρέξε τα tests με `npm run test:rules` (firebase emulators:exec).",
  );
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error(`Τα tests κανόνων τρέχουν μόνο σε demo-* project, όχι σε «${PROJECT_ID}».`);
}

/* --------------------------------- Setup --------------------------------- */

let env: RulesTestEnvironment;

type ContextLike = { firestore(): unknown };
const modular = (context: ContextLike) => context.firestore() as Firestore;

const as = {
  ownerA: () => modular(env.authenticatedContext("owner-a")),
  ownerB: () => modular(env.authenticatedContext("owner-b")),
  customer: () => modular(env.authenticatedContext("cust-1", { firebase: { sign_in_provider: "password" } })),
  nobody: () => modular(env.unauthenticatedContext()),
  admin: () => modular(env.authenticatedContext("admin-1", { admin: true })),
};

const OPTION_GROUPS = [
  {
    id: "size",
    label: "Μέγεθος",
    kind: "single",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    choices: [
      { id: "s", label: "Μικρή", priceDelta: 0, available: true },
      { id: "l", label: "Μεγάλη", priceDelta: 1, available: true },
    ],
  },
];

/** Τα πεδία που γράφει ο browser σε απλό προϊόν (ίδια με το milestone 1/2) */
function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    shopId: "shop-a",
    categoryId: "pizzas",
    name: "Πίτσα",
    description: "Σάλτσα, μοτσαρέλα",
    price: 5,
    popular: false,
    available: true,
    ...overrides,
  };
}

async function seed(path: string, data: Record<string, unknown>) {
  /* = «server / Admin SDK»: παρακάμπτει τα Rules, όπως το /api/admin/menu-items */
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(modular(context), path), data);
  });
}

beforeAll(async () => {
  const [host, port] = EMULATOR_HOST.split(":");
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed("shops/shop-a", { name: "Pizza A", ownerUid: "owner-a" });
  await seed("shops/shop-b", { name: "Grill B", ownerUid: "owner-b" });
  await seed("shops/shop-a/menuItems/with-options", baseItem({ optionGroups: OPTION_GROUPS }));
  await seed("shops/shop-a/menuItems/plain", baseItem({ name: "Cola", price: 2 }));
});

const item = (db: Firestore, id: string, shop = "shop-a") => doc(db, `shops/${shop}/menuItems/${id}`);

/* ============================== Ανάγνωση ============================== */

describe("ανάγνωση καταλόγου με επιλογές", () => {
  it("δημόσια, ακόμη και χωρίς σύνδεση", async () => {
    await assertSucceeds(getDoc(item(as.nobody(), "with-options")));
    await assertSucceeds(getDoc(item(as.customer(), "with-options")));
  });
});

/* =========== Μη εξουσιοδοτημένες εγγραφές ρύθμισης επιλογών =========== */

describe("ο browser ΔΕΝ γράφει ποτέ optionGroups", () => {
  it("ιδιοκτήτης: νέο προϊόν με optionGroups → άρνηση (χωρίς → επιτρέπεται, όπως πριν)", async () => {
    await assertFails(
      setDoc(item(as.ownerA(), "new-1"), { ...baseItem({ optionGroups: OPTION_GROUPS }), createdAt: serverTimestamp() }),
    );
    await assertSucceeds(setDoc(item(as.ownerA(), "new-2"), { ...baseItem(), createdAt: serverTimestamp() }));
  });

  it("ιδιοκτήτης: προσθήκη optionGroups σε απλό προϊόν → άρνηση", async () => {
    await assertFails(updateDoc(item(as.ownerA(), "plain"), { optionGroups: OPTION_GROUPS }));
  });

  it("ιδιοκτήτης: αλλαγή τιμής επιλογής (π.χ. σε αρνητική) → άρνηση", async () => {
    const tampered = [{ ...OPTION_GROUPS[0], choices: [{ id: "s", label: "Μικρή", priceDelta: -5, available: true }] }];
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { optionGroups: tampered }));
  });

  it("ιδιοκτήτης: κακόμορφο optionGroups (string) → άρνηση", async () => {
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { optionGroups: "δωρεάν" }));
  });

  it("ιδιοκτήτης: σβήσιμο optionGroups από τον browser → άρνηση (μόνο ο server)", async () => {
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { optionGroups: deleteField() }));
  });

  it("ολόκληρη αντικατάσταση (setDoc) με άλλες επιλογές → άρνηση", async () => {
    await assertFails(
      setDoc(item(as.ownerA(), "with-options"), baseItem({ optionGroups: [{ ...OPTION_GROUPS[0], label: "Άλλο" }] })),
    );
  });

  it("admin από τον browser → επίσης άρνηση για optionGroups", async () => {
    await assertFails(updateDoc(item(as.admin(), "plain"), { optionGroups: OPTION_GROUPS }));
  });

  it("ιδιοκτήτης ΑΛΛΟΥ καταστήματος, πελάτης, μη συνδεδεμένος → άρνηση", async () => {
    for (const db of [as.ownerB(), as.customer(), as.nobody()]) {
      await assertFails(updateDoc(item(db, "plain"), { optionGroups: OPTION_GROUPS }));
      await assertFails(updateDoc(item(db, "with-options"), { available: false, updatedAt: serverTimestamp() }));
      await assertFails(setDoc(item(db, "x"), baseItem({ optionGroups: OPTION_GROUPS })));
    }
  });
});

/* ================= Ό,τι κάνει ήδη το admin panel ΣΥΝΕΧΙΖΕΙ ================ */

describe("άμεσες εγγραφές του ιδιοκτήτη σε προϊόν με επιλογές", () => {
  it("εναλλαγή διαθεσιμότητας (useMenuManager.toggleAvailability) → επιτρέπεται", async () => {
    await assertSucceeds(
      updateDoc(item(as.ownerA(), "with-options"), { available: false, updatedAt: serverTimestamp() }),
    );
  });

  it("αλλαγή βασικών πεδίων χωρίς να αγγιχτούν οι επιλογές → επιτρέπεται", async () => {
    await assertSucceeds(updateDoc(item(as.ownerA(), "with-options"), { name: "Πίτσα σεφ", price: 6.5 }));
  });

  it("οι υπάρχοντες έλεγχοι ισχύουν και εδώ: αρνητική τιμή, μετακόμιση shopId → άρνηση", async () => {
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { price: -1 }));
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { shopId: "shop-b" }));
  });

  it("διαγραφή προϊόντος με επιλογές → επιτρέπεται στον ιδιοκτήτη, όχι σε άλλον", async () => {
    await assertFails(deleteDoc(item(as.ownerB(), "with-options")));
    await assertSucceeds(deleteDoc(item(as.ownerA(), "with-options")));
  });

  it("πρώην ιδιοκτήτης μετά από μεταβίβαση → άρνηση", async () => {
    await seed("shops/shop-a", { name: "Pizza A", ownerUid: "new-owner" });
    await assertFails(updateDoc(item(as.ownerA(), "with-options"), { available: false }));
  });
});

/* ==========================================================================
 *  Milestone 4 — shops/{shopId}: ωράριο, ζώνες ΤΚ και παύση
 *
 *  (Στο ΙΔΙΟ αρχείο με τους κανόνες καταλόγου, ώστε η υπάρχουσα ρύθμιση του
 *  `npm run test:rules` να τα τρέχει χωρίς καμία αλλαγή.)
 *
 *    • κανένας browser (ιδιοκτήτης, άλλος ιδιοκτήτης, πελάτης, admin από
 *      browser) δεν δημιουργεί/αλλάζει/σβήνει `openingHours`/`deliveryZones`
 *      — τα γράφει μόνο ο server (Admin SDK, εδώ: withSecurityRulesDisabled)
 *    • ο ιδιοκτήτης ΣΥΝΕΧΙΖΕΙ να βάζει/βγάζει παύση (`active`, μόνο boolean)
 *      και να αλλάζει όσα άλλαζε πριν, σε καταστήματα που ΗΔΗ έχουν ρυθμίσεις
 *    • οι υπάρχοντες περιορισμοί (ownerUid, minOrder, deliveryFee…) μένουν
 * ========================================================================== */

const M4_HOURS = {
  enabled: true,
  weekly: {
    mon: [{ open: "12:00", close: "23:00" }],
    tue: [],
    wed: [],
    thu: [],
    fri: [{ open: "18:00", close: "02:00" }],
    sat: [],
    sun: [],
  },
  exceptions: [],
};

const M4_ZONES = {
  enabled: true,
  zones: [
    {
      id: "zcenter",
      name: "Κέντρο",
      available: true,
      postalCodes: ["54622"],
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: null,
    },
  ],
};

describe("milestone 4: ωράριο/ζώνες ΜΟΝΟ από τον server", () => {
  beforeEach(async () => {
    await seed("shops/shop-m4", {
      name: "Pizza M4",
      ownerUid: "owner-a",
      active: true,
      minOrder: 8,
      deliveryFee: 1.5,
      freeDeliveryOver: 20,
      openingHours: M4_HOURS,
      deliveryZones: M4_ZONES,
    });
    await seed("shops/shop-m4b", { name: "Grill M4", ownerUid: "owner-b", active: false });
  });

  const shopDoc = (db: Firestore, id = "shop-m4") => doc(db, `shops/${id}`);

  it("ο ιδιοκτήτης ΔΕΝ αλλάζει ωράριο ή ζώνες από τον browser", async () => {
    await assertFails(updateDoc(shopDoc(as.ownerA()), { openingHours: { ...M4_HOURS, enabled: false } }));
    await assertFails(
      updateDoc(shopDoc(as.ownerA()), {
        deliveryZones: { ...M4_ZONES, zones: [{ ...M4_ZONES.zones[0], deliveryFeeCents: 0 }] },
      }),
    );
  });

  it("ο ιδιοκτήτης ΔΕΝ σβήνει ωράριο/ζώνες (deleteField)", async () => {
    await assertFails(updateDoc(shopDoc(as.ownerA()), { openingHours: deleteField() }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { deliveryZones: deleteField() }));
  });

  it("ο ιδιοκτήτης ΔΕΝ προσθέτει ωράριο σε κατάστημα που δεν έχει", async () => {
    await assertFails(updateDoc(shopDoc(as.ownerB(), "shop-m4b"), { openingHours: M4_HOURS }));
  });

  it("ούτε admin από τον browser (μόνο μέσω server)", async () => {
    await assertFails(updateDoc(shopDoc(as.admin()), { deliveryZones: M4_ZONES }));
    await assertFails(
      setDoc(doc(as.admin(), "shops/shop-m4-new"), { name: "Νέο", ownerUid: "x", openingHours: M4_HOURS }),
    );
  });

  it("άλλος ιδιοκτήτης / πελάτης / ανώνυμος: καμία εγγραφή", async () => {
    await assertFails(updateDoc(shopDoc(as.ownerB()), { openingHours: M4_HOURS }));
    await assertFails(updateDoc(shopDoc(as.customer()), { deliveryZones: M4_ZONES }));
    await assertFails(updateDoc(shopDoc(as.nobody()), { active: false }));
  });

  it("ο ιδιοκτήτης βάζει και βγάζει παύση (boolean) σε κατάστημα ΜΕ ωράριο/ζώνες", async () => {
    await assertSucceeds(updateDoc(shopDoc(as.ownerA()), { active: false, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(shopDoc(as.ownerA()), { active: true, updatedAt: serverTimestamp() }));
  });

  it("η παύση είναι ΜΟΝΟ boolean", async () => {
    await assertFails(updateDoc(shopDoc(as.ownerA()), { active: "false" }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { active: 0 }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { active: deleteField() }));
  });

  it("ο ιδιοκτήτης αλλάζει ακόμη όνομα/διεύθυνση· οι παλιοί περιορισμοί μένουν", async () => {
    await assertSucceeds(updateDoc(shopDoc(as.ownerA()), { name: "Pizza M4+", address: "Ερμού 1" }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { deliveryFee: 0 }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { minOrder: 0 }));
    await assertFails(updateDoc(shopDoc(as.ownerA()), { ownerUid: "owner-b" }));
    await assertFails(updateDoc(shopDoc(as.ownerB()), { active: false }));
  });

  it("admin από browser αλλάζει άλλα πεδία και δημιουργεί καταστήματα (όπως πριν)", async () => {
    await assertSucceeds(updateDoc(shopDoc(as.admin()), { rating: 4.9 }));
    await assertSucceeds(setDoc(doc(as.admin(), "shops/shop-m4-new"), { name: "Νέο", ownerUid: "x" }));
  });

  it("δημόσια ανάγνωση καταστήματος με ωράριο/ζώνες (βιτρίνα, checkout)", async () => {
    await assertSucceeds(getDoc(shopDoc(as.nobody())));
  });
});
