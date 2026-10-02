/* ==========================================================================
 *  POST /api/orders — ωράριο και ζώνες ΤΚ (milestone 4).
 *
 *  ΨΕΥΤΙΚΑ: το store (FakeCheckoutDb, in-memory, με σειριοποιήσιμες
 *  συναλλαγές) και το ρολόι (deps.now). Αποδεικνύει τη ΛΟΓΙΚΗ του service·
 *  τη συμπεριφορά του πραγματικού Firestore την ελέγχουν τα emulator tests.
 *
 *  Ρολόι: 2026-10-05 = Δευτέρα. Οι στιγμές δηλώνονται σε ώρα Αθήνας.
 * ========================================================================== */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalRequestHash,
  handleAttemptRecovery,
  handleCheckoutRequest,
  type CheckoutDeps,
  type CheckoutTransaction,
} from "@/lib/server/checkout-service";
import type { CheckoutErrorBody, CheckoutSuccess } from "@/types";
import { stableStringify } from "@/lib/checkout/idempotency";
import { validateCheckoutRequest } from "@/lib/checkout/validation";
import { emptyWeekly } from "@/lib/shop/opening-hours";
import { instantsForWallTime } from "@/lib/shop/timezone";
import { FakeCheckoutDb, SERVER_TIMESTAMP } from "./fake-checkout-store";

/* ------------------------------ Δεδομένα -------------------------------- */

function athens(date: string, time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return instantsForWallTime(date, hours * 60 + minutes)[0];
}

const MON = "2026-10-05";

const HOURS = {
  enabled: true,
  weekly: { ...emptyWeekly(), mon: [{ open: "12:00", close: "23:00" }], fri: [{ open: "18:00", close: "02:00" }] },
  exceptions: [],
};

const ZONES = {
  enabled: true,
  zones: [
    {
      id: "zcenter",
      name: "Κέντρο",
      available: true,
      postalCodes: ["54622", "54623"],
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: 2000,
    },
    {
      id: "zeast",
      name: "Ανατολικά",
      available: true,
      postalCodes: ["55131", "01234"],
      deliveryFeeCents: 300,
      minOrderCents: 1500,
      freeDeliveryOverCents: null,
    },
    {
      id: "zoff",
      name: "Καλαμαριά",
      available: false,
      postalCodes: ["55132"],
      deliveryFeeCents: 250,
      minOrderCents: 1000,
      freeDeliveryOverCents: null,
    },
  ],
};

let db: FakeCheckoutDb;
let deps: CheckoutDeps;
let keyCounter = 0;

const newKey = () => `m4-key-${String(++keyCounter).padStart(4, "0")}-abcdefghij`;

function shopDoc(overrides: Record<string, unknown> = {}) {
  return {
    name: "Pizza Roma",
    ownerUid: "owner-1",
    minOrder: 8,
    deliveryFee: 1.5,
    freeDeliveryOver: 20,
    openingHours: HOURS,
    deliveryZones: ZONES,
    ...overrides,
  };
}

type Body = Record<string, unknown>;

function body(overrides: Body = {}, delivery: Body = {}): Body {
  return {
    idempotencyKey: newKey(),
    shopId: "zoned",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "6912345678" },
    delivery: { street: "Ερμού 5", city: "Θεσσαλονίκη", postalCode: "546 22", ...delivery },
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "margherita", quantity: 1 }],
    expectedTotalCents: 1000, // 8,50 + 1,50 (ζώνη Κέντρο)
    expectedDeliveryZoneId: "zcenter",
    ...overrides,
  };
}

function call(payload: Body, token = "uid-guest") {
  return handleCheckoutRequest(deps, { authorization: `Bearer ${token}`, rawBody: JSON.stringify(payload) });
}

const ok = (result: { body: unknown }) => result.body as CheckoutSuccess;
const err = (result: { body: unknown }) => result.body as CheckoutErrorBody;

beforeEach(() => {
  db = new FakeCheckoutDb();
  db.nowMs = athens(MON, "13:00");
  db.setShop("zoned", shopDoc());
  db.setItem("zoned", "margherita", { name: "Margherita", price: 8.5 });
  db.setItem("zoned", "cheap", { name: "Νερό", price: 0.5 });
  db.setItem("zoned", "pizza", {
    name: "Πίτσα",
    price: 6,
    optionGroups: [
      {
        id: "size",
        label: "Μέγεθος",
        kind: "single",
        required: true,
        minSelect: 1,
        maxSelect: 1,
        choices: [
          { id: "s", label: "Μικρή", priceDelta: 0, available: true },
          { id: "l", label: "Μεγάλη", priceDelta: 2, available: true },
        ],
      },
    ],
  });
  deps = {
    store: db.store(),
    verifyIdToken: async (token) => {
      if (token.startsWith("uid-")) return { uid: token.slice(4) };
      throw new Error("bad token");
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    timestampFromMillis: (ms) => ({ ms }),
    now: () => db.nowMs,
    logger: { error: vi.fn(), warn: vi.fn() },
  };
});

/* ==========================================================================
 *  Ωράριο — ώρα SERVER
 * ========================================================================== */

describe("ωράριο στον server", () => {
  it("ανοιχτό: δημιουργεί παραγγελία και κρατά τη στιγμή της κρίσης", async () => {
    const result = await call(body());
    expect(result.status).toBe(201);
    const [, order] = db.orders[0];
    expect(order.eligibilityCheckedAt).toEqual({ ms: athens(MON, "13:00") });
  });

  it.each([
    ["11:59", 409],
    ["12:00", 201],
    ["22:59", 201],
    ["23:00", 409],
  ])("όριο Δευτέρας %s → %i", async (time, status) => {
    db.nowMs = athens(MON, time);
    const result = await call(body());
    expect(result.status).toBe(status);
    if (status === 409) {
      expect(err(result)).toMatchObject({ code: "shop_closed", availability: { state: "closed" } });
      expect(db.orders).toHaveLength(0);
    }
  });

  it("κλειστό: μήνυμα με την επόμενη ώρα ανοίγματος (ώρα Αθήνας)", async () => {
    db.nowMs = athens(MON, "23:30");
    const result = await call(body());
    expect(err(result).message).toContain("την Παρασκευή στις 18:00");
    expect(err(result).availability?.nextOpenAt).toBe(new Date(athens("2026-10-09", "18:00")).toISOString());
  });

  it("βραδινή βάρδια: Σάββατο 01:30 δεκτό, 02:00 όχι", async () => {
    db.nowMs = athens("2026-10-10", "01:30");
    expect((await call(body())).status).toBe(201);
    db.nowMs = athens("2026-10-10", "02:00");
    expect((await call(body())).status).toBe(409);
  });

  it("χειροκίνητη παύση υπερισχύει του ωραρίου", async () => {
    db.setShop("zoned", shopDoc({ active: false }));
    const result = await call(body());
    expect(result.status).toBe(409);
    expect(err(result)).toMatchObject({ code: "shop_closed", availability: { state: "paused", nextOpenAt: null } });
    expect(db.orders).toHaveLength(0);
  });

  it("κακόμορφο ωράριο → ελεγχόμενη μη διαθεσιμότητα, ποτέ παραγγελία", async () => {
    db.setShop("zoned", shopDoc({ openingHours: { enabled: true, weekly: { mon: "όλη μέρα" }, exceptions: [] } }));
    const result = await call(body());
    expect(result.status).toBe(409);
    expect(err(result)).toMatchObject({ code: "shop_config_invalid", availability: { state: "unavailable" } });
    expect(deps.logger?.error).toHaveBeenCalled();
    expect(db.orders).toHaveLength(0);
  });

  it("κακόμορφο `active` (κείμενο \"false\") → μη διαθέσιμο, όχι ανοιχτό", async () => {
    db.setShop("zoned", shopDoc({ active: "false" }));
    expect(err(await call(body())).code).toBe("shop_config_invalid");
    expect(db.orders).toHaveLength(0);
  });

  it("παλιό κατάστημα χωρίς ωράριο/ζώνες: όπως πριν (ΤΚ προαιρετικός, γενικοί όροι)", async () => {
    db.setShop("legacy", { name: "Παλιό", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 });
    db.setItem("legacy", "margherita", { name: "Margherita", price: 8.5 });
    db.nowMs = athens(MON, "04:00");
    const noPostal = body({ shopId: "legacy", expectedDeliveryZoneId: undefined }, { postalCode: undefined });
    const result = await call(noPostal);
    expect(result.status).toBe(201);
    expect(ok(result).delivery).toEqual({
      mode: "shop_default",
      postalCode: null,
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: 2000,
    });
  });

  it("ωράριο ανενεργό → ανοιχτό όπως πριν", async () => {
    db.setShop("zoned", shopDoc({ openingHours: { ...HOURS, enabled: false } }));
    db.nowMs = athens(MON, "04:00");
    expect((await call(body())).status).toBe(201);
  });

  it("η ώρα ξαναδιαβάζεται σε ΚΑΘΕ προσπάθεια της συναλλαγής", async () => {
    db.nowMs = athens(MON, "22:59");
    const store = db.store();
    let attempts = 0;
    deps.store = {
      ...store,
      runTransaction: (fn) =>
        store.runTransaction(async (tx: CheckoutTransaction) => {
          attempts += 1;
          const result = await fn(tx);
          if (attempts === 1) {
            // Σύγκρουση: κάποιος άγγιξε το κατάστημα και το ρολόι πέρασε τις 23:00
            db.setShop("zoned", shopDoc({ name: "Pizza Roma" }));
            db.nowMs = athens(MON, "23:00");
          }
          return result;
        }),
    };
    const result = await call(body());
    expect(attempts).toBe(2);
    expect(result.status).toBe(409);
    expect(err(result).code).toBe("shop_closed");
    expect(db.orders).toHaveLength(0);
  });
});

/* ==========================================================================
 *  Ζώνες ΤΚ
 * ========================================================================== */

describe("ζώνες ΤΚ στον server", () => {
  it("εφαρμόζει μεταφορικά/όρια της ζώνης και αποθηκεύει αμετάβλητο στιγμιότυπο", async () => {
    const result = await call(body());
    expect(result.status).toBe(201);
    expect(ok(result)).toMatchObject({
      deliveryFeeCents: 150,
      totalCents: 1000,
      shopTerms: { minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 },
      delivery: { mode: "zone", zoneId: "zcenter", zoneName: "Κέντρο", postalCode: "54622" },
    });
    const [, order] = db.orders[0];
    expect(order.delivery).toMatchObject({ postalCode: "54622" });
    expect(order.deliveryTerms).toEqual({
      mode: "zone",
      zoneId: "zcenter",
      zoneName: "Κέντρο",
      postalCode: "54622",
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: 2000,
    });
  });

  it("κρατά τα αρχικά μηδενικά του ΤΚ", async () => {
    const result = await call(
      body(
        { lines: [{ itemId: "margherita", quantity: 2 }], expectedTotalCents: 2000, expectedDeliveryZoneId: "zeast" },
        { postalCode: "012 34" },
      ),
    );
    expect(result.status).toBe(201);
    expect(ok(result).delivery).toMatchObject({ zoneId: "zeast", postalCode: "01234" });
  });

  it("λείπει ο ΤΚ → postal_code_required, καμία παραγγελία", async () => {
    const result = await call(body({ expectedDeliveryZoneId: undefined }, { postalCode: undefined }));
    expect(result.status).toBe(400);
    expect(err(result)).toMatchObject({ code: "postal_code_required" });
    expect(err(result).fieldErrors?.postalCode).toBeTruthy();
    expect(db.orders).toHaveLength(0);
  });

  it("κακόμορφος ΤΚ → validation_failed στο πεδίο", async () => {
    for (const postalCode of ["5462", "546222", "54Α22", "546-22"]) {
      const result = await call(body({}, { postalCode }));
      expect(result.status).toBe(400);
      expect(err(result).fieldErrors?.postalCode).toContain("5 ψηφία");
    }
    expect(db.orders).toHaveLength(0);
  });

  it("ΤΚ εκτός ζωνών → delivery_zone_unsupported", async () => {
    const result = await call(body({}, { postalCode: "10431" }));
    expect(result.status).toBe(409);
    expect(err(result)).toMatchObject({ code: "delivery_zone_unsupported" });
    expect(err(result).message).toContain("10431");
    expect(db.orders).toHaveLength(0);
  });

  it("ΤΚ σε ανενεργή ζώνη → delivery_zone_unavailable", async () => {
    const result = await call(body({ expectedDeliveryZoneId: "zoff" }, { postalCode: "55132" }));
    expect(err(result).code).toBe("delivery_zone_unavailable");
    expect(db.orders).toHaveLength(0);
  });

  it("κακόμορφες ζώνες → ελεγχόμενο σφάλμα, ΠΟΤΕ σιωπηλά γενικοί όροι", async () => {
    db.setShop("zoned", shopDoc({ deliveryZones: { enabled: true, zones: [{ id: "x" }] } }));
    const result = await call(body());
    expect(err(result).code).toBe("shop_config_invalid");
    expect(db.orders).toHaveLength(0);
  });

  describe("ακριβή όρια ποσών (σε λεπτά)", () => {
    it("ελάχιστη: 7,99€ απορρίπτεται, 8,00€ δεκτό", async () => {
      db.setItem("zoned", "a", { name: "Α", price: 7.99 });
      db.setItem("zoned", "b", { name: "Β", price: 8 });
      const below = await call(body({ lines: [{ itemId: "a", quantity: 1 }], expectedTotalCents: 949 }));
      expect(err(below)).toMatchObject({ code: "below_minimum_order" });
      expect(err(below).quote?.delivery).toMatchObject({ zoneId: "zcenter" });
      const exact = await call(body({ lines: [{ itemId: "b", quantity: 1 }], expectedTotalCents: 950 }));
      expect(exact.status).toBe(201);
    });

    it("δωρεάν μεταφορικά: 19,99€ πληρώνει, 20,00€ δωρεάν", async () => {
      db.setItem("zoned", "c", { name: "Γ", price: 19.99 });
      db.setItem("zoned", "d", { name: "Δ", price: 20 });
      const below = await call(body({ lines: [{ itemId: "c", quantity: 1 }], expectedTotalCents: 2149 }));
      expect(ok(below)).toMatchObject({ deliveryFeeCents: 150, totalCents: 2149 });
      const exact = await call(body({ lines: [{ itemId: "d", quantity: 1 }], expectedTotalCents: 2000 }));
      expect(ok(exact)).toMatchObject({ deliveryFeeCents: 0, totalCents: 2000 });
    });

    it("ζώνη χωρίς δωρεάν μεταφορικά: πάντα χρεώνει", async () => {
      const result = await call(
        body(
          { lines: [{ itemId: "margherita", quantity: 4 }], expectedTotalCents: 3700, expectedDeliveryZoneId: "zeast" },
          { postalCode: "55131" },
        ),
      );
      expect(ok(result)).toMatchObject({ subtotalCents: 3400, deliveryFeeCents: 300, totalCents: 3700 });
    });

    it("οι επιλογές προϊόντος μετρούν στο υποσύνολο (ελάχιστη/δωρεάν)", async () => {
      // 6,00 + 2,00 (Μεγάλη) = 8,00 → καλύπτει ακριβώς την ελάχιστη 8,00 της ζώνης
      const withOption = await call(
        body({
          lines: [{ itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["l"] }] }],
          expectedTotalCents: 950,
        }),
      );
      expect(withOption.status).toBe(201);
      expect(ok(withOption)).toMatchObject({ subtotalCents: 800, deliveryFeeCents: 150 });

      const small = await call(
        body({
          lines: [{ itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["s"] }] }],
          expectedTotalCents: 750,
        }),
      );
      expect(err(small).code).toBe("below_minimum_order");
    });
  });
});

/* ==========================================================================
 *  Παραποίηση από τον client
 * ========================================================================== */

describe("ο client δεν ορίζει τιμές ή ζώνη", () => {
  it("μεταφορικά/ζώνη/τιμές στο σώμα αγνοούνται — υπολογίζει ο server", async () => {
    const result = await call(
      body({
        deliveryFee: 0,
        deliveryFeeCents: 0,
        zone: { id: "zeast", deliveryFeeCents: 0 },
        lines: [{ itemId: "margherita", quantity: 1, price: 0.01 }],
      }),
    );
    expect(result.status).toBe(201);
    expect(ok(result)).toMatchObject({ deliveryFeeCents: 150, totalCents: 1000 });
  });

  it("αναμενόμενο σύνολο χωρίς μεταφορικά → price_changed, καμία παραγγελία", async () => {
    const result = await call(body({ expectedTotalCents: 850 }));
    expect(err(result).code).toBe("price_changed");
    expect(err(result).quote?.totalCents).toBe(1000);
    expect(db.orders).toHaveLength(0);
  });

  it("ζώνη που «διάλεξε» ο client ≠ ζώνη του ΤΚ → delivery_zone_changed", async () => {
    const result = await call(body({ expectedDeliveryZoneId: "zeast" }));
    expect(err(result).code).toBe("delivery_zone_changed");
    expect(db.orders).toHaveLength(0);
  });

  it("αίτημα ΧΩΡΙΣ αναμενόμενη ζώνη σε κατάστημα με ζώνες → νέα επιβεβαίωση", async () => {
    const result = await call(body({ expectedDeliveryZoneId: undefined }));
    expect(err(result).code).toBe("delivery_zone_changed");
    expect(err(result).quote?.delivery).toMatchObject({ zoneId: "zcenter" });
  });

  it("κακόμορφο expectedDeliveryZoneId → validation_failed", async () => {
    const result = await call(body({ expectedDeliveryZoneId: "../zones" }));
    expect(result.status).toBe(400);
  });
});

/* ==========================================================================
 *  Αλλαγές ενώ ο πελάτης είναι στο checkout
 * ========================================================================== */

describe("αλλαγές ρυθμίσεων κατά το checkout", () => {
  it("νέα μεταφορικά ζώνης → price_changed με τη νέα σύνοψη· μετά ρητή επιβεβαίωση", async () => {
    db.setShop("zoned", shopDoc({ deliveryZones: { ...ZONES, zones: [{ ...ZONES.zones[0], deliveryFeeCents: 250 }, ...ZONES.zones.slice(1)] } }));
    const first = await call(body());
    expect(err(first)).toMatchObject({ code: "price_changed" });
    expect(err(first).quote).toMatchObject({ totalCents: 1100, delivery: { zoneId: "zcenter", deliveryFeeCents: 250 } });
    expect(db.orders).toHaveLength(0);

    const confirmed = await call(body({ expectedTotalCents: 1100 }));
    expect(confirmed.status).toBe(201);
  });

  it("ο ΤΚ μετακινήθηκε σε άλλη ζώνη → delivery_zone_changed (ακόμη κι αν το ποσό συμπίπτει)", async () => {
    const moved = {
      ...ZONES,
      zones: [
        { ...ZONES.zones[0], postalCodes: ["54623"] },
        { ...ZONES.zones[1], id: "znew", name: "Νέα", postalCodes: ["54622"], deliveryFeeCents: 150, minOrderCents: 800, freeDeliveryOverCents: 2000 },
      ],
    };
    db.setShop("zoned", shopDoc({ deliveryZones: moved }));
    const result = await call(body());
    expect(err(result).code).toBe("delivery_zone_changed");
    expect(err(result).message).toContain("«Νέα»");
    expect(err(result).quote?.delivery).toMatchObject({ zoneId: "znew" });
    expect(db.orders).toHaveLength(0);
  });

  it("η ζώνη απενεργοποιήθηκε → delivery_zone_unavailable (ποτέ γενικοί όροι)", async () => {
    db.setShop("zoned", shopDoc({ deliveryZones: { ...ZONES, zones: [{ ...ZONES.zones[0], available: false }, ...ZONES.zones.slice(1)] } }));
    expect(err(await call(body())).code).toBe("delivery_zone_unavailable");
    expect(db.orders).toHaveLength(0);
  });

  it("ο περιορισμός ΤΚ απενεργοποιήθηκε → delivery_zone_changed με τους γενικούς όρους", async () => {
    db.setShop("zoned", shopDoc({ deliveryZones: { ...ZONES, enabled: false } }));
    const result = await call(body());
    expect(err(result).code).toBe("delivery_zone_changed");
    expect(err(result).quote?.delivery).toMatchObject({ mode: "shop_default", postalCode: "54622" });
    const confirmed = await call(body({ expectedDeliveryZoneId: undefined }));
    expect(confirmed.status).toBe(201);
    expect(ok(confirmed).delivery).toMatchObject({ mode: "shop_default" });
  });

  it("το κατάστημα έκλεισε (παύση) → shop_closed, καμία παραγγελία", async () => {
    db.setShop("zoned", shopDoc({ active: false }));
    expect(err(await call(body())).code).toBe("shop_closed");
    expect(db.orders).toHaveLength(0);
  });
});

/* ==========================================================================
 *  Idempotency, ανάκτηση, συμβατότητα
 * ========================================================================== */

describe("επανάληψη και ανάκτηση μετά από κλείσιμο ή αλλαγή ζωνών", () => {
  it("η επανάληψη επιστρέφει την ΑΡΧΙΚΗ παραγγελία ακόμη κι αν το κατάστημα έκλεισε", async () => {
    const payload = body();
    const first = ok(await call(payload));
    db.setShop("zoned", shopDoc({ active: false }));
    db.nowMs = athens(MON, "23:30");
    const retry = await call(payload);
    expect(retry.status).toBe(200);
    expect(ok(retry)).toMatchObject({ orderId: first.orderId, replayed: true, delivery: { zoneId: "zcenter" } });
    expect(db.orders).toHaveLength(1);
  });

  it("η επανάληψη επιστρέφει την αρχική παραγγελία μετά από αλλαγή/διαγραφή ζωνών", async () => {
    const payload = body();
    const first = ok(await call(payload));
    db.setShop("zoned", shopDoc({ deliveryZones: { enabled: true, zones: [] } }));
    const retry = await call(payload);
    expect(ok(retry)).toMatchObject({ orderId: first.orderId, totalCents: 1000 });
  });

  it("η ανάκτηση (recover) βρίσκει την παραγγελία παρά το κλείσιμο", async () => {
    const payload = body();
    const first = ok(await call(payload));
    db.setShop("zoned", shopDoc({ active: false, openingHours: "χαλασμένο" }));
    const recovered = await handleAttemptRecovery(deps, {
      authorization: "Bearer uid-guest",
      rawBody: JSON.stringify({ idempotencyKey: payload.idempotencyKey }),
    });
    expect(recovered.body).toMatchObject({ ok: true, outcome: "order_found", order: { orderId: first.orderId } });
  });

  it("ίδιος ΤΚ γραμμένος αλλιώς («546 22» / «54622») = ίδιο αίτημα", async () => {
    const payload = body();
    const first = ok(await call(payload));
    const retry = await call({ ...payload, delivery: { ...(payload.delivery as Body), postalCode: "54622" } });
    expect(ok(retry)).toMatchObject({ orderId: first.orderId, replayed: true });
  });

  it("ίδιο κλειδί με ΑΛΛΟ ΤΚ → idempotency_key_reused", async () => {
    const payload = body();
    await call(payload);
    const changed = await call({ ...payload, delivery: { ...(payload.delivery as Body), postalCode: "54623" } });
    expect(err(changed).code).toBe("idempotency_key_reused");
    expect(db.orders).toHaveLength(1);
  });

  it("τα hash των ΠΑΛΙΩΝ αιτημάτων (χωρίς ΤΚ/ζώνη) δεν αλλάζουν", () => {
    const legacy = validateCheckoutRequest({
      idempotencyKey: "legacy-key-000000000001",
      shopId: "pizza-roma",
      customer: { fullName: "Κώστας Παπαδόπουλος", phone: "6912345678" },
      delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
      paymentMethod: "cash_on_delivery",
      lines: [{ itemId: "pr-2", quantity: 1 }],
      expectedTotalCents: 1000,
    });
    if (!legacy.ok) throw new Error("invalid");
    const request = legacy.value;
    // Ο αλγόριθμος του milestone 1–3, αυτούσιος
    const before = createHash("sha256")
      .update(
        stableStringify({
          shopId: request.shopId,
          customer: request.customer,
          delivery: request.delivery,
          notes: request.notes ?? null,
          paymentMethod: request.paymentMethod,
          lines: request.lines,
          expectedTotalCents: request.expectedTotalCents,
        }),
        "utf8",
      )
      .digest("hex");
    expect(canonicalRequestHash(request)).toBe(before);
    expect(request.delivery).not.toHaveProperty("postalCode");
  });
});
