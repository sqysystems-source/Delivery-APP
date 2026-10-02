/* ==========================================================================
 *  Firestore Security Rules — παραγγελίες (milestone 2)
 *
 *  Τρέχει ΜΟΝΟ μέσα στον Firestore Emulator:   npm run test:rules
 *  (δες SETUP.md). Δεν τρέχει με το `npm test`.
 *
 *  Φορτώνει το ./firestore.rules του repo στον emulator και ελέγχει:
 *    • πελάτης (εγγεγραμμένος / ανώνυμος) διαβάζει ΜΟΝΟ τη δική του παραγγελία
 *    • άλλος πελάτης, μη συνδεδεμένος, άλλο κατάστημα, πρώην ιδιοκτήτης → όχι
 *    • λίστα «Οι παραγγελίες μου» μόνο με userId == uid και limit ≤ 50
 *    • ο πελάτης δεν γράφει ποτέ (status, create, delete, checkoutRequests)
 *    • ο καταστηματάρχης κάνει ΜΟΝΟ τις μεταβάσεις του ταμπλό
 *    • ζωντανή ενημέρωση: αλλαγή από το ταμπλό → φαίνεται στον listener του πελάτη
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
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

const SHOP_A = "shop-a";
const SHOP_B = "shop-b";

function order(overrides: Record<string, unknown> = {}) {
  return {
    shopId: SHOP_A,
    shopName: "Pizza A",
    ownerUid: "owner-a",
    userId: "cust-1",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
    address: "Ερμού 5, Τρίκαλα",
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "p1", name: "Margherita", unitPrice: 8.5, quantity: 1, lineTotal: 8.5 }],
    subtotal: 8.5,
    deliveryFee: 1.5,
    total: 10,
    totalCents: 1000,
    status: "pending",
    schemaVersion: 2,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

/* Το v3 επιστρέφει compat instance· οι modular συναρτήσεις το δέχονται
 * (getModularInstance), αλλά οι τύποι όχι — εξ ου το cast. */
type ContextLike = { firestore(): unknown };
const modular = (context: ContextLike) => context.firestore() as Firestore;

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(modular(context), path), data);
  });
}

const as = {
  registered: () => modular(env.authenticatedContext("cust-1", { firebase: { sign_in_provider: "password" } })),
  anonymous: () => modular(env.authenticatedContext("anon-1", { firebase: { sign_in_provider: "anonymous" } })),
  otherCustomer: () => modular(env.authenticatedContext("cust-2", { firebase: { sign_in_provider: "password" } })),
  nobody: () => modular(env.unauthenticatedContext()),
  ownerA: () => modular(env.authenticatedContext("owner-a")),
  ownerB: () => modular(env.authenticatedContext("owner-b")),
  formerOwnerA: () => modular(env.authenticatedContext("owner-old")),
  admin: () => modular(env.authenticatedContext("admin-1", { admin: true })),
};

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
  await seed(`shops/${SHOP_A}`, { name: "Pizza A", ownerUid: "owner-a" });
  await seed(`shops/${SHOP_B}`, { name: "Grill B", ownerUid: "owner-b" });
  await seed("orders/order-reg", order());
  await seed("orders/order-anon", order({ userId: "anon-1" }));
  // Γράφτηκε όταν το κατάστημα ανήκε σε άλλον — το ownerUid είναι παλιό
  await seed("orders/order-old-owner", order({ ownerUid: "owner-old" }));
  await seed("orders/order-b", order({ shopId: SHOP_B, shopName: "Grill B", ownerUid: "owner-b" }));
  await seed("checkoutRequests/req-1", { uid: "cust-1", orderId: "order-reg", requestHash: "x" });
});

/* ================================ Ανάγνωση ================================ */

describe("ανάγνωση μίας παραγγελίας", () => {
  it("εγγεγραμμένος πελάτης διαβάζει τη δική του", async () => {
    await assertSucceeds(getDoc(doc(as.registered(), "orders/order-reg")));
  });

  it("ανώνυμος πελάτης διαβάζει τη δική του", async () => {
    await assertSucceeds(getDoc(doc(as.anonymous(), "orders/order-anon")));
  });

  it("ανώνυμος ΔΕΝ διαβάζει παραγγελία εγγεγραμμένου (και αντίστροφα)", async () => {
    await assertFails(getDoc(doc(as.anonymous(), "orders/order-reg")));
    await assertFails(getDoc(doc(as.registered(), "orders/order-anon")));
  });

  it("άλλος πελάτης → άρνηση", async () => {
    await assertFails(getDoc(doc(as.otherCustomer(), "orders/order-reg")));
  });

  it("μη συνδεδεμένος → άρνηση", async () => {
    await assertFails(getDoc(doc(as.nobody(), "orders/order-reg")));
  });

  it("ανύπαρκτη παραγγελία → άρνηση (δεν αποκαλύπτεται αν υπάρχει)", async () => {
    await assertFails(getDoc(doc(as.registered(), "orders/does-not-exist")));
  });

  it("καταστηματάρχης ΑΛΛΟΥ καταστήματος → άρνηση", async () => {
    await assertFails(getDoc(doc(as.ownerB(), "orders/order-reg")));
  });

  it("πρώην ιδιοκτήτης (παλιό ownerUid στην παραγγελία) → άρνηση", async () => {
    await assertFails(getDoc(doc(as.formerOwnerA(), "orders/order-old-owner")));
  });

  it("τρέχων ιδιοκτήτης καταστήματος διαβάζει — και παραγγελίες με παλιό ownerUid", async () => {
    await assertSucceeds(getDoc(doc(as.ownerA(), "orders/order-reg")));
    await assertSucceeds(getDoc(doc(as.ownerA(), "orders/order-old-owner")));
  });
});

describe("λίστες", () => {
  const mine = (db: Firestore, uid: string, max?: number) =>
    getDocs(
      query(
        collection(db, "orders"),
        where("userId", "==", uid),
        orderBy("createdAt", "desc"),
        ...(max === undefined ? [] : [limit(max)]),
      ),
    );

  it("«Οι παραγγελίες μου»: ο πελάτης βλέπει μόνο τις δικές του", async () => {
    const snapshot = await assertSucceeds(mine(as.registered(), "cust-1", 11));
    expect(snapshot.docs.map((document) => document.data().userId)).toEqual(
      expect.arrayContaining(["cust-1"]),
    );
    expect(snapshot.docs.every((document) => document.data().userId === "cust-1")).toBe(true);
  });

  it("ανώνυμος βλέπει μόνο τις δικές του", async () => {
    await assertSucceeds(mine(as.anonymous(), "anon-1", 10));
  });

  it("limit > 50 ή χωρίς limit → άρνηση", async () => {
    await assertFails(mine(as.registered(), "cust-1", 51));
    await assertFails(mine(as.registered(), "cust-1"));
  });

  it("λίστα με userId άλλου → άρνηση", async () => {
    await assertFails(mine(as.otherCustomer(), "cust-1", 10));
  });

  it("λίστα χωρίς φίλτρο → άρνηση για πελάτη και μη συνδεδεμένο", async () => {
    await assertFails(getDocs(query(collection(as.registered(), "orders"), limit(10))));
    await assertFails(getDocs(query(collection(as.nobody(), "orders"), limit(10))));
  });

  it("ταμπλό: ο ιδιοκτήτης βλέπει τη ροή του καταστήματός του", async () => {
    const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const dashboard = (db: Firestore, shopId: string) =>
      getDocs(
        query(
          collection(db, "orders"),
          where("shopId", "==", shopId),
          where("createdAt", ">", since),
          orderBy("createdAt", "desc"),
          limit(200),
        ),
      );
    await assertSucceeds(dashboard(as.ownerA(), SHOP_A));
    await assertFails(dashboard(as.ownerB(), SHOP_A));
    await assertFails(dashboard(as.registered(), SHOP_A));
  });
});

/* ============================ Εγγραφές πελάτη ============================ */

describe("ο πελάτης δεν γράφει ποτέ", () => {
  it("δεν αλλάζει status της δικής του παραγγελίας", async () => {
    await assertFails(
      updateDoc(doc(as.registered(), "orders/order-reg"), {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as.anonymous(), "orders/order-anon"), {
        status: "completed",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("δεν δημιουργεί ούτε σβήνει παραγγελία", async () => {
    await assertFails(setDoc(doc(as.registered(), "orders/new-one"), order()));
    await assertFails(deleteDoc(doc(as.registered(), "orders/order-reg")));
  });

  it("δεν διαβάζει/γράφει checkoutRequests", async () => {
    await assertFails(getDoc(doc(as.registered(), "checkoutRequests/req-1")));
    await assertFails(
      setDoc(doc(as.registered(), "checkoutRequests/req-2"), { uid: "cust-1", state: "closed" }),
    );
    await assertFails(getDocs(query(collection(as.registered(), "checkoutRequests"), limit(1))));
  });
});

/* ========================= Εγγραφές καταστήματος ========================= */

describe("αλλαγές κατάστασης από το ταμπλό", () => {
  const advance = (db: Firestore, id: string, data: Record<string, unknown>) =>
    updateDoc(doc(db, `orders/${id}`), { updatedAt: serverTimestamp(), ...data });

  it("όλη η πορεία του ταμπλό επιτρέπεται: pending→accepted→preparing→delivering→completed", async () => {
    for (const status of ["accepted", "preparing", "delivering", "completed"]) {
      await assertSucceeds(advance(as.ownerA(), "order-reg", { status }));
    }
  });

  it("παράλειψη βήματος ή επιστροφή → άρνηση", async () => {
    await assertFails(advance(as.ownerA(), "order-reg", { status: "completed" }));
    await assertFails(advance(as.ownerA(), "order-reg", { status: "preparing" }));
    await assertSucceeds(advance(as.ownerA(), "order-reg", { status: "accepted" }));
    await assertFails(advance(as.ownerA(), "order-reg", { status: "pending" }));
  });

  it("τελικές καταστάσεις δεν αλλάζουν", async () => {
    await seed("orders/done", order({ status: "completed" }));
    await seed("orders/gone", order({ status: "cancelled" }));
    await assertFails(advance(as.ownerA(), "done", { status: "cancelled", cancelReason: "cancelled_by_shop" }));
    await assertFails(advance(as.ownerA(), "gone", { status: "accepted" }));
  });

  it("απόρριψη εκκρεμούς με rejected_by_shop· ακύρωση αποδεκτής με cancelled_by_shop", async () => {
    await assertSucceeds(
      advance(as.ownerA(), "order-reg", { status: "cancelled", cancelReason: "rejected_by_shop" }),
    );
    await seed("orders/acc", order({ status: "accepted" }));
    await assertFails(
      advance(as.ownerA(), "acc", { status: "cancelled", cancelReason: "rejected_by_shop" }),
    );
    await assertSucceeds(
      advance(as.ownerA(), "acc", { status: "cancelled", cancelReason: "cancelled_by_shop" }),
    );
  });

  it("ακύρωση χωρίς λόγο (παλιό ταμπλό) επιτρέπεται· λόγος χωρίς ακύρωση όχι", async () => {
    await assertFails(
      advance(as.ownerA(), "order-reg", { status: "accepted", cancelReason: "rejected_by_shop" }),
    );
    await assertSucceeds(advance(as.ownerA(), "order-reg", { status: "cancelled" }));
  });

  it("οικονομικά/προσωπικά πεδία και αυθαίρετο updatedAt → άρνηση", async () => {
    await assertFails(advance(as.ownerA(), "order-reg", { status: "accepted", total: 0.01 }));
    await assertFails(advance(as.ownerA(), "order-reg", { status: "accepted", userId: "owner-a" }));
    await assertFails(
      updateDoc(doc(as.ownerA(), "orders/order-reg"), {
        status: "accepted",
        updatedAt: Timestamp.fromMillis(0),
      }),
    );
    await assertFails(advance(as.ownerA(), "order-reg", { status: "accepted", etaMinutes: [5, 10] }));
  });

  it("άλλο κατάστημα / πρώην ιδιοκτήτης → άρνηση", async () => {
    await assertFails(advance(as.ownerB(), "order-reg", { status: "accepted" }));
    await assertFails(advance(as.formerOwnerA(), "order-old-owner", { status: "accepted" }));
  });

  it("admin παραμένει απεριόριστος (όπως πριν)", async () => {
    await assertSucceeds(advance(as.admin(), "order-reg", { status: "completed" }));
  });
});

/* ========================== Ζωντανή ενημέρωση =========================== */

describe("παρακολούθηση: ο listener του πελάτη βλέπει τις αλλαγές του ταμπλό", () => {
  it("αρχικά pending, μετά accepted από το κατάστημα", async () => {
    const customerDb = as.registered();
    const seen: string[] = [];

    const unsubscribe = onSnapshot(doc(customerDb, "orders/order-reg"), (snapshot) => {
      const status = snapshot.data()?.status;
      if (typeof status === "string" && seen[seen.length - 1] !== status) seen.push(status);
    });

    try {
      await expect.poll(() => seen[0], { timeout: 10_000 }).toBe("pending");
      await assertSucceeds(
        updateDoc(doc(as.ownerA(), "orders/order-reg"), {
          status: "accepted",
          updatedAt: serverTimestamp(),
        }),
      );
      await expect.poll(() => seen.includes("accepted"), { timeout: 10_000 }).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("listener άλλου πελάτη απορρίπτεται", async () => {
    const error = await new Promise<{ code?: string }>((resolveError) => {
      const unsubscribe = onSnapshot(
        doc(as.otherCustomer(), "orders/order-reg"),
        () => undefined,
        (caught) => {
          unsubscribe();
          resolveError(caught);
        },
      );
    });
    expect(error.code).toBe("permission-denied");
  });
});
