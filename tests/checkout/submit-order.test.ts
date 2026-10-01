import { describe, expect, it, vi } from "vitest";

// Το πραγματικό lib/firebase αρχικοποιεί το Firebase SDK — δεν χρειάζεται εδώ
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn() }));

import { CHECKOUT_ENDPOINT, CheckoutError, submitOrder } from "@/lib/checkout/submit-order";
import type { CheckoutQuote, CheckoutRequest, CheckoutSuccess } from "@/types";

const request: CheckoutRequest = {
  idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
  shopId: "pizza-roma",
  customer: { fullName: "Κώστας", phone: "6912345678" },
  delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
  paymentMethod: "cash_on_delivery",
  lines: [{ itemId: "pr-2", quantity: 1 }],
  expectedTotalCents: 1000,
};

const quote: CheckoutQuote = {
  shopId: "pizza-roma",
  shopName: "Pizza Roma",
  lines: [
    { itemId: "pr-2", name: "Margherita", quantity: 1, unitPrice: 8.5, lineTotal: 8.5, unitPriceCents: 850, lineTotalCents: 850 },
  ],
  subtotal: 8.5,
  deliveryFee: 1.5,
  total: 10,
  subtotalCents: 850,
  deliveryFeeCents: 150,
  totalCents: 1000,
  shopTerms: { minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 },
};

const success: CheckoutSuccess = {
  ...quote,
  ok: true,
  orderId: "abc123",
  code: "BK-ABC123",
  status: "pending",
  paymentMethod: "cash_on_delivery",
  address: "Ερμού 5, Τρίκαλα",
  replayed: false,
};

const token = async () => "id-token";

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    typeof body === "string"
      ? new Response(body, { status, headers: { "Content-Type": "text/html" } })
      : Response.json(body, { status }),
  );
}

async function capture(promise: Promise<unknown>): Promise<CheckoutError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CheckoutError) return error;
    throw error;
  }
  throw new Error("αναμενόταν CheckoutError");
}

describe("submitOrder", () => {
  it("στέλνει ΜΟΝΟ το αίτημα με Bearer token και επιστρέφει την απάντηση του server", async () => {
    const fetchImpl = respond(201, success);
    const result = await submitOrder(request, { fetchImpl, getIdToken: token });

    expect(result).toEqual(success);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CHECKOUT_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it("409 price_changed → κρατά κωδικό, status, μήνυμα και νέα σύνοψη", async () => {
    const fetchImpl = respond(409, {
      ok: false,
      code: "price_changed",
      message: "Οι τιμές άλλαξαν.",
      quote: { ...quote, totalCents: 1100 },
    });
    const error = await capture(submitOrder(request, { fetchImpl, getIdToken: token }));
    expect(error).toMatchObject({ code: "price_changed", status: 409, message: "Οι τιμές άλλαξαν.", uncertain: false });
    expect(error.quote?.totalCents).toBe(1100);
  });

  it("400 validation_failed → λάθη ανά πεδίο", async () => {
    const fetchImpl = respond(400, {
      ok: false,
      code: "validation_failed",
      message: "Έλεγξε τα στοιχεία.",
      fieldErrors: { phone: "Μη έγκυρο τηλέφωνο." },
    });
    const error = await capture(submitOrder(request, { fetchImpl, getIdToken: token }));
    expect(error.code).toBe("validation_failed");
    expect(error.fieldErrors).toEqual({ phone: "Μη έγκυρο τηλέφωνο." });
    expect(error.uncertain).toBe(false);
  });

  it("409 idempotency_key_reused → κρατά την υπάρχουσα παραγγελία", async () => {
    const fetchImpl = respond(409, {
      ok: false,
      code: "idempotency_key_reused",
      message: "…",
      existingOrder: { orderId: "o1", code: "BK-O1" },
    });
    const error = await capture(submitOrder(request, { fetchImpl, getIdToken: token }));
    expect(error.existingOrder).toEqual({ orderId: "o1", code: "BK-O1" });
  });

  it("πτώση δικτύου → network_error, ΑΒΕΒΑΙΟ (ασφαλής επανάληψη με ίδιο κλειδί)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await capture(submitOrder(request, { fetchImpl, getIdToken: token }));
    expect(error).toMatchObject({ code: "network_error", status: 0, uncertain: true });
  });

  it("timeout → network_error, αβέβαιο", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const error = await capture(submitOrder(request, { fetchImpl, getIdToken: token, timeoutMs: 10 }));
    expect(error).toMatchObject({ code: "network_error", uncertain: true });
  });

  it("502 με HTML → invalid_response, αβέβαιο", async () => {
    const error = await capture(
      submitOrder(request, { fetchImpl: respond(502, "<html>Bad gateway</html>"), getIdToken: token }),
    );
    expect(error).toMatchObject({ code: "invalid_response", status: 502, uncertain: true });
  });

  it("500 internal_error → αβέβαιο", async () => {
    const error = await capture(
      submitOrder(request, {
        fetchImpl: respond(500, { ok: false, code: "internal_error", message: "Σφάλμα." }),
        getIdToken: token,
      }),
    );
    expect(error).toMatchObject({ code: "internal_error", status: 500, uncertain: true });
  });

  it("200 με ελλιπή απάντηση επιτυχίας → invalid_response (δεν δείχνουμε ψεύτικη επιτυχία)", async () => {
    const { orderId: _omit, ...partial } = success;
    void _omit;
    const error = await capture(submitOrder(request, { fetchImpl: respond(201, partial), getIdToken: token }));
    expect(error.code).toBe("invalid_response");
  });

  it("αποτυχία ταυτότητας → auth_failed, ΧΩΡΙΣ αίτημα, ΟΧΙ αβέβαιο", async () => {
    const fetchImpl = respond(201, success);
    const error = await capture(
      submitOrder(request, {
        fetchImpl,
        getIdToken: async () => {
          throw new Error("offline");
        },
      }),
    );
    expect(error).toMatchObject({ code: "auth_failed", uncertain: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
