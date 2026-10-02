import { describe, expect, it, vi } from "vitest";

const firebaseMock = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  ensureSignedIn: vi.fn(async () => "new-anon"),
}));
vi.mock("@/lib/firebase", () => firebaseMock);

import { RECOVERY_ENDPOINT, recoverCheckoutAttempt } from "@/lib/checkout/recover-attempt";
import { submitOrder } from "@/lib/checkout/submit-order";
import type { CheckoutRequest, CheckoutSuccess } from "@/types";

const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";

const order: CheckoutSuccess = {
  ok: true,
  orderId: "abc123xyz",
  code: "BK-ABC123",
  status: "pending",
  paymentMethod: "cash_on_delivery",
  address: "Ερμού 5, Τρίκαλα",
  replayed: true,
  shopId: "pizza-roma",
  shopName: "Pizza Roma",
  lines: [{ itemId: "pr-2", name: "Margherita", quantity: 1, unitPrice: 8.5, lineTotal: 8.5, unitPriceCents: 850, lineTotalCents: 850 }],
  subtotal: 8.5,
  deliveryFee: 1.5,
  total: 10,
  subtotalCents: 850,
  deliveryFeeCents: 150,
  totalCents: 1000,
  shopTerms: { minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 },
};

const identity = (uid = "anon-1") => async () => ({ uid, token: "id-token" });
const reply = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => Response.json(body, { status }));

describe("recoverCheckoutAttempt (browser)", () => {
  it("στέλνει ΜΟΝΟ το κλειδί, με Bearer token, στο endpoint ανάκτησης", async () => {
    const fetchImpl = reply(200, { ok: true, outcome: "no_order" });
    const outcome = await recoverCheckoutAttempt({ uid: "anon-1", key: KEY }, { fetchImpl, getIdentity: identity() });
    expect(outcome).toEqual({ kind: "no_order" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(RECOVERY_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ idempotencyKey: KEY });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
  });

  it("βρέθηκε → η πλήρης απάντηση του server", async () => {
    const outcome = await recoverCheckoutAttempt(
      { uid: "anon-1", key: KEY },
      { fetchImpl: reply(200, { ok: true, outcome: "order_found", order }), getIdentity: identity() },
    );
    expect(outcome).toEqual({ kind: "order_found", order });
  });

  it("άλλος uid συνδεδεμένος → identity_mismatch, ΚΑΝΕΝΑ αίτημα", async () => {
    const fetchImpl = reply(200, { ok: true, outcome: "no_order" });
    const outcome = await recoverCheckoutAttempt({ uid: "anon-1", key: KEY }, { fetchImpl, getIdentity: identity("user-2") });
    expect(outcome).toEqual({ kind: "identity_mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("κανένας χρήστης → ΔΕΝ κάνει νέο anonymous sign-in", async () => {
    firebaseMock.auth.currentUser = null;
    const fetchImpl = reply(200, { ok: true, outcome: "no_order" });
    const outcome = await recoverCheckoutAttempt({ uid: "anon-1", key: KEY }, { fetchImpl });
    expect(outcome).toEqual({ kind: "identity_mismatch" });
    expect(firebaseMock.ensureSignedIn).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["δίκτυο", vi.fn<typeof fetch>(async () => { throw new TypeError("Failed to fetch"); })],
    ["500", reply(500, { ok: false, code: "internal_error", message: "x" })],
    ["HTML", vi.fn<typeof fetch>(async () => new Response("<html>", { status: 502 }))],
    ["κακόμορφη επιτυχία", reply(200, { ok: true, outcome: "order_found", order: { orderId: "x" } })],
  ])("%s → failed (άγνωστο, όχι «καμία παραγγελία»)", async (_label, fetchImpl) => {
    const outcome = await recoverCheckoutAttempt({ uid: "anon-1", key: KEY }, { fetchImpl, getIdentity: identity() });
    expect(outcome.kind).toBe("failed");
  });

  it("400 validation_failed → invalid", async () => {
    const outcome = await recoverCheckoutAttempt(
      { uid: "anon-1", key: KEY },
      { fetchImpl: reply(400, { ok: false, code: "validation_failed", message: "x" }), getIdentity: identity() },
    );
    expect(outcome).toEqual({ kind: "invalid" });
  });
});

describe("submitOrder — καταγραφή προσπάθειας πριν την αποστολή", () => {
  const request: CheckoutRequest = {
    idempotencyKey: KEY,
    shopId: "pizza-roma",
    customer: { fullName: "Κώστας", phone: "6912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "pr-2", quantity: 1 }],
    expectedTotalCents: 1000,
  };

  it("onBeforeSend καλείται με τον uid ΠΡΙΝ το fetch", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      order.push("fetch");
      throw new TypeError("offline");
    });
    await submitOrder(request, {
      fetchImpl,
      getIdToken: async () => "t",
      getUid: () => "anon-1",
      onBeforeSend: (uid) => order.push(`before:${uid}`),
    }).catch(() => undefined);
    expect(order).toEqual(["before:anon-1", "fetch"]);
  });

  it("αποτυχία ταυτοποίησης → τίποτα δεν καταγράφεται, τίποτα δεν στέλνεται", async () => {
    const onBeforeSend = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    await submitOrder(request, {
      fetchImpl,
      getIdToken: async () => {
        throw new Error("no auth");
      },
      onBeforeSend,
    }).catch(() => undefined);
    expect(onBeforeSend).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("σφάλμα στο onBeforeSend (π.χ. γεμάτο storage) δεν μπλοκάρει την αποστολή", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ...order, replayed: false }, { status: 201 }));
    const result = await submitOrder(request, {
      fetchImpl,
      getIdToken: async () => "t",
      getUid: () => "anon-1",
      onBeforeSend: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(result.orderId).toBe("abc123xyz");
  });
});
