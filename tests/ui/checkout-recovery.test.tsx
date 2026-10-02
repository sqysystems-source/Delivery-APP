// @vitest-environment jsdom
/* ==========================================================================
 *  Checkout — ανάκτηση μετά από αβέβαιη αποστολή / ανανέωση (milestone 2)
 *
 *  Πραγματικά: CartProvider (localStorage), CheckoutClient, αποθήκευση
 *  προσπάθειας και τελευταίας παραγγελίας.
 *  Ψεύτικα: AuthContext, submitOrder (δίκτυο), recoverCheckoutAttempt (δίκτυο).
 *  Ο server της ανάκτησης δοκιμάζεται στο tests/server/checkout-recovery.test.ts.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutRequest, CheckoutSuccess } from "@/types";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  authState: { user: null as null | { uid: string; isAnonymous: boolean } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/checkout",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: h.authState.user,
    profile: null,
    isAuthenticated: h.authState.user !== null && !h.authState.user.isAnonymous,
    isAnonymous: h.authState.user?.isAnonymous ?? false,
    loading: false,
    profileLoading: false,
    openLogin: vi.fn(),
  }),
}));

type SubmitOptions = { onBeforeSend?: (uid: string) => void };
const submitOrderMock = vi.fn<(request: CheckoutRequest, options?: SubmitOptions) => Promise<CheckoutSuccess>>();
vi.mock("@/lib/checkout/submit-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/submit-order")>();
  return {
    ...actual,
    submitOrder: (request: CheckoutRequest, options?: SubmitOptions) => submitOrderMock(request, options),
  };
});

const recoverMock = vi.fn<(attempt: { uid: string; key: string }) => Promise<unknown>>();
vi.mock("@/lib/checkout/recover-attempt", () => ({
  recoverCheckoutAttempt: (attempt: { uid: string; key: string }) => recoverMock(attempt),
}));

import CheckoutClient from "@/components/checkout/CheckoutClient";
import { CartProvider } from "@/context/CartContext";
import { CHECKOUT_ATTEMPT_STORAGE_KEY, readCheckoutAttempts } from "@/lib/checkout/checkout-attempt";
import { CheckoutError } from "@/lib/checkout/submit-order";
import { LAST_ORDER_STORAGE_KEY, readLastOrderFor } from "@/lib/orders/last-order";

/* ------------------------------ Δεδομένα -------------------------------- */

const CART_KEY = "buka:cart:v1";
const shop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };
const OLD_KEY = "11111111-2222-4333-8444-555555555555";

function seedCart() {
  window.localStorage.setItem(
    CART_KEY,
    JSON.stringify({ shop, lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1 }] }),
  );
}

function seedAttempt(uid: string, key = OLD_KEY, startedAt = Date.now() - 60_000) {
  window.localStorage.setItem(
    CHECKOUT_ATTEMPT_STORAGE_KEY,
    JSON.stringify({ v: 1, attempts: [{ uid, key, startedAt }] }),
  );
}

const success = (overrides: Partial<CheckoutSuccess> = {}): CheckoutSuccess => ({
  ok: true,
  orderId: "srv0rder42xyz",
  code: "BK-SRV0RD",
  status: "pending",
  paymentMethod: "cash_on_delivery",
  address: "Ερμού 5, Τρίκαλα",
  replayed: false,
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
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const renderCheckout = () =>
  render(
    <CartProvider>
      <CheckoutClient />
    </CartProvider>,
  );

const field = (name: string) => document.getElementById(`checkout-${name}`) as HTMLInputElement;
function fillValid() {
  for (const [name, value] of Object.entries({
    fullName: "Κώστας Παπαδόπουλος",
    phone: "691 234 5678",
    street: "Ερμού 5",
    city: "Τρίκαλα",
  })) {
    fireEvent.change(field(name), { target: { value } });
  }
}
const submitButton = () => screen.getByRole("button", { name: /Ολοκλήρωση παραγγελίας/ }) as HTMLButtonElement;
async function submit() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

/** Η αποστολή «φτάνει» στον server (καταγράφει την προσπάθεια) αλλά η απάντηση χάνεται */
function lostResponse() {
  return async (_request: CheckoutRequest, options?: SubmitOptions) => {
    options?.onBeforeSend?.("anon-1");
    throw new CheckoutError({ code: "network_error", status: 0, message: "Δεν λάβαμε επιβεβαίωση.", uncertain: true });
  };
}

beforeEach(() => {
  window.localStorage.clear();
  submitOrderMock.mockReset();
  recoverMock.mockReset();
  h.push.mockReset();
  h.authState.user = { uid: "anon-1", isAnonymous: true };
});

afterEach(() => cleanup());

/* ================================ Tests ================================= */

describe("επιτυχία → παρακολούθηση", () => {
  it("κουμπί «Παρακολούθηση παραγγελίας» με το orderId του SERVER· η οθόνη μένει μέχρι επιλογή", async () => {
    seedCart();
    submitOrderMock.mockImplementation(async (_request, options) => {
      options?.onBeforeSend?.("anon-1");
      return success();
    });

    renderCheckout();
    fillValid();
    await submit();

    expect(await screen.findByRole("heading", { name: /Η παραγγελία στάλθηκε/ })).toBeTruthy();
    const track = screen.getByRole("link", { name: /Παρακολούθηση παραγγελίας/ });
    expect(track.getAttribute("href")).toBe("/orders/srv0rder42xyz");
    expect(h.push).not.toHaveBeenCalled();

    // Η προσπάθεια λύθηκε· η τελευταία παραγγελία κρατήθηκε για ΑΥΤΟΝ τον uid μόνο
    expect(readCheckoutAttempts()).toEqual([]);
    expect(readLastOrderFor("anon-1")?.orderId).toBe("srv0rder42xyz");
    expect(readLastOrderFor("someone-else")).toBeNull();
    const stored = Object.values({ ...window.localStorage }).join(" ");
    expect(stored).not.toContain("6912345678");
    expect(stored).not.toContain("Ερμού");
    expect(window.localStorage.getItem(LAST_ORDER_STORAGE_KEY)).not.toContain("Pizza");
  });
});

describe("καταγραφή προσπάθειας", () => {
  it("πριν φύγει το αίτημα καταγράφεται ΜΟΝΟ { uid, κλειδί, ώρα }", async () => {
    seedCart();
    const pending = deferred<CheckoutSuccess>();
    submitOrderMock.mockImplementation(async (_request, options) => {
      options?.onBeforeSend?.("anon-1");
      return pending.promise;
    });

    renderCheckout();
    fillValid();
    await submit();

    const [request] = submitOrderMock.mock.calls[0];
    expect(readCheckoutAttempts()).toEqual([
      { uid: "anon-1", key: request.idempotencyKey, startedAt: expect.any(Number) },
    ]);
    expect(window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).not.toMatch(/Κώστας|691|Ερμού/);
    // Η σελίδα που έστειλε ΔΕΝ ελέγχει τη δική της προσπάθεια σε εξέλιξη
    expect(recoverMock).not.toHaveBeenCalled();

    await act(async () => pending.resolve(success()));
  });
});

describe("πρώτη παραγγελία επισκέπτη (χωρίς session πριν την αποστολή)", () => {
  it("ο νέος ανώνυμος uid της ΙΔΙΑΣ σελίδας δεν εμφανίζεται ως «άλλη σύνδεση»", async () => {
    seedCart();
    h.authState.user = null; // το anonymous sign-in γίνεται μέσα στο submitOrder
    const pending = deferred<CheckoutSuccess>();
    submitOrderMock.mockImplementation(async (_request, options) => {
      options?.onBeforeSend?.("anon-new");
      return pending.promise;
    });

    renderCheckout();
    fillValid();
    await submit();
    expect(readCheckoutAttempts().map((entry) => entry.uid)).toEqual(["anon-new"]);
    expect(screen.queryByText(/άλλη σύνδεση/)).toBeNull();
    expect(recoverMock).not.toHaveBeenCalled();

    await act(async () => pending.resolve(success()));
    expect(readCheckoutAttempts()).toEqual([]);
    expect(readLastOrderFor("anon-new")?.orderId).toBe("srv0rder42xyz");
  });
});

describe("ανανέωση μετά από αβέβαιη αποστολή", () => {
  it("η παραγγελία είχε δημιουργηθεί → ανάκτηση της ΑΡΧΙΚΗΣ, καμία νέα αποστολή", async () => {
    seedCart();
    submitOrderMock.mockImplementation(lostResponse());

    const first = renderCheckout();
    fillValid();
    await submit();
    const [lostRequest] = submitOrderMock.mock.calls[0];
    expect(await screen.findByRole("alert")).toBeTruthy();
    first.unmount(); // ← ανανέωση σελίδας: η μνήμη χάνεται, μένει μόνο το storage

    const check = deferred<unknown>();
    recoverMock.mockReturnValue(check.promise);
    renderCheckout();

    // Έλεγχος με το ΠΑΛΙΟ κλειδί και τον ΙΔΙΟ uid — ΟΧΙ νέα παραγγελία
    await waitFor(() => expect(recoverMock).toHaveBeenCalledWith({ uid: "anon-1", key: lostRequest.idempotencyKey, startedAt: expect.any(Number) }));
    expect(screen.getByText(/Ελέγχουμε αν καταχωρήθηκε η προηγούμενη παραγγελία σου/)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    fillValid();
    await submit();
    expect(submitOrderMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      check.resolve({ kind: "order_found", order: success({ orderId: "lost0rder1xyz", code: "BK-LOST0R", replayed: true }) }),
    );

    expect(await screen.findByRole("heading", { name: "Η παραγγελία σου είχε καταχωρηθεί" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Παρακολούθηση παραγγελίας/ }).getAttribute("href")).toBe("/orders/lost0rder1xyz");
    expect(screen.queryByText("Σε αναμονή αποδοχής")).toBeNull(); // ίσως έχει ήδη αλλάξει
    expect(submitOrderMock).toHaveBeenCalledTimes(1);
    expect(readCheckoutAttempts()).toEqual([]);
    expect(readLastOrderFor("anon-1")?.orderId).toBe("lost0rder1xyz");
    // Τα προϊόντα της ανακτημένης παραγγελίας φεύγουν από το καλάθι
    expect(window.localStorage.getItem(CART_KEY)).toBeNull();
  });

  it("δεν είχε δημιουργηθεί → οριστικό «καμία παραγγελία», νέα υποβολή με ΝΕΟ κλειδί → μία παραγγελία", async () => {
    seedCart();
    seedAttempt("anon-1");
    recoverMock.mockResolvedValue({ kind: "no_order" });
    submitOrderMock.mockImplementation(async (_request, options) => {
      options?.onBeforeSend?.("anon-1");
      return success();
    });

    renderCheckout();
    expect(await screen.findByText(/δεν είχε καταχωρηθεί παραγγελία, και πλέον δεν μπορεί να καταχωρηθεί/)).toBeTruthy();
    expect(submitOrderMock).not.toHaveBeenCalled();
    expect(readCheckoutAttempts()).toEqual([]);

    fillValid();
    await submit();
    expect(submitOrderMock).toHaveBeenCalledTimes(1);
    expect(submitOrderMock.mock.calls[0][0].idempotencyKey).not.toBe(OLD_KEY);
    expect(recoverMock).toHaveBeenCalledTimes(1);
  });

  it("αποτυχία ελέγχου → η υποβολή μένει κλειδωμένη· «Έλεγχος ξανά»", async () => {
    seedCart();
    seedAttempt("anon-1");
    recoverMock
      .mockResolvedValueOnce({ kind: "failed", message: "Δεν μπορέσαμε να ελέγξουμε." })
      .mockResolvedValueOnce({ kind: "no_order" });

    renderCheckout();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Δεν μπορέσαμε να ελέγξουμε.");
    expect(submitButton().disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Έλεγχος ξανά/ }));
    });
    await waitFor(() => expect(recoverMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(submitOrderMock).not.toHaveBeenCalled();
  });

  it("προσπάθεια ΑΛΛΟΥ uid → κανένας έλεγχος, ρητή ειδοποίηση, «Κατάλαβα» την καθαρίζει", async () => {
    seedCart();
    seedAttempt("anon-old");
    h.authState.user = { uid: "user-2", isAnonymous: false };

    renderCheckout();
    expect(screen.getByText(/άλλη σύνδεση/)).toBeTruthy();
    expect(recoverMock).not.toHaveBeenCalled();
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Κατάλαβα" }));
    expect(screen.queryByText(/άλλη σύνδεση/)).toBeNull();
    expect(readCheckoutAttempts()).toEqual([]);
  });

  it("ληγμένη προσπάθεια (>6 ημέρες) → κανένας αυτόματος έλεγχος, ρητή ειδοποίηση", async () => {
    seedCart();
    seedAttempt("anon-1", OLD_KEY, Date.now() - 7 * 24 * 60 * 60 * 1000);
    recoverMock.mockResolvedValue({ kind: "no_order" });

    renderCheckout();
    expect(await screen.findByText(/παλιά προσπάθεια παραγγελίας/)).toBeTruthy();
    expect(recoverMock).not.toHaveBeenCalled();
    expect(readCheckoutAttempts()).toEqual([]);
    expect(submitOrderMock).not.toHaveBeenCalled();
  });
});

describe("ίδια σελίδα: αλλαγή μετά από αβέβαιη αποστολή", () => {
  it("το παλιό κλειδί είχε δημιουργήσει παραγγελία → εμφανίζεται αυτή, ΔΕΝ στέλνεται δεύτερη", async () => {
    seedCart();
    submitOrderMock.mockImplementationOnce(lostResponse());
    recoverMock.mockResolvedValue({ kind: "order_found", order: success({ orderId: "first0rder1x", replayed: true }) });

    renderCheckout();
    fillValid();
    await submit();
    fireEvent.change(field("doorbell"), { target: { value: "Παπαδόπουλος" } });
    await submit();

    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(submitOrderMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Η παραγγελία σου είχε καταχωρηθεί" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Παρακολούθηση παραγγελίας/ }).getAttribute("href")).toBe("/orders/first0rder1x");
  });

  it("έλεγχος αποτυγχάνει → ΔΕΝ στέλνεται νέα παραγγελία", async () => {
    seedCart();
    submitOrderMock.mockImplementationOnce(lostResponse());
    recoverMock.mockResolvedValue({ kind: "failed", message: "x" });

    renderCheckout();
    fillValid();
    await submit();
    fireEvent.change(field("doorbell"), { target: { value: "Παπαδόπουλος" } });
    await submit();

    expect(submitOrderMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("ΔΕΝ στείλαμε νέα παραγγελία");
  });

  it("checkout_attempt_closed από τον server → νέο κλειδί στην επόμενη επιβεβαίωση", async () => {
    seedCart();
    submitOrderMock
      .mockRejectedValueOnce(
        new CheckoutError({ code: "checkout_attempt_closed", status: 409, message: "Έκλεισε.", uncertain: false }),
      )
      .mockResolvedValueOnce(success());

    renderCheckout();
    fillValid();
    await submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Έκλεισε.");
    await submit();

    const [first, second] = submitOrderMock.mock.calls.map(([request]) => request);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
