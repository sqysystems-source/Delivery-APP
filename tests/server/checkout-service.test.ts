import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCheckoutRequest,
  type CheckoutDeps,
  type CheckoutStore,
} from "@/lib/server/checkout-service";
import type { CheckoutErrorBody, CheckoutSuccess } from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { FakeCheckoutDb, SERVER_TIMESTAMP } from "./fake-checkout-store";

/* ==========================================================================
 *  Δεδομένα
 * ========================================================================== */

let db: FakeCheckoutDb;
let deps: CheckoutDeps;
let keyCounter = 0;

function newKey() {
  keyCounter += 1;
  return `test-key-${String(keyCounter).padStart(4, "0")}-abcdefgh`;
}

function seed() {
  db.setShop("pizza-roma", {
    name: "Pizza Roma",
    active: true,
    minOrder: 8,
    deliveryFee: 1.5,
    freeDeliveryOver: 20,
    ownerUid: "owner-1",
    etaMinutes: [30, 40],
  });
  db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 8.5, available: true });
  db.setItem("pizza-roma", "pr-3", { name: "Special Roma", price: 11.9, available: true });
  db.setItem("pizza-roma", "pr-8", { name: "Αναψυκτικό 1,5L", price: 2.8 });
  db.setItem("pizza-roma", "pr-9", { name: "Καλτσόνε", price: 9, available: false });

  db.setShop("boundary", { name: "Όρια", minOrder: 10, deliveryFee: 2, freeDeliveryOver: 20 });
  db.setItem("boundary", "b-500", { name: "Πέντε", price: 5 });
  db.setItem("boundary", "b-499", { name: "Τέσσερα ενενήντα εννιά", price: 4.99 });
}

type Body = Record<string, unknown>;

function validBody(overrides: Body = {}): Body {
  return {
    idempotencyKey: newKey(),
    shopId: "pizza-roma",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "691 234 5678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος", doorbell: "Παπαδόπουλος" },
    notes: "Χωρίς κρεμμύδι",
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "pr-2", quantity: 1 }],
    expectedTotalCents: 1000, // 8,50 + 1,50 μεταφορικά
    ...overrides,
  };
}

function call(body: Body | string, token: string | null = "uid-guest") {
  return handleCheckoutRequest(deps, {
    authorization: token === null ? null : `Bearer ${token}`,
    rawBody: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const asSuccess = (body: unknown) => body as CheckoutSuccess;
const asError = (body: unknown) => body as CheckoutErrorBody;

beforeEach(() => {
  db = new FakeCheckoutDb();
  seed();
  deps = {
    store: db.store(),
    verifyIdToken: async (token) => {
      if (token.startsWith("uid-")) return { uid: token.slice(4) };
      throw new Error("invalid token");
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    timestampFromMillis: (ms) => ({ ms }),
    now: () => db.nowMs,
    logger: { error: vi.fn(), warn: vi.fn() },
  };
});

/* ==========================================================================
 *  Επιτυχία
 * ========================================================================== */

describe("έγκυρο checkout", () => {
  it("επισκέπτης (ανώνυμος uid): δημιουργεί παραγγελία με εξουσιοδοτημένα ποσά", async () => {
    const result = await call(validBody());

    expect(result.status).toBe(201);
    const body = asSuccess(result.body);
    expect(body).toMatchObject({
      ok: true,
      status: "pending",
      paymentMethod: "cash_on_delivery",
      shopName: "Pizza Roma",
      subtotal: 8.5,
      deliveryFee: 1.5,
      total: 10,
      totalCents: 1000,
      address: "Ερμού 5, Τρίκαλα",
      replayed: false,
    });
    expect(body.code).toBe(`BK-${body.orderId.slice(0, 6).toUpperCase()}`);
    expect(body.lines).toEqual([
      {
        itemId: "pr-2",
        name: "Margherita",
        quantity: 1,
        unitPrice: 8.5,
        lineTotal: 8.5,
        unitPriceCents: 850,
        lineTotalCents: 850,
      },
    ]);

    expect(db.orders).toHaveLength(1);
    const [orderId, order] = db.orders[0];
    expect(orderId).toBe(body.orderId);
    expect(order).toMatchObject({
      shopId: "pizza-roma",
      shopName: "Pizza Roma",
      ownerUid: "owner-1",
      userId: "guest",
      customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
      delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος", doorbell: "Παπαδόπουλος" },
      address: "Ερμού 5, Τρίκαλα",
      notes: "Χωρίς κρεμμύδι",
      paymentMethod: "cash_on_delivery",
      subtotal: 8.5,
      deliveryFee: 1.5,
      total: 10,
      totalCents: 1000,
      status: "pending",
      etaMinutes: [30, 40],
      schemaVersion: 2,
      source: "web",
    });
    expect(db.records).toHaveLength(1);
  });

  it("συνδεδεμένος χρήστης: userId από το token", async () => {
    const result = await call(validBody(), "uid-kostas");
    expect(result.status).toBe(201);
    expect(db.orders[0][1].userId).toBe("kostas");
  });

  it("ενοποιημένες διπλές γραμμές αποθηκεύονται ως μία", async () => {
    const result = await call(
      validBody({
        lines: [
          { itemId: "pr-2", quantity: 10 },
          { itemId: "pr-2", quantity: 10 },
        ],
        expectedTotalCents: 17_000, // 20 × 8,50, δωρεάν μεταφορικά
      }),
    );
    expect(result.status).toBe(201);
    expect(asSuccess(result.body).lines).toEqual([
      expect.objectContaining({ itemId: "pr-2", quantity: 20, lineTotalCents: 17_000 }),
    ]);
  });
});

/* ==========================================================================
 *  Παραποίηση από τον client
 * ========================================================================== */

describe("παραποίηση τιμών και ταυτότητας", () => {
  it("αγνοεί τιμές, ονόματα, userId, ownerUid, κατάσταση και ώρα από τον client", async () => {
    const result = await call(
      validBody({
        lines: [{ itemId: "pr-2", quantity: 1, unitPrice: 0.01, name: "Δωρεάν πίτσα", price: 0.01 }],
        subtotal: 0.01,
        total: 0.01,
        userId: "victim",
        ownerUid: "attacker",
        status: "completed",
        shopName: "Ψεύτικο μαγαζί",
        createdAt: "1999-01-01T00:00:00Z",
      }),
      "uid-real-user",
    );

    expect(result.status).toBe(201);
    const order = db.orders[0][1];
    expect(order).toMatchObject({
      userId: "real-user",
      ownerUid: "owner-1",
      status: "pending",
      shopName: "Pizza Roma",
      total: 10,
    });
    expect((order.lines as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: "Margherita",
      unitPrice: 8.5,
    });
    expect(order.createdAt).not.toBe("1999-01-01T00:00:00Z");
  });

  it("ένα ψεύτικο expectedTotalCents ΔΕΝ γίνεται τιμή — απλώς αποτυγχάνει η σύγκριση", async () => {
    const result = await call(validBody({ expectedTotalCents: 1 }));
    expect(result.status).toBe(409);
    expect(asError(result.body).code).toBe("price_changed");
    expect(asError(result.body).quote?.totalCents).toBe(1000);
    expect(db.orders).toHaveLength(0);
  });
});

/* ==========================================================================
 *  Επικύρωση
 * ========================================================================== */

describe("άκυρα δεδομένα πελάτη/παράδοσης", () => {
  it.each([
    [{ customer: { fullName: "", phone: "6912345678" } }, "fullName"],
    [{ customer: { fullName: "Κώστας", phone: "12345" } }, "phone"],
    [{ delivery: { street: "Κεντρική Πλατεία", city: "Τρίκαλα" } }, "street"],
    [{ delivery: { street: "Σπίτι", city: "Τρίκαλα" } }, "street"],
    [{ delivery: { street: "Ερμού 5", city: "" } }, "city"],
    [{ delivery: { street: "Ερμού 5", city: "Τρίκαλα", instructions: "x".repeat(201) } }, "instructions"],
    [{ notes: "x".repeat(301) }, "notes"],
    [{ paymentMethod: "card" }, "paymentMethod"],
  ])("%j → 400 με λάθος στο «%s»", async (overrides, field) => {
    const result = await call(validBody(overrides as Body));
    expect(result.status).toBe(400);
    const body = asError(result.body);
    expect(body.code).toBe("validation_failed");
    expect(body.fieldErrors).toHaveProperty(field);
    expect(db.orders).toHaveLength(0);
    expect(db.records).toHaveLength(0);
  });

  it.each([
    [{ shopId: "shops/evil" }],
    [{ shopId: "../pizza-roma" }],
    [{ shopId: "__admin__" }],
    [{ lines: [{ itemId: "pr-2/../../x", quantity: 1 }] }],
    [{ lines: [{ itemId: "a/b", quantity: 1 }] }],
    [{ idempotencyKey: "bad/key/0000000000000" }],
  ])("άκυρο id %j → 400 χωρίς να φτιαχτεί διαδρομή Firestore", async (overrides) => {
    // Το fake πετά σφάλμα αν ποτέ δει «/» σε id — εδώ δεν πρέπει καν να φτάσει
    const result = await call(validBody(overrides));
    expect(result.status).toBe(400);
    expect(db.transactionAttempts).toBe(0);
  });

  it("διπλές γραμμές που ξεπερνούν τα 20 τεμάχια ΜΕΤΑ την ενοποίηση → 400", async () => {
    const result = await call(
      validBody({
        lines: [
          { itemId: "pr-2", quantity: 15 },
          { itemId: "pr-2", quantity: 10 },
        ],
      }),
    );
    expect(result.status).toBe(400);
    expect(asError(result.body).fieldErrors?.lines).toBeDefined();
  });

  it("άκυρο JSON → 400, υπερβολικό μέγεθος → 413", async () => {
    expect((await call("{όχι json")).status).toBe(400);
    expect(asError((await call("{όχι json")).body).code).toBe("invalid_json");
    expect((await call(JSON.stringify({ pad: "x".repeat(CHECKOUT_LIMITS.maxRequestBytes + 1) }))).status).toBe(413);
  });

  it("χωρίς ή με άκυρο token → 401", async () => {
    expect((await call(validBody(), null)).status).toBe(401);
    expect((await call(validBody(), "forged-token")).status).toBe(401);
    expect(db.orders).toHaveLength(0);
  });
});

/* ==========================================================================
 *  Κατάστημα, προϊόντα, όρια
 * ========================================================================== */

describe("κανόνες καταστήματος", () => {
  it("κλειστό κατάστημα → 409 shop_closed", async () => {
    db.setShop("pizza-roma", { name: "Pizza Roma", active: false, minOrder: 8, deliveryFee: 1.5 });
    const result = await call(validBody());
    expect(result.status).toBe(409);
    expect(asError(result.body).code).toBe("shop_closed");
    expect(db.orders).toHaveLength(0);
  });

  it("ανύπαρκτο κατάστημα → 404", async () => {
    expect((await call(validBody({ shopId: "missing-shop" }))).status).toBe(404);
  });

  it("εξαντλημένο προϊόν → 409 item_unavailable με itemId", async () => {
    const result = await call(validBody({ lines: [{ itemId: "pr-9", quantity: 1 }], expectedTotalCents: 1050 }));
    expect(result.status).toBe(409);
    expect(asError(result.body)).toMatchObject({ code: "item_unavailable", itemId: "pr-9" });
    expect(asError(result.body).message).toContain("Καλτσόνε");
  });

  it("ανύπαρκτο προϊόν → 409 item_not_found με itemId", async () => {
    const result = await call(validBody({ lines: [{ itemId: "gone", quantity: 1 }] }));
    expect(asError(result.body)).toMatchObject({ code: "item_not_found", itemId: "gone" });
  });

  describe("όρια ελάχιστης παραγγελίας και μεταφορικών", () => {
    it("ακριβώς η ελάχιστη (10,00€) περνά", async () => {
      const result = await call(
        validBody({ shopId: "boundary", lines: [{ itemId: "b-500", quantity: 2 }], expectedTotalCents: 1200 }),
      );
      expect(result.status).toBe(201);
    });

    it("9,98€ (κάτω από 10,00€) → 400 με τη σωστή σύνοψη", async () => {
      const result = await call(
        validBody({ shopId: "boundary", lines: [{ itemId: "b-499", quantity: 2 }], expectedTotalCents: 1198 }),
      );
      expect(result.status).toBe(400);
      expect(asError(result.body).code).toBe("below_minimum_order");
      expect(asError(result.body).quote?.subtotalCents).toBe(998);
      expect(db.orders).toHaveLength(0);
    });

    it("ακριβώς στο όριο δωρεάν μεταφοράς (20,00€) → μεταφορικά 0", async () => {
      const result = await call(
        validBody({ shopId: "boundary", lines: [{ itemId: "b-500", quantity: 4 }], expectedTotalCents: 2000 }),
      );
      expect(asSuccess(result.body)).toMatchObject({ deliveryFeeCents: 0, totalCents: 2000 });
    });

    it("19,99€ → χρεώνονται μεταφορικά", async () => {
      const result = await call(
        validBody({
          shopId: "boundary",
          lines: [
            { itemId: "b-500", quantity: 3 },
            { itemId: "b-499", quantity: 1 },
          ],
          expectedTotalCents: 2199,
        }),
      );
      expect(asSuccess(result.body)).toMatchObject({ deliveryFeeCents: 200, totalCents: 2199 });
    });
  });

  it("πάνω από 500€ → 400 order_too_large", async () => {
    db.setItem("pizza-roma", "big", { name: "Τούρτα", price: 30 });
    const result = await call(validBody({ lines: [{ itemId: "big", quantity: 20 }], expectedTotalCents: 60_000 }));
    expect(asError(result.body).code).toBe("order_too_large");
  });

  it.each([
    [{ deliveryFee: "1.5" }],
    [{ deliveryFee: -1 }],
    [{ minOrder: Number.NaN }],
    [{ freeDeliveryOver: Number.POSITIVE_INFINITY }],
  ])("κακόμορφοι όροι καταστήματος %j → ελεγχόμενο 500", async (bad) => {
    db.setShop("pizza-roma", { name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20, ...bad });
    const result = await call(validBody());
    expect(result.status).toBe(500);
    expect(asError(result.body).code).toBe("shop_config_invalid");
    expect(deps.logger?.error).toHaveBeenCalled();
    expect(db.orders).toHaveLength(0);
  });

  it.each([["3.90"], [-1], [null], [1000]])("κακόμορφη τιμή προϊόντος %s → ελεγχόμενο 500", async (price) => {
    db.setItem("pizza-roma", "pr-2", { name: "Margherita", price });
    const result = await call(validBody());
    expect(result.status).toBe(500);
    expect(asError(result.body).code).toBe("menu_config_invalid");
    expect(db.orders).toHaveLength(0);
  });
});

/* ==========================================================================
 *  Αλλαγή τιμών → επανεπιβεβαίωση
 * ========================================================================== */

describe("αλλαγμένες τιμές", () => {
  it("διαφορετικό σύνολο → 409 με νέα σύνοψη, ΚΑΜΙΑ παραγγελία, κλειδί όχι δεσμευμένο", async () => {
    db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 9 });
    const body = validBody();

    const first = await call(body);
    expect(first.status).toBe(409);
    const error = asError(first.body);
    expect(error.code).toBe("price_changed");
    expect(error.quote).toMatchObject({ totalCents: 1050, lines: [expect.objectContaining({ unitPrice: 9 })] });
    expect(error.message).toContain("10,50€");
    expect(db.orders).toHaveLength(0);
    expect(db.records).toHaveLength(0);

    // Νέα ρητή επιβεβαίωση με νέο κλειδί
    const confirmed = await call(validBody({ expectedTotalCents: 1050 }));
    expect(confirmed.status).toBe(201);
    expect(asSuccess(confirmed.body).totalCents).toBe(1050);

    // Και με το ΙΔΙΟ κλειδί θα περνούσε: η αποτυχία δεν το κατανάλωσε
    const sameKey = await call({ ...body, expectedTotalCents: 1050 });
    expect(sameKey.status).toBe(201);
  });

  it("ελέγχει ξανά το ποσό σε κάθε νέα υποβολή", async () => {
    const body = validBody();
    db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 9 });
    expect((await call(body)).status).toBe(409);
    db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 9.5 });
    const second = await call({ ...body, expectedTotalCents: 1050 });
    expect(asError(second.body)).toMatchObject({ code: "price_changed", quote: { totalCents: 1100 } });
  });
});

/* ==========================================================================
 *  Idempotency
 * ========================================================================== */

describe("idempotency", () => {
  it("ταυτόχρονα ίδια αιτήματα → ΑΚΡΙΒΩΣ μία παραγγελία", async () => {
    const body = validBody();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(body)));

    expect(results.every((result) => result.body.ok)).toBe(true);
    const ids = new Set(results.map((result) => asSuccess(result.body).orderId));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => asSuccess(result.body).replayed)).toHaveLength(5);
    expect(db.orders).toHaveLength(1);
    expect(db.records).toHaveLength(1);
    expect(db.transactionAttempts).toBeGreaterThan(1); // υπήρξε πραγματική σύγκρουση
  });

  it("επανάληψη μετά από χαμένη απάντηση → ίδια παραγγελία, ίδιος κωδικός", async () => {
    const body = validBody();
    const first = asSuccess((await call(body)).body);
    const retry = await call(body);

    expect(retry.status).toBe(200);
    expect(asSuccess(retry.body)).toMatchObject({ orderId: first.orderId, code: first.code, replayed: true });
    expect(db.orders).toHaveLength(1);
  });

  it("η επανάληψη επιστρέφει το ΑΠΟΘΗΚΕΥΜΕΝΟ αποτέλεσμα ακόμη κι αν άλλαξε ο κατάλογος", async () => {
    const body = validBody();
    const first = asSuccess((await call(body)).body);

    db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 12, available: false });
    db.setShop("pizza-roma", { name: "Pizza Roma", active: false });

    const retry = await call(body);
    expect(retry.status).toBe(200);
    expect(asSuccess(retry.body)).toMatchObject({ orderId: first.orderId, totalCents: 1000 });
  });

  it("ίδιο κλειδί με διαφορετικό περιεχόμενο → 409 με την υπάρχουσα παραγγελία", async () => {
    const body = validBody();
    const first = asSuccess((await call(body)).body);

    const changed = await call({ ...body, notes: "Άλλο σχόλιο" });
    expect(changed.status).toBe(409);
    expect(asError(changed.body)).toMatchObject({
      code: "idempotency_key_reused",
      existingOrder: { orderId: first.orderId, code: first.code },
    });
    expect(db.orders).toHaveLength(1);
  });

  it("το ίδιο κλειδί από άλλον χρήστη είναι ανεξάρτητο", async () => {
    const body = validBody();
    await call(body, "uid-alice");
    const bob = await call(body, "uid-bob");
    expect(bob.status).toBe(201);
    expect(db.orders).toHaveLength(2);
  });

  it("αποτυχημένη επικύρωση δεν δεσμεύει το κλειδί", async () => {
    const body = validBody();
    const invalid = await call({ ...body, customer: { fullName: "Κώστας", phone: "123" } });
    expect(invalid.status).toBe(400);

    const valid = await call(body);
    expect(valid.status).toBe(201);
  });

  it("ALREADY_EXISTS από το create → επιστρέφει το αποτέλεσμα του «νικητή»", async () => {
    const body = validBody();
    const winner = asSuccess((await call(body)).body);

    // Store που αγνοεί το γρήγορο μονοπάτι και «χάνει» την αγωνία στο commit
    const real = db.store();
    let fastPathCalls = 0;
    const racing: CheckoutStore = {
      ...real,
      getIdempotencyRecord: async (id) => (fastPathCalls++ === 0 ? null : real.getIdempotencyRecord(id)),
      runTransaction: async () => {
        const error = new Error("ALREADY_EXISTS") as Error & { code: number };
        error.code = 6;
        throw error;
      },
    };

    const result = await handleCheckoutRequest(
      { ...deps, store: racing },
      { authorization: "Bearer uid-guest", rawBody: JSON.stringify(body) },
    );
    expect(result.status).toBe(200);
    expect(asSuccess(result.body).orderId).toBe(winner.orderId);
  });
});

/* ==========================================================================
 *  Rate limit
 * ========================================================================== */

describe("rate limit", () => {
  it("5 νέες παραγγελίες/λεπτό· επαναλήψεις ΔΕΝ μετρούν και ΔΕΝ μπλοκάρονται", async () => {
    const first = validBody();
    expect((await call(first)).status).toBe(201);
    for (let index = 0; index < 4; index += 1) {
      expect((await call(validBody())).status).toBe(201);
    }

    const sixth = await call(validBody());
    expect(sixth.status).toBe(429);
    expect(asError(sixth.body).code).toBe("rate_limited");

    // Επανάληψη της πρώτης μετά το όριο → επιστρέφει την αρχική
    const retry = await call(first);
    expect(retry.status).toBe(200);
    expect(asSuccess(retry.body).replayed).toBe(true);
    expect(db.orders).toHaveLength(5);

    // Άλλος χρήστης δεν επηρεάζεται
    expect((await call(validBody(), "uid-other")).status).toBe(201);
  });
});
