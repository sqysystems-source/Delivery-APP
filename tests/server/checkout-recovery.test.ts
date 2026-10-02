/* ==========================================================================
 *  POST /api/orders/recover — λογική (handleAttemptRecovery) πάνω στο ίδιο
 *  in-memory store με σειριοποιήσιμες συναλλαγές.
 *
 *  ΠΡΟΣΟΧΗ: αποδεικνύει τη ΛΟΓΙΚΗ αν το Firestore δίνει σειριοποιήσιμες
 *  συναλλαγές και semantics `create`. Δεν αποδεικνύει τη συμπεριφορά του
 *  πραγματικού Firestore (αυτό θέλει emulator).
 * ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAttemptRecovery,
  handleCheckoutRequest,
  idempotencyRecordId,
  type CheckoutDeps,
} from "@/lib/server/checkout-service";
import type { CheckoutErrorBody, CheckoutRecoveryResult, CheckoutSuccess } from "@/types";
import { FakeCheckoutDb, SERVER_TIMESTAMP } from "./fake-checkout-store";

let db: FakeCheckoutDb;
let deps: CheckoutDeps;

const KEY = "attempt-key-0001-abcdefgh";

function body(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: KEY,
    shopId: "pizza-roma",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "691 234 5678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "pr-2", quantity: 1 }],
    expectedTotalCents: 1000,
    ...overrides,
  };
}

const checkout = (payload: Record<string, unknown>, token = "uid-guest") =>
  handleCheckoutRequest(deps, { authorization: `Bearer ${token}`, rawBody: JSON.stringify(payload) });

const recover = (key: unknown = KEY, token: string | null = "uid-guest") =>
  handleAttemptRecovery(deps, {
    authorization: token === null ? null : `Bearer ${token}`,
    rawBody: JSON.stringify({ idempotencyKey: key }),
  });

beforeEach(() => {
  db = new FakeCheckoutDb();
  db.setShop("pizza-roma", { name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20, ownerUid: "owner-1" });
  db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 8.5 });
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

describe("ανάκτηση μετά από χαμένη απάντηση", () => {
  it("η παραγγελία δημιουργήθηκε αλλά η απάντηση χάθηκε → ανάκτηση της ΙΔΙΑΣ, καμία δεύτερη", async () => {
    const created = await checkout(body());
    expect(created.status).toBe(201);
    const original = created.body as CheckoutSuccess;

    // ... η απάντηση «χάνεται», ο πελάτης ανανεώνει, η σελίδα ρωτά με το κλειδί
    const result = await recover();
    expect(result.status).toBe(200);
    const recovered = result.body as Extract<CheckoutRecoveryResult, { outcome: "order_found" }>;
    expect(recovered.outcome).toBe("order_found");
    expect(recovered.order).toMatchObject({
      orderId: original.orderId,
      code: original.code,
      total: 10,
      status: "pending",
      replayed: true,
    });
    expect(db.orders).toHaveLength(1);

    // Ο έλεγχος είναι idempotent
    expect(((await recover()).body as CheckoutRecoveryResult).outcome).toBe("order_found");
    expect(db.orders).toHaveLength(1);
  });

  it("δεν δημιουργήθηκε παραγγελία → «no_order» ΚΑΙ το κλειδί κλείνει για πάντα", async () => {
    const result = await recover();
    expect(result.body).toEqual({ ok: true, outcome: "no_order" });
    expect(db.records).toHaveLength(1);
    expect(db.records[0][1]).toMatchObject({ uid: "guest", state: "closed" });

    // Το αρχικό αίτημα φτάνει ΑΡΓΟΤΕΡΑ (π.χ. αργό δίκτυο) → καμία παραγγελία
    const late = await checkout(body());
    expect(late.status).toBe(409);
    expect((late.body as CheckoutErrorBody).code).toBe("checkout_attempt_closed");
    expect(db.orders).toHaveLength(0);

    // Νέα προσπάθεια με ΝΕΟ κλειδί → ακριβώς μία παραγγελία
    const fresh = await checkout(body({ idempotencyKey: "attempt-key-0002-abcdefgh" }));
    expect(fresh.status).toBe(201);
    expect(db.orders).toHaveLength(1);

    // Ο ίδιος έλεγχος ξανά → ίδια απάντηση
    expect((await recover()).body).toEqual({ ok: true, outcome: "no_order" });
  });

  it("ταυτόχρονα: αρχικό αίτημα και έλεγχος για το ίδιο κλειδί → ή παραγγελία ή κλείσιμο, ΠΟΤΕ και τα δύο", async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 10; round += 1) {
      db = new FakeCheckoutDb();
      db.setShop("pizza-roma", { name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 });
      db.setItem("pizza-roma", "pr-2", { name: "Margherita", price: 8.5 });
      deps = { ...deps, store: db.store(), now: () => db.nowMs };

      // Ο έλεγχος ξεκινά με διαφορετική καθυστέρηση (σε macrotasks) σε κάθε γύρο,
      // ώστε να διαπλέκεται σε διαφορετικό σημείο της συναλλαγής του αιτήματος
      const delayedRecover = async () => {
        for (let tick = 0; tick < round; tick += 1) await new Promise((r) => setTimeout(r, 0));
        return recover();
      };
      const [order, check] = await Promise.all([checkout(body()), delayedRecover()]);
      outcomes.add(order.status === 201 ? "order" : "closed");
      const outcome = (check.body as CheckoutRecoveryResult).outcome;

      if (order.status === 201) {
        expect(outcome).toBe("order_found");
        expect(db.orders).toHaveLength(1);
      } else {
        expect((order.body as CheckoutErrorBody).code).toBe("checkout_attempt_closed");
        expect(outcome).toBe("no_order");
        expect(db.orders).toHaveLength(0);
      }
      expect(db.records).toHaveLength(1);
    }
    // Και οι δύο δρόμοι εξετάστηκαν πραγματικά
    expect([...outcomes].sort()).toEqual(["closed", "order"]);
  });
});

describe("ιδιοκτησία και επικύρωση", () => {
  it("άλλος χρήστης με το ΙΔΙΟ κλειδί δεν βλέπει την παραγγελία ούτε κλείνει την προσπάθεια", async () => {
    await checkout(body());
    const other = await recover(KEY, "uid-someone-else");
    // Για τον άλλο uid απλώς «δεν υπάρχει» — κλείνει ΜΟΝΟ το δικό του (άλλο έγγραφο)
    expect(other.body).toEqual({ ok: true, outcome: "no_order" });
    expect(JSON.stringify(other.body)).not.toContain("BK-");
    expect(db.records.map(([id]) => id).sort()).toEqual(
      [idempotencyRecordId("guest", KEY), idempotencyRecordId("someone-else", KEY)].sort(),
    );
    // Η παραγγελία του αρχικού χρήστη ανακτάται κανονικά
    expect(((await recover()).body as CheckoutRecoveryResult).outcome).toBe("order_found");
  });

  it("χωρίς ή με άκυρο token → 401, καμία εγγραφή", async () => {
    expect((await recover(KEY, null)).status).toBe(401);
    expect((await recover(KEY, "garbage")).status).toBe(401);
    expect(db.records).toHaveLength(0);
  });

  it("το uid του σώματος αγνοείται — ταυτότητα μόνο από το token", async () => {
    await checkout(body());
    const result = await handleAttemptRecovery(deps, {
      authorization: "Bearer uid-attacker",
      rawBody: JSON.stringify({ idempotencyKey: KEY, uid: "guest", userId: "guest" }),
    });
    expect(result.body).toEqual({ ok: true, outcome: "no_order" });
  });

  it.each([["short"], ["../../x-abcdefghijklmnop"], [123], [null]])("άκυρο κλειδί %j → 400", async (key) => {
    const result = await recover(key);
    expect(result.status).toBe(400);
    expect((result.body as CheckoutErrorBody).code).toBe("validation_failed");
    expect(db.records).toHaveLength(0);
  });

  it("άκυρο JSON / πολύ μεγάλο σώμα", async () => {
    expect(
      (await handleAttemptRecovery(deps, { authorization: "Bearer uid-guest", rawBody: "{" })).status,
    ).toBe(400);
    expect(
      (await handleAttemptRecovery(deps, { authorization: "Bearer uid-guest", rawBody: "x".repeat(2000) })).status,
    ).toBe(413);
  });

  it("σφάλμα βάσης → 500 χωρίς εσωτερικές λεπτομέρειες", async () => {
    deps = {
      ...deps,
      store: { ...db.store(), getIdempotencyRecord: async () => { throw new Error("secret detail"); } },
    };
    const result = await recover();
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});

describe("συμβατότητα με εγγραφές του milestone 1", () => {
  it("εγγραφή χωρίς πεδίο `state` διαβάζεται ως ολοκληρωμένη (replay)", async () => {
    const created = await checkout(body());
    const [recordId, record] = db.records[0];
    expect(record).not.toHaveProperty("state");
    expect(recordId).toBe(idempotencyRecordId("guest", KEY));
    const replay = await checkout(body());
    expect(replay.status).toBe(200);
    expect((replay.body as CheckoutSuccess).orderId).toBe((created.body as CheckoutSuccess).orderId);
  });
});
