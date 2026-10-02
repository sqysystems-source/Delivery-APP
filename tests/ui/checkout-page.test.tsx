// @vitest-environment jsdom
/* ==========================================================================
 *  Σελίδα checkout — δοκιμές συμπεριφοράς στο jsdom.
 *
 *  Πραγματικά: CartProvider (με localStorage), CheckoutClient, φόρμα,
 *  επικύρωση, κλειδιά idempotency, σύνοψη.
 *  Ψεύτικα: Firebase / AuthContext, next/navigation, next/link και το
 *  δίκτυο (submitOrder) — ο server δοκιμάζεται χωριστά.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutQuote, CheckoutRequest, CheckoutSuccess } from "@/types";

/* ------------------------------- Mocks ---------------------------------- */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
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

type AuthState = {
  user: { uid: string; isAnonymous: boolean } | null;
  profile: unknown;
  isAuthenticated: boolean;
};
const authState: AuthState = { user: null, profile: null, isAuthenticated: false };
const openLogin = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    ...authState,
    isAnonymous: authState.user?.isAnonymous ?? false,
    loading: false,
    profileLoading: false,
    authMode: null,
    openLogin,
    openRegister: vi.fn(),
    closeAuth: vi.fn(),
    switchMode: vi.fn(),
    logout: vi.fn(),
    displayName: "",
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

/* Milestone 2: έλεγχος αβέβαιης προσπάθειας — ψεύτικος, ο server δοκιμάζεται χωριστά */
const recoverMock = vi.fn<(attempt: { uid: string; key: string }) => Promise<unknown>>();
vi.mock("@/lib/checkout/recover-attempt", () => ({
  recoverCheckoutAttempt: (attempt: { uid: string; key: string }) => recoverMock(attempt),
}));

import CheckoutClient from "@/components/checkout/CheckoutClient";
import { CartProvider } from "@/context/CartContext";
import { CheckoutError } from "@/lib/checkout/submit-order";

/* ------------------------------ Δεδομένα -------------------------------- */

const CART_KEY = "buka:cart:v1";
const shop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };

function seedCart(lines = [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1 }]) {
  window.localStorage.setItem(CART_KEY, JSON.stringify({ shop, lines }));
}

function quote(unitPrice: number, quantity = 1, deliveryFee = 1.5): CheckoutQuote {
  const unitPriceCents = Math.round(unitPrice * 100);
  const subtotalCents = unitPriceCents * quantity;
  const feeCents = Math.round(deliveryFee * 100);
  return {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    lines: [
      {
        itemId: "pr-2",
        name: "Margherita",
        quantity,
        unitPrice,
        lineTotal: subtotalCents / 100,
        unitPriceCents,
        lineTotalCents: subtotalCents,
      },
    ],
    subtotal: subtotalCents / 100,
    deliveryFee,
    total: (subtotalCents + feeCents) / 100,
    subtotalCents,
    deliveryFeeCents: feeCents,
    totalCents: subtotalCents + feeCents,
    shopTerms: { minOrder: 8, deliveryFee, freeDeliveryOver: 20 },
  };
}

function successFrom(q: CheckoutQuote, overrides: Partial<CheckoutSuccess> = {}): CheckoutSuccess {
  return {
    ...q,
    ok: true,
    orderId: "abc123xyz",
    code: "BK-ABC123",
    status: "pending",
    paymentMethod: "cash_on_delivery",
    address: "Ερμού 5, Τρίκαλα",
    replayed: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* ------------------------------ Βοηθητικά ------------------------------- */

function renderCheckout() {
  return render(
    <CartProvider>
      <CheckoutClient />
    </CartProvider>,
  );
}

const field = (name: string) => document.getElementById(`checkout-${name}`) as HTMLInputElement;

function fill(values: Partial<Record<string, string>>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(field(name), { target: { value } });
  }
}

const validGuest = { fullName: "Κώστας Παπαδόπουλος", phone: "691 234 5678", street: "Ερμού 5", city: "Τρίκαλα" };

const submitButton = () => screen.getByRole("button", { name: /Ολοκλήρωση παραγγελίας|Επιβεβαίωση νέου συνόλου/ });

async function submit() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

beforeEach(() => {
  window.localStorage.clear();
  submitOrderMock.mockReset();
  recoverMock.mockReset();
  recoverMock.mockResolvedValue({ kind: "no_order" });
  push.mockReset();
  authState.user = null;
  authState.profile = null;
  authState.isAuthenticated = false;
});

afterEach(() => cleanup());

/* ================================ Tests ================================= */

describe("σελίδα checkout", () => {
  it("στον server/πριν το hydration δείχνει σκελετό — ΟΧΙ «άδειο καλάθι» ή ανακατεύθυνση", () => {
    seedCart();
    const html = renderToString(
      <CartProvider>
        <CheckoutClient />
      </CartProvider>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Το καλάθι σου είναι άδειο");
    expect(push).not.toHaveBeenCalled();
  });

  it("άμεση επίσκεψη με άδειο καλάθι → μήνυμα, χωρίς ανακατεύθυνση", () => {
    renderCheckout();
    expect(screen.getByRole("heading", { name: "Το καλάθι σου είναι άδειο" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("χαλασμένο αποθηκευμένο καλάθι → άδειο καλάθι, χωρίς σφάλμα", () => {
    window.localStorage.setItem(CART_KEY, '{"shop":{"id":"shops/evil"},"lines":[{}]}');
    renderCheckout();
    expect(screen.getByRole("heading", { name: "Το καλάθι σου είναι άδειο" })).toBeTruthy();
  });

  it("επισκέπτης: σωστή φόρμα → ένα αίτημα ΧΩΡΙΣ τιμές, επιτυχία από τις τιμές του server", async () => {
    seedCart();
    // Ο server επιστρέφει δικά του ονόματα/σύνολα — αυτά πρέπει να φανούν
    const serverQuote = { ...quote(8.5), shopName: "Pizza Roma Τρικάλων" };
    serverQuote.lines[0].name = "Margherita (κατάστημα)";
    submitOrderMock.mockResolvedValue(successFrom(serverQuote));

    renderCheckout();
    expect(screen.getByText(/Παραγγέλνεις ως επισκέπτης/)).toBeTruthy();
    expect(screen.getByLabelText(/Ονοματεπώνυμο/)).toBe(field("fullName"));
    expect(field("fullName").getAttribute("autocomplete")).toBe("name");
    expect(field("phone").getAttribute("autocomplete")).toBe("tel");

    fill({ ...validGuest, floor: "2ος", doorbell: "Παπαδόπουλος", notes: "Χωρίς κρεμμύδι" });
    await submit();

    expect(submitOrderMock).toHaveBeenCalledTimes(1);
    const sent = submitOrderMock.mock.calls[0][0];
    expect(sent).toMatchObject({
      shopId: "pizza-roma",
      customer: { fullName: "Κώστας Παπαδόπουλος", phone: "691 234 5678" },
      delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος", doorbell: "Παπαδόπουλος" },
      notes: "Χωρίς κρεμμύδι",
      paymentMethod: "cash_on_delivery",
      lines: [{ itemId: "pr-2", quantity: 1 }],
      expectedTotalCents: 1000,
    });
    expect(JSON.stringify(sent)).not.toMatch(/unitPrice|"name"|Margherita|userId|status/);

    const heading = await screen.findByRole("heading", { name: /Η παραγγελία στάλθηκε/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(/Κωδικός: BK-ABC123/)).toBeTruthy();
    expect(screen.getByText("Σε αναμονή αποδοχής")).toBeTruthy();
    expect(screen.getByText(/Margherita \(κατάστημα\)/)).toBeTruthy();
    expect(screen.getByText(/Pizza Roma Τρικάλων/)).toBeTruthy();
    expect(screen.queryByText(/πληρώθηκε|έγινε αποδεκτή/i)).toBeNull();

    // Το καλάθι άδειασε· το τηλέφωνο δεν αποθηκεύτηκε πουθενά
    expect(window.localStorage.getItem(CART_KEY)).toBeNull();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("691");

    // Η επιτυχία μένει μέχρι να πατήσει «Συνέχεια»
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Συνέχεια" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("λάθη φόρμας → μηνύματα δίπλα στα πεδία, εστίαση στο πρώτο, ΚΑΝΕΝΑ αίτημα", async () => {
    seedCart();
    renderCheckout();
    fill({ phone: "123" });
    await submit();

    expect(submitOrderMock).not.toHaveBeenCalled();
    expect(field("fullName").getAttribute("aria-invalid")).toBe("true");
    expect(field("phone").getAttribute("aria-invalid")).toBe("true");
    const describedBy = field("phone").getAttribute("aria-describedby");
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field("fullName")));
  });

  it.each(["Κεντρική Πλατεία", "Σπίτι"])("απορρίπτει ενδεικτική / σκέτη ετικέτα διεύθυνση «%s»", async (street) => {
    seedCart();
    renderCheckout();
    fill({ ...validGuest, street });
    await submit();

    expect(submitOrderMock).not.toHaveBeenCalled();
    expect(field("street").getAttribute("aria-invalid")).toBe("true");
  });

  it("κάτω από την ελάχιστη → κουμπί απενεργοποιημένο με εξήγηση", () => {
    seedCart([{ itemId: "pr-8", name: "Coca-Cola", unitPrice: 2.8, quantity: 1 }]);
    renderCheckout();
    const button = submitButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("checkout-min-order");
    expect(document.getElementById("checkout-min-order")?.textContent).toMatch(/ελάχιστη παραγγελία/);
  });

  it("διπλή υποβολή στο ίδιο tick → ΕΝΑ αίτημα", async () => {
    seedCart();
    const pending = deferred<CheckoutSuccess>();
    submitOrderMock.mockReturnValue(pending.promise);

    renderCheckout();
    fill(validGuest);
    const form = field("fullName").closest("form") as HTMLFormElement;

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    // Όσο περιμένει: κουμπί απενεργοποιημένο, και ένα τρίτο submit αγνοείται
    const busy = screen.getByRole("button", { name: /Αποστολή/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(field("fullName").disabled).toBe(true);
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(submitOrderMock).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(successFrom(quote(8.5))));
    expect(await screen.findByRole("heading", { name: /Η παραγγελία στάλθηκε/ })).toBeTruthy();
  });

  it("αβέβαιη αποτυχία → το καλάθι μένει, «Δοκίμασε ξανά» στέλνει το ΙΔΙΟ κλειδί", async () => {
    seedCart();
    submitOrderMock
      .mockRejectedValueOnce(
        new CheckoutError({ code: "network_error", status: 0, message: "Δεν λάβαμε επιβεβαίωση.", uncertain: true }),
      )
      .mockResolvedValueOnce(successFrom(quote(8.5), { replayed: true }));

    renderCheckout();
    fill(validGuest);
    await submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Δεν λάβαμε επιβεβαίωση.");
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(window.localStorage.getItem(CART_KEY)).toContain("pr-2");

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: /Δοκίμασε ξανά/ }));
    });

    expect(submitOrderMock).toHaveBeenCalledTimes(2);
    const [first, second] = submitOrderMock.mock.calls.map(([request]) => request);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(await screen.findByRole("heading", { name: /Η παραγγελία στάλθηκε/ })).toBeTruthy();
  });

  it("αλλαγή στοιχείων μετά από αβέβαιη αποτυχία → πρώτα έλεγχος του παλιού κλειδιού, μετά ΝΕΟ κλειδί", async () => {
    seedCart();
    submitOrderMock
      .mockImplementationOnce(async (_request, options) => {
        options?.onBeforeSend?.("guest-uid");
        throw new CheckoutError({ code: "network_error", status: 0, message: "…", uncertain: true });
      })
      .mockResolvedValueOnce(successFrom(quote(8.5)));

    renderCheckout();
    fill(validGuest);
    await submit();
    fill({ notes: "Έξτρα σάλτσα" });
    await submit();

    const [first, second] = submitOrderMock.mock.calls.map(([request]) => request);
    // Ο έλεγχος έγινε για το ΠΑΛΙΟ κλειδί, με τον uid που το έστειλε, πριν φύγει το νέο
    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(recoverMock).toHaveBeenCalledWith({ uid: "guest-uid", key: first.idempotencyKey });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("οριστική αποτυχία (εξαντλημένο) → καλάθι ανέπαφο, επιλογή αφαίρεσης", async () => {
    seedCart();
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "item_unavailable",
        status: 409,
        message: "Το «Margherita» δεν είναι διαθέσιμο αυτή τη στιγμή.",
        uncertain: false,
        itemId: "pr-2",
      }),
    );

    renderCheckout();
    fill(validGuest);
    await submit();

    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: /Δοκίμασε ξανά/ })).toBeNull();
    expect(within(alert).getByRole("button", { name: "Αφαίρεση από το καλάθι" })).toBeTruthy();
    expect(window.localStorage.getItem(CART_KEY)).toContain("pr-2");
    expect(field("fullName").value).toBe(validGuest.fullName); // η φόρμα δεν χάθηκε
  });

  it("αλλαγή τιμής → ειδοποίηση, νέα σύνοψη, ρητή επανεπιβεβαίωση με νέο σύνολο και νέο κλειδί", async () => {
    seedCart();
    const newQuote = quote(9.5); // 9,50 + 1,50 = 11,00
    submitOrderMock
      .mockRejectedValueOnce(
        new CheckoutError({
          code: "price_changed",
          status: 409,
          message: "Οι τιμές άλλαξαν.",
          uncertain: false,
          quote: newQuote,
        }),
      )
      .mockResolvedValueOnce(successFrom(newQuote));

    renderCheckout();
    fill(validGuest);
    await submit();

    // Καμία επιτυχία — ειδοποίηση με εστίαση
    expect(screen.queryByRole("heading", { name: /Η παραγγελία στάλθηκε/ })).toBeNull();
    const notice = await screen.findByText("Οι τιμές άλλαξαν");
    const noticeBox = notice.closest('[role="alert"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(noticeBox));
    expect(noticeBox.textContent).toMatch(/Margherita: 8,50€ → 9,50€/);
    expect(noticeBox.textContent).toMatch(/Δεν στάλθηκε καμία\s+παραγγελία/);

    const confirm = screen.getByRole("button", { name: /Επιβεβαίωση νέου συνόλου · 11,00€/ });
    expect(submitOrderMock).toHaveBeenCalledTimes(1); // ΔΕΝ ξαναστάλθηκε μόνο του

    await act(async () => {
      fireEvent.click(confirm);
    });
    const [first, second] = submitOrderMock.mock.calls.map(([request]) => request);
    expect(first.expectedTotalCents).toBe(1000);
    expect(second.expectedTotalCents).toBe(1100);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(await screen.findByRole("heading", { name: /Η παραγγελία στάλθηκε/ })).toBeTruthy();
  });

  it("λάθη πεδίων από τον server εμφανίζονται στο σωστό πεδίο", async () => {
    seedCart();
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "validation_failed",
        status: 400,
        message: "Έλεγξε τα στοιχεία.",
        uncertain: false,
        fieldErrors: { phone: "Το τηλέφωνο δεν είναι έγκυρο (server)." },
      }),
    );
    renderCheckout();
    fill(validGuest);
    await submit();

    expect(await screen.findByText("Το τηλέφωνο δεν είναι έγκυρο (server).")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field("phone")));
  });

  it("συνδεδεμένος χρήστης → προσυμπλήρωση από το προφίλ, χωρίς banner επισκέπτη", () => {
    seedCart();
    authState.user = { uid: "u1", isAnonymous: false };
    authState.isAuthenticated = true;
    authState.profile = {
      uid: "u1",
      fullName: "Μαρία Ιωάννου",
      email: "maria@example.com",
      phone: "6987654321",
      addresses: [
        { id: "home", label: "Σπίτι", street: "Ασκληπιού 12", city: "Τρίκαλα", isDefault: true },
        { id: "label-only", label: "Γραφείο", street: "Γραφείο" },
      ],
      createdAt: null,
      updatedAt: null,
      role: "customer",
    };

    renderCheckout();
    expect(screen.queryByText(/Παραγγέλνεις ως επισκέπτης/)).toBeNull();
    expect(field("fullName").value).toBe("Μαρία Ιωάννου");
    expect(field("phone").value).toBe("6987654321");
    expect(field("street").value).toBe("Ασκληπιού 12");
    expect(field("city").value).toBe("Τρίκαλα");
    // Η διεύθυνση-ετικέτα δεν προσφέρεται ως επιλογή
    expect(screen.queryByRole("button", { name: /^Γραφείο/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Σπίτι/, pressed: true })).toBeTruthy();
  });
});
