/* ==========================================================================
 *  Milestone 3 — server checkout με επιλογές προϊόντος.
 *
 *  Πάνω στο in-memory FakeCheckoutDb (σειριοποιήσιμες συναλλαγές, create
 *  semantics). Αποδεικνύει τη ΛΟΓΙΚΗ του service — όχι τη συμπεριφορά του
 *  πραγματικού Firestore.
 * ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalRequestHash,
  handleAttemptRecovery,
  handleCheckoutRequest,
  type CheckoutDeps,
} from "@/lib/server/checkout-service";
import { validateCheckoutRequest } from "@/lib/checkout/validation";
import { lineKeyOf } from "@/lib/menu/options";
import type { CheckoutErrorBody, CheckoutRecoveryResult, CheckoutSuccess, StoredOrderLine } from "@/types";
import { FakeCheckoutDb, SERVER_TIMESTAMP } from "./fake-checkout-store";
import { pizzaGroups } from "../fixtures/menu-options";

let db: FakeCheckoutDb;
let deps: CheckoutDeps;
let counter = 0;

const newKey = () => `opt-key-${String(++counter).padStart(4, "0")}-abcdefghij`;

const LARGE_CHEESE_NO_ONION = [
  { groupId: "size", choiceIds: ["l"] },
  { groupId: "extras", choiceIds: ["cheese"] },
  { groupId: "without", choiceIds: ["onion"] },
];

function seed() {
  db.setShop("pizza-roma", {
    name: "Pizza Roma",
    minOrder: 0,
    deliveryFee: 1.5,
    freeDeliveryOver: null,
    ownerUid: "owner-1",
  });
  db.setItem("pizza-roma", "pizza", { name: "Πίτσα του σεφ", price: 5, available: true, optionGroups: pizzaGroups() });
  db.setItem("pizza-roma", "cola", { name: "Cola", price: 2 });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: newKey(),
    shopId: "pizza-roma",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "6912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
    notes: "Χτυπήστε δυνατά",
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "pizza", quantity: 2, selections: LARGE_CHEESE_NO_ONION }],
    expectedTotalCents: 1450, // 2 × 6,50 + 1,50
    ...overrides,
  };
}

const call = (payload: unknown, uid = "cust") =>
  handleCheckoutRequest(deps, { authorization: `Bearer uid-${uid}`, rawBody: JSON.stringify(payload) });

const asSuccess = (value: unknown) => value as CheckoutSuccess;
const asError = (value: unknown) => value as CheckoutErrorBody;

beforeEach(() => {
  db = new FakeCheckoutDb();
  seed();
  deps = {
    store: db.store(),
    verifyIdToken: async (token) => {
      if (token.startsWith("uid-")) return { uid: token.slice(4) };
      throw new Error("invalid");
    },
    serverTimestamp: () => SERVER_TIMESTAMP,
    timestampFromMillis: (ms) => ({ ms }),
    now: () => db.nowMs,
    logger: { error: vi.fn(), warn: vi.fn() },
  };
});

/* ========================================================================== */

describe("τιμολόγηση με επιλογές — μόνο στον server", () => {
  it("5 + 1 (μεγάλη) + 0,50 (τυρί) + 0 (χωρίς κρεμμύδι) = 6,50 × 2 = 13,00", async () => {
    const result = await call(body());
    expect(result.status).toBe(201);
    const success = asSuccess(result.body);
    expect(success.totalCents).toBe(1450);
    expect(success.lines[0]).toMatchObject({
      itemId: "pizza",
      quantity: 2,
      basePrice: 5,
      basePriceCents: 500,
      unitPrice: 6.5,
      unitPriceCents: 650,
      lineTotal: 13,
      lineTotalCents: 1300,
    });
    expect(success.lines[0].options?.map((option) => [option.label, option.priceDeltaCents])).toEqual([
      ["Μεγάλη", 100],
      ["Τυρί", 50],
      ["κρεμμύδι", 0],
    ]);
  });

  it("αγνοεί πειραγμένες τιμές/ετικέτες/διαθεσιμότητα από τον client", async () => {
    const tampered = body({
      lines: [
        {
          itemId: "pizza",
          quantity: 2,
          unitPrice: 0.01,
          name: "Δωρεάν",
          selections: [
            { groupId: "size", choiceIds: ["l"], label: "Μικρή", priceDelta: 0 },
            { groupId: "extras", choiceIds: ["cheese"], priceDelta: -5, available: true },
            { groupId: "without", choiceIds: ["onion"] },
          ],
        },
      ],
    });
    const result = await call(tampered);
    expect(result.status).toBe(201);
    expect(asSuccess(result.body).lines[0]).toMatchObject({ name: "Πίτσα του σεφ", unitPriceCents: 650 });
  });

  it("αποθηκεύει ΑΜΕΤΑΒΛΗΤΟ στιγμιότυπο στην παραγγελία", async () => {
    await call(body());
    const [, order] = db.orders[0];
    const line = (order.lines as StoredOrderLine[])[0];
    expect(line).toMatchObject({ basePrice: 5, basePriceCents: 500, unitPriceCents: 650, quantity: 2, lineTotalCents: 1300 });
    expect(line.options).toEqual([
      { groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "l", label: "Μεγάλη", priceDelta: 1, priceDeltaCents: 100 },
      { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple", choiceId: "cheese", label: "Τυρί", priceDelta: 0.5, priceDeltaCents: 50 },
      { groupId: "without", groupLabel: "Αφαίρεση υλικών", kind: "remove", choiceId: "onion", label: "κρεμμύδι", priceDelta: 0, priceDeltaCents: 0 },
    ]);
    // Οι σημειώσεις μένουν ξεχωριστές από τις επιλογές
    expect(order.notes).toBe("Χτυπήστε δυνατά");

    /* Ο κατάλογος αλλάζει ΜΕΤΑ: η παραγγελία δεν επηρεάζεται */
    const renamed = pizzaGroups();
    renamed[0].choices[1].label = "XL νέα";
    renamed[0].choices[1].priceDelta = 3;
    db.setItem("pizza-roma", "pizza", { name: "Άλλο όνομα", price: 9, optionGroups: renamed });
    expect(((db.orders[0][1].lines as StoredOrderLine[])[0].options ?? [])[0].label).toBe("Μεγάλη");
  });

  it("προϊόν χωρίς επιλογές: ακριβώς το σχήμα του milestone 2", async () => {
    const result = await call(body({ lines: [{ itemId: "cola", quantity: 1 }], expectedTotalCents: 350 }));
    expect(asSuccess(result.body).lines[0]).toEqual({
      itemId: "cola",
      name: "Cola",
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      unitPriceCents: 200,
      lineTotalCents: 200,
    });
  });

  it("δύο παραλλαγές του ίδιου προϊόντος = δύο γραμμές, ένα ανάγνωσμα προϊόντος", async () => {
    const result = await call(
      body({
        lines: [
          { itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["s"] }] },
          { itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["l"] }] },
        ],
        expectedTotalCents: 500 + 600 + 150,
      }),
    );
    expect(result.status).toBe(201);
    expect(asSuccess(result.body).lines.map((line) => line.unitPriceCents)).toEqual([600, 500]);
  });

  it("ίδια παραλλαγή σε δύο γραμμές (άλλη σειρά επιλογών) → ενώνεται σε μία", async () => {
    const result = await call(
      body({
        lines: [
          { itemId: "pizza", quantity: 1, selections: LARGE_CHEESE_NO_ONION },
          { itemId: "pizza", quantity: 1, selections: [...LARGE_CHEESE_NO_ONION].reverse() },
        ],
      }),
    );
    expect(result.status).toBe(201);
    expect(asSuccess(result.body).lines).toHaveLength(1);
    expect(asSuccess(result.body).lines[0].quantity).toBe(2);
  });
});

/* ========================================================================== */

describe("απορρίψεις επιλογών — ΚΑΜΙΑ παραγγελία", () => {
  it("άγνωστη επιλογή → 409 options_changed με κλειδί γραμμής", async () => {
    const selections = [{ groupId: "size", choiceIds: ["ghost"] }];
    const result = await call(body({ lines: [{ itemId: "pizza", quantity: 1, selections }], expectedTotalCents: 650 }));
    expect(result.status).toBe(409);
    expect(asError(result.body)).toMatchObject({
      code: "options_changed",
      itemId: "pizza",
      lineKey: "pizza|size:ghost",
    });
    expect(asError(result.body).message).toContain("Επεξεργάσου");
    expect(db.orders).toHaveLength(0);
  });

  it("άγνωστη ομάδα / επιλογή άλλης ομάδας → options_changed", async () => {
    for (const selections of [
      [{ groupId: "ghost", choiceIds: ["l"] }],
      [{ groupId: "size", choiceIds: ["cheese"] }],
    ]) {
      const result = await call(body({ lines: [{ itemId: "pizza", quantity: 1, selections }] }));
      expect(asError(result.body).code).toBe("options_changed");
    }
    expect(db.orders).toHaveLength(0);
  });

  it("λείπει υποχρεωτικό μέγεθος → options_changed με ελληνικό μήνυμα για την ομάδα", async () => {
    const result = await call(body({ lines: [{ itemId: "pizza", quantity: 1 }], expectedTotalCents: 650 }));
    expect(result.status).toBe(409);
    expect(asError(result.body)).toMatchObject({ code: "options_changed", lineKey: "pizza" });
    expect(asError(result.body).message).toContain("«Μέγεθος»");
  });

  it("μη διαθέσιμη επιλογή → 409 option_unavailable", async () => {
    const selections = [
      { groupId: "size", choiceIds: ["l"] },
      { groupId: "extras", choiceIds: ["mush"] },
    ];
    const result = await call(body({ lines: [{ itemId: "pizza", quantity: 1, selections }] }));
    expect(result.status).toBe(409);
    expect(asError(result.body)).toMatchObject({ code: "option_unavailable", itemId: "pizza" });
    expect(asError(result.body).message).toContain("Μανιτάρια");
    expect(db.orders).toHaveLength(0);
  });

  it("η επιλογή έγινε μη διαθέσιμη μετά την προσθήκη στο καλάθι → option_unavailable, όχι σιωπηλή αφαίρεση", async () => {
    const groups = pizzaGroups();
    groups[1].choices[0].available = false; // τυρί
    db.setItem("pizza-roma", "pizza", { name: "Πίτσα του σεφ", price: 5, optionGroups: groups });
    const result = await call(body());
    expect(asError(result.body).code).toBe("option_unavailable");
    expect(db.orders).toHaveLength(0);
  });

  it.each([
    ["διπλή επιλογή", [{ groupId: "size", choiceIds: ["l", "l"] }]],
    ["διπλή ομάδα", [{ groupId: "size", choiceIds: ["l"] }, { groupId: "size", choiceIds: ["s"] }]],
    ["κακόμορφο", "όχι λίστα"],
    ["άκυρο id", [{ groupId: "size/../x", choiceIds: ["l"] }]],
  ])("%s → 400 validation_failed", async (_name, selections) => {
    const result = await call(body({ lines: [{ itemId: "pizza", quantity: 1, selections }] }));
    expect(result.status).toBe(400);
    expect(asError(result.body).code).toBe("validation_failed");
    expect(asError(result.body).fieldErrors?.lines).toBeTruthy();
    expect(db.orders).toHaveLength(0);
  });

  it("δύο μεγέθη σε «μία επιλογή» → options_changed", async () => {
    const result = await call(
      body({ lines: [{ itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["l", "s"] }] }] }),
    );
    expect(asError(result.body).code).toBe("options_changed");
  });

  it("κακόμορφη ρύθμιση στη βάση → 500 menu_config_invalid (όχι χρέωση χωρίς επιλογές)", async () => {
    const broken = pizzaGroups();
    broken[1].choices[0].priceDelta = -1;
    db.setItem("pizza-roma", "pizza", { name: "Πίτσα", price: 5, optionGroups: broken });
    const result = await call(body());
    expect(result.status).toBe(500);
    expect(asError(result.body).code).toBe("menu_config_invalid");
    expect(db.orders).toHaveLength(0);
  });
});

describe("όρια ποσότητας — δεν παρακάμπτονται με παραλλαγές", () => {
  it("20 ανά προϊόν για ΟΛΕΣ τις παραλλαγές: 11 + 10 → 400", async () => {
    const result = await call(
      body({
        lines: [
          { itemId: "pizza", quantity: 11, selections: [{ groupId: "size", choiceIds: ["s"] }] },
          { itemId: "pizza", quantity: 10, selections: [{ groupId: "size", choiceIds: ["l"] }] },
        ],
        expectedTotalCents: 11 * 500 + 10 * 600 + 150,
      }),
    );
    expect(result.status).toBe(400);
    expect(asError(result.body).fieldErrors?.lines).toContain("παραλλαγές");
    expect(db.orders).toHaveLength(0);
  });

  it("ακριβώς 20 σε παραλλαγές περνά", async () => {
    const result = await call(
      body({
        lines: [
          { itemId: "pizza", quantity: 10, selections: [{ groupId: "size", choiceIds: ["s"] }] },
          { itemId: "pizza", quantity: 10, selections: [{ groupId: "size", choiceIds: ["l"] }] },
        ],
        expectedTotalCents: 10 * 500 + 10 * 600 + 150,
      }),
    );
    expect(result.status).toBe(201);
  });

  it("ανώτατο σύνολο 500€ ισχύει με τις προσαυξήσεις", async () => {
    const groups = pizzaGroups();
    groups[0].choices[1].priceDelta = 20; // μεγάλη +20 → 25€/τεμ.
    db.setItem("pizza-roma", "pizza", { name: "Πίτσα", price: 5, optionGroups: groups });
    const twenty = [{ itemId: "pizza", quantity: 20, selections: [{ groupId: "size", choiceIds: ["l"] }] }];
    const result = await call(body({ lines: twenty, expectedTotalCents: 50_150 }));
    expect(asError(result.body).code).toBe("order_too_large");
    expect(asError(result.body).quote?.totalCents).toBe(50_150);
  });
});

/* ========================================================================== */

describe("αλλαγή ποσού → ρητή επανεπιβεβαίωση", () => {
  it("αύξηση προσαύξησης μετά την προσθήκη → price_changed με νέα σύνοψη, καμία παραγγελία", async () => {
    const groups = pizzaGroups();
    groups[1].choices[0].priceDelta = 0.9; // τυρί 0,50 → 0,90
    db.setItem("pizza-roma", "pizza", { name: "Πίτσα του σεφ", price: 5, optionGroups: groups });

    const result = await call(body());
    expect(result.status).toBe(409);
    const error = asError(result.body);
    expect(error.code).toBe("price_changed");
    expect(error.quote?.totalCents).toBe(2 * 690 + 150);
    expect(error.quote?.lines[0].options?.find((option) => option.choiceId === "cheese")?.priceDeltaCents).toBe(90);
    expect(db.orders).toHaveLength(0);

    /* Ο πελάτης επιβεβαιώνει ρητά το νέο σύνολο (νέο κλειδί) → παραγγελία */
    const confirmed = await call(body({ expectedTotalCents: 1530 }));
    expect(confirmed.status).toBe(201);
  });
});

describe("idempotency με επιλογές", () => {
  it("ίδιο κλειδί, ίδιες επιλογές σε άλλη σειρά → επανάληψη της ΙΔΙΑΣ παραγγελίας", async () => {
    const first = body();
    const created = await call(first);
    const retry = await call({ ...first, lines: [{ itemId: "pizza", quantity: 2, selections: [...LARGE_CHEESE_NO_ONION].reverse() }] });
    expect(retry.status).toBe(200);
    expect(asSuccess(retry.body)).toMatchObject({ replayed: true, orderId: asSuccess(created.body).orderId });
    expect(db.orders).toHaveLength(1);
  });

  it("ίδιο κλειδί, ΑΛΛΕΣ επιλογές → idempotency_key_reused, καμία δεύτερη παραγγελία", async () => {
    const first = body();
    await call(first);
    const changed = await call({
      ...first,
      lines: [{ itemId: "pizza", quantity: 2, selections: [{ groupId: "size", choiceIds: ["s"] }] }],
    });
    expect(changed.status).toBe(409);
    expect(asError(changed.body).code).toBe("idempotency_key_reused");
    expect(db.orders).toHaveLength(1);
  });

  it("canonicalRequestHash: ανεξάρτητο από τη σειρά, εξαρτάται από τις επιλογές", () => {
    const hash = (lines: unknown) => {
      const validation = validateCheckoutRequest(body({ idempotencyKey: "fixed-key-1234567890", lines }));
      if (!validation.ok) throw new Error(JSON.stringify(validation.fieldErrors));
      return canonicalRequestHash(validation.value);
    };
    const a = hash([{ itemId: "cola", quantity: 1 }, { itemId: "pizza", quantity: 2, selections: LARGE_CHEESE_NO_ONION }]);
    const b = hash([{ itemId: "pizza", quantity: 2, selections: [...LARGE_CHEESE_NO_ONION].reverse() }, { itemId: "cola", quantity: 1 }]);
    const c = hash([{ itemId: "cola", quantity: 1 }, { itemId: "pizza", quantity: 2, selections: [{ groupId: "size", choiceIds: ["l"] }] }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("επανάληψη ΜΕΤΑ από αλλαγή καταλόγου → η αρχική απάντηση (δεν ξανατιμολογεί)", async () => {
    const first = body();
    const created = await call(first);

    // Η επιλογή καταργείται και η τιμή αλλάζει — η επανάληψη ΔΕΝ αποτυγχάνει
    db.setItem("pizza-roma", "pizza", { name: "Νέα πίτσα", price: 9, optionGroups: [] });
    const retry = await call(first);
    expect(retry.status).toBe(200);
    expect(asSuccess(retry.body)).toMatchObject({
      replayed: true,
      orderId: asSuccess(created.body).orderId,
      totalCents: 1450,
    });
    expect(asSuccess(retry.body).lines[0].options?.[0].label).toBe("Μεγάλη");
  });

  it("ανάκτηση μετά από ανανέωση: επιστρέφει το στιγμιότυπο επιλογών της παραγγελίας", async () => {
    const first = body();
    await call(first);
    db.setItem("pizza-roma", "pizza", { name: "Νέα", price: 9 });

    const recovered = await handleAttemptRecovery(deps, {
      authorization: "Bearer uid-cust",
      rawBody: JSON.stringify({ idempotencyKey: first.idempotencyKey }),
    });
    expect(recovered.status).toBe(200);
    const result = recovered.body as CheckoutRecoveryResult;
    expect(result.ok && result.outcome).toBe("order_found");
    if (result.ok && result.outcome === "order_found") {
      expect(lineKeyOf(result.order.lines[0])).toBe("pizza|extras:cheese;size:l;without:onion");
      expect(result.order.lines[0].unitPriceCents).toBe(650);
    }
  });

  it("κλειστή προσπάθεια με επιλογές δεν δημιουργεί ποτέ καθυστερημένη παραγγελία", async () => {
    const first = body();
    const closed = await handleAttemptRecovery(deps, {
      authorization: "Bearer uid-cust",
      rawBody: JSON.stringify({ idempotencyKey: first.idempotencyKey }),
    });
    expect((closed.body as CheckoutRecoveryResult).ok && (closed.body as { outcome: string }).outcome).toBe("no_order");
    const late = await call(first);
    expect(asError(late.body).code).toBe("checkout_attempt_closed");
    expect(db.orders).toHaveLength(0);
  });
});
