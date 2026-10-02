// @vitest-environment jsdom
/* ==========================================================================
 *  Σελίδα παρακολούθησης — jsdom με ψεύτικο onSnapshot.
 *
 *  Αποδεικνύει τη συμπεριφορά του UI/hook (καταστάσεις, ζωντανή ενημέρωση,
 *  καθαρισμός listener, αλλαγή χρήστη). ΔΕΝ αποδεικνύει τα Security Rules —
 *  αυτά ελέγχονται στο tests/emulator (npm run test:rules).
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------- Mocks ---------------------------------- */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Listener = {
  path: string;
  options: unknown;
  next: (snapshot: unknown) => void;
  error: (error: { code: string }) => void;
  unsubscribed: boolean;
};

const { ensureSignedIn, listeners, authState, openLogin } = vi.hoisted(() => ({
  ensureSignedIn: vi.fn(),
  listeners: [] as Listener[],
  authState: {
    user: null as null | { uid: string; isAnonymous: boolean },
    loading: false,
  },
  openLogin: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: { name: "db" }, auth: { currentUser: null }, ensureSignedIn }));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  onSnapshot: (
    ref: { path: string },
    options: unknown,
    next: Listener["next"],
    error: Listener["error"],
  ) => {
    const listener: Listener = { path: ref.path, options, next, error, unsubscribed: false };
    listeners.push(listener);
    return () => {
      listener.unsubscribed = true;
    };
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: authState.user,
    loading: authState.loading,
    isAuthenticated: authState.user !== null && !authState.user.isAnonymous,
    isAnonymous: authState.user?.isAnonymous ?? false,
    openLogin,
  }),
}));

import OrderTrackingClient from "@/components/orders/OrderTrackingClient";

/* ------------------------------ Βοηθητικά ------------------------------- */

const ORDER_ID = "abc123xyz";

function orderData(overrides: Record<string, unknown> = {}) {
  return {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    ownerUid: "owner-1",
    userId: "anon-1",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος" },
    address: "Ερμού 5, Τρίκαλα",
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1, lineTotal: 8.5, unitPriceCents: 850, lineTotalCents: 850 }],
    subtotal: 8.5,
    deliveryFee: 1.5,
    total: 10,
    subtotalCents: 850,
    deliveryFeeCents: 150,
    totalCents: 1000,
    status: "pending",
    etaMinutes: [30, 40],
    createdAt: { toDate: () => new Date("2026-10-01T10:00:00Z") },
    ...overrides,
  };
}

function snapshot(data: Record<string, unknown> | null, fromCache = false) {
  return {
    id: ORDER_ID,
    exists: () => data !== null,
    data: () => data ?? undefined,
    metadata: { fromCache, hasPendingWrites: false },
  };
}

const active = () => listeners.filter((listener) => !listener.unsubscribed);

function emit(data: Record<string, unknown> | null, fromCache = false) {
  const [listener] = active();
  if (!listener) throw new Error("κανένας ενεργός listener");
  act(() => listener.next(snapshot(data, fromCache)));
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value: online, configurable: true });
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

beforeEach(() => {
  listeners.length = 0;
  authState.user = { uid: "anon-1", isAnonymous: true };
  authState.loading = false;
  ensureSignedIn.mockReset();
  setOnline(true);
});

afterEach(() => cleanup());

/* ================================ Tests ================================= */

describe("παρακολούθηση παραγγελίας", () => {
  it("ένας listener ΜΟΝΟ για το συγκεκριμένο έγγραφο, με metadata changes", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    expect(listeners).toHaveLength(1);
    expect(listeners[0].path).toBe(`orders/${ORDER_ID}`);
    expect(listeners[0].options).toEqual({ includeMetadataChanges: true });
  });

  it("φόρτωση → αρχική κατάσταση «σε αναμονή αποδοχής» με επαληθευμένα ποσά και αντικαταβολή", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    expect(screen.getByLabelText("Φόρτωση παραγγελίας").getAttribute("aria-busy")).toBe("true");

    emit(orderData());

    expect(screen.getByRole("heading", { name: "BK-ABC123" })).toBeTruthy();
    expect(screen.getByText("Pizza Roma")).toBeTruthy();
    expect(screen.getByText("Σε αναμονή αποδοχής")).toBeTruthy();
    expect(screen.getByText("Margherita")).toBeTruthy();
    expect(screen.getByText("10,00€")).toBeTruthy();
    expect(document.body.textContent).toContain("Μετρητά κατά την παράδοση — θα πληρώσεις 10,00€");

    // Καμία ψευδής δήλωση, καμία εκτίμηση χρόνου, κανένα τηλέφωνο
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Έγινε δεκτή|πληρώθηκε|30-40/);
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(text).not.toContain("+306912345678");

    // Προσβάσιμη πρόοδος: τρέχον βήμα το πρώτο
    const steps = screen.getByRole("list", { name: "Πρόοδος παραγγελίας" }).querySelectorAll("li");
    expect(steps).toHaveLength(5);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
  });

  it("ζωντανές αλλαγές του ταμπλό: accepted → preparing → delivering → completed", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());

    const steps = () => screen.getByRole("list", { name: "Πρόοδος παραγγελίας" }).querySelectorAll("li");
    const expected = [
      ["accepted", "Έγινε δεκτή", 1],
      ["preparing", "Ετοιμάζεται", 2],
      ["delivering", "Σε παράδοση", 3],
      ["completed", "Ολοκληρώθηκε", 4],
    ] as const;

    for (const [status, label, index] of expected) {
      emit(orderData({ status, updatedAt: { toDate: () => new Date("2026-10-01T10:20:00Z") } }));
      const region = screen.getAllByRole("status").find((element) => element.getAttribute("aria-live") === "polite");
      expect(region?.textContent).toContain(label);
      expect(steps()[index].getAttribute("aria-current")).toBe("step");
    }
    // Ολοκληρωμένη ≠ «πληρώθηκε»
    expect(document.body.textContent).not.toMatch(/πληρώθηκε|θα πληρώσεις/);
    expect(listeners).toHaveLength(1);
  });

  it("απόρριψη από το κατάστημα → σαφές μήνυμα, χωρίς πρόοδο, καμία οφειλή", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData({ status: "cancelled", cancelReason: "rejected_by_shop" }));
    expect(screen.getByText("Δεν έγινε δεκτή")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Πρόοδος παραγγελίας" })).toBeNull();
    expect(document.body.textContent).toContain("δεν θα πληρώσεις τίποτα");
  });

  it("παλιά ακυρωμένη χωρίς λόγο → γενικό μήνυμα ακύρωσης", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData({ status: "cancelled" }));
    expect(screen.getByText("Ακυρώθηκε")).toBeTruthy();
  });

  it("ιστορική παραγγελία χωρίς paymentMethod → ειλικρινές fallback", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    const legacy = orderData({ status: "completed" });
    delete (legacy as Record<string, unknown>).paymentMethod;
    delete (legacy as Record<string, unknown>).delivery;
    emit(legacy);
    expect(document.body.textContent).toContain("Ο τρόπος πληρωμής δεν καταγράφηκε");
    expect(document.body.textContent).toContain("Ερμού 5, Τρίκαλα");
  });

  it("permission-denied (ξένη ή ανύπαρκτη) → ίδιο ουδέτερο μήνυμα, χωρίς δεδομένα", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    act(() => active()[0].error({ code: "permission-denied" }));
    expect(screen.getByRole("heading", { name: "Η παραγγελία δεν βρέθηκε" })).toBeTruthy();
    expect(document.body.textContent).toContain("καθάρισες τα δεδομένα του browser");
  });

  it("έγγραφο άλλου χρήστη (αν ποτέ τα rules το επέτρεπαν) → ΔΕΝ εμφανίζεται", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData({ userId: "someone-else" }));
    expect(screen.getByRole("heading", { name: "Η παραγγελία δεν βρέθηκε" })).toBeTruthy();
    expect(screen.queryByText("Margherita")).toBeNull();
  });

  it("απώλεια σύνδεσης: δεδομένα από cache + ένδειξη· επανασύνδεση την αφαιρεί", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    expect(screen.queryByText(/Χωρίς σύνδεση/)).toBeNull();

    setOnline(false);
    emit(orderData(), true);
    expect(screen.getByText(/Χωρίς σύνδεση/)).toBeTruthy();
    expect(screen.getByText("Σε αναμονή αποδοχής")).toBeTruthy();

    setOnline(true);
    emit(orderData({ status: "accepted" }), false);
    expect(screen.queryByText(/Χωρίς σύνδεση/)).toBeNull();
    expect(screen.getAllByText("Έγινε δεκτή").length).toBeGreaterThan(0);
    // Το SDK ξανασυνδέεται μόνο του — κανένας νέος listener
    expect(listeners).toHaveLength(1);
  });

  it("«δεν υπάρχει» από cache (offline) ΔΕΝ είναι οριστικό", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(null, true);
    expect(screen.queryByRole("heading", { name: "Η παραγγελία δεν βρέθηκε" })).toBeNull();
    expect(screen.getByLabelText("Φόρτωση παραγγελίας")).toBeTruthy();
    expect(document.body.textContent).toContain("Χωρίς σύνδεση");
  });

  it("τερματικό σφάλμα → τελευταία γνωστή εικόνα + «Δοκίμασε ξανά» με ΝΕΟ listener", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    act(() => active()[0].error({ code: "unavailable" }));

    expect(screen.getByRole("alert").textContent).toContain("Διακόπηκε η ζωντανή ενημέρωση");
    expect(screen.getByText("Margherita")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Δοκίμασε ξανά/ }));
    expect(listeners).toHaveLength(2);
    expect(listeners[0].unsubscribed).toBe(true);
    expect(active()).toHaveLength(1);
    emit(orderData({ status: "accepted" }));
    expect(screen.getAllByText("Έγινε δεκτή").length).toBeGreaterThan(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("έξοδος από τη σελίδα → ο listener κλείνει", () => {
    const { unmount } = render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    unmount();
    expect(listeners.every((listener) => listener.unsubscribed)).toBe(true);
  });

  it("ανανέωση: νέα φόρτωση περιμένει το Auth, μετά ξανανοίγει τον ίδιο listener", () => {
    const first = render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData({ status: "preparing" }));
    first.unmount();

    authState.loading = true; // το Firebase αποκαθιστά το session από το storage
    const second = render(<OrderTrackingClient orderId={ORDER_ID} />);
    expect(active()).toHaveLength(0);
    expect(screen.getByLabelText("Φόρτωση παραγγελίας")).toBeTruthy();
    expect(ensureSignedIn).not.toHaveBeenCalled();

    authState.loading = false;
    second.rerender(<OrderTrackingClient orderId={ORDER_ID} />);
    expect(active()).toHaveLength(1);
    emit(orderData({ status: "preparing" }));
    expect(screen.getAllByText("Ετοιμάζεται").length).toBeGreaterThan(0);
  });

  it("αλλαγή χρήστη: τα δεδομένα του προηγούμενου εξαφανίζονται ΑΜΕΣΩΣ", () => {
    const view = render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    expect(screen.getByText("Margherita")).toBeTruthy();

    authState.user = { uid: "user-2", isAnonymous: false };
    view.rerender(<OrderTrackingClient orderId={ORDER_ID} />);

    // Ίδιο render: καμία παλιά πληροφορία, ο παλιός listener κλειστός, νέος για τον νέο uid
    expect(screen.queryByText("Margherita")).toBeNull();
    expect(screen.queryByText("BK-ABC123")).toBeNull();
    expect(listeners[0].unsubscribed).toBe(true);
    expect(active()).toHaveLength(1);

    // Αν ο παλιός listener «αργήσει» να παραδώσει στιγμιότυπο, αγνοείται
    act(() => listeners[0].next(snapshot(orderData())));
    expect(screen.queryByText("Margherita")).toBeNull();
  });

  it("αποσύνδεση → εξήγηση, κανένας listener, ΚΑΝΕΝΑ νέο anonymous sign-in", () => {
    const view = render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    authState.user = null;
    view.rerender(<OrderTrackingClient orderId={ORDER_ID} />);

    expect(screen.queryByText("Margherita")).toBeNull();
    expect(screen.getByRole("heading", { name: "Δεν μπορούμε να δείξουμε την παραγγελία" })).toBeTruthy();
    expect(active()).toHaveLength(0);
    expect(ensureSignedIn).not.toHaveBeenCalled();
  });

  it("άκυρο id → κανένα ερώτημα στη βάση", () => {
    render(<OrderTrackingClient orderId="__bad__" />);
    expect(listeners).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Η παραγγελία δεν βρέθηκε" })).toBeTruthy();
  });

  it("επισκέπτης: ειλικρινής εξήγηση για την πρόσβαση από άλλη συσκευή", () => {
    render(<OrderTrackingClient orderId={ORDER_ID} />);
    emit(orderData());
    expect(document.body.textContent).toContain("Παρήγγειλες ως επισκέπτης");
    expect(document.body.textContent).toContain("άλλη συσκευή");
  });
});
