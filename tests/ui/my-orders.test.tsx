// @vitest-environment jsdom
/* ==========================================================================
 *  «Οι παραγγελίες μου» + σύνδεσμος επισκέπτη στο UserMenu — jsdom με
 *  ψεύτικο getDocs. Τα rules (userId == uid, limit ≤ 50) ελέγχονται στο
 *  tests/emulator.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Constraint = { type: string; args: unknown[] };
type Deferred = { resolve: (docs: unknown[]) => void; reject: (error: unknown) => void };

const h = vi.hoisted(() => ({
  queries: [] as Array<{ constraints: Constraint[]; deferred: Deferred }>,
  authState: {
    user: null as null | { uid: string; isAnonymous: boolean; email?: string },
    loading: false,
  },
  ensureSignedIn: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: null }, ensureSignedIn: h.ensureSignedIn }));

vi.mock("firebase/firestore", () => {
  const constraint = (type: string) => (...args: unknown[]) => ({ type, args });
  return {
    collection: (_db: unknown, path: string) => ({ path }),
    where: constraint("where"),
    orderBy: constraint("orderBy"),
    limit: constraint("limit"),
    startAfter: constraint("startAfter"),
    query: (_ref: unknown, ...constraints: Constraint[]) => ({ constraints }),
    getDocs: (q: { constraints: Constraint[] }) =>
      new Promise((resolve, reject) => {
        h.queries.push({
          constraints: q.constraints,
          deferred: { resolve: (docs) => resolve({ docs }), reject },
        });
      }),
  };
});

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: h.authState.user,
    loading: h.authState.loading,
    profile: null,
    isAuthenticated: h.authState.user !== null && !h.authState.user.isAnonymous,
    isAnonymous: h.authState.user?.isAnonymous ?? false,
    displayName: "Κώστας",
    openLogin: vi.fn(),
    openRegister: vi.fn(),
    logout: vi.fn(),
  }),
}));

import MyOrdersClient from "@/components/orders/MyOrdersClient";
import UserMenu from "@/components/UserMenu";
import { saveLastOrder } from "@/lib/orders/last-order";

/* ------------------------------ Βοηθητικά ------------------------------- */

function orderDoc(id: string, overrides: Record<string, unknown> = {}) {
  const data = {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    userId: "user-1",
    lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 2, lineTotal: 17 }],
    subtotal: 17,
    deliveryFee: 0,
    total: 17,
    totalCents: 1700,
    status: "pending",
    paymentMethod: "cash_on_delivery",
    createdAt: { toDate: () => new Date("2026-10-01T10:00:00Z") },
    ...overrides,
  };
  return { id, data: () => data };
}

async function answer(index: number, docs: unknown[]) {
  await act(async () => h.queries[index].deferred.resolve(docs));
}

beforeEach(() => {
  h.queries.length = 0;
  h.authState.user = { uid: "user-1", isAnonymous: false };
  h.authState.loading = false;
  window.localStorage.clear();
});

afterEach(() => cleanup());

/* ================================ Tests ================================= */

describe("Οι παραγγελίες μου — εγγεγραμμένος", () => {
  it("ερώτημα ΜΟΝΟ με τον uid του Auth, ταξινόμηση με createdAt του server, όριο σελίδας", async () => {
    render(<MyOrdersClient />);
    expect(screen.getByLabelText("Φόρτωση παραγγελιών")).toBeTruthy();
    expect(h.queries[0].constraints).toEqual([
      { type: "where", args: ["userId", "==", "user-1"] },
      { type: "orderBy", args: ["createdAt", "desc"] },
      { type: "limit", args: [11] },
    ]);

    await answer(0, [
      orderDoc("newest0001", { status: "accepted", shopName: "Grill House" }),
      orderDoc("older00002", { status: "cancelled", cancelReason: "rejected_by_shop" }),
    ]);

    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/orders/"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/orders/newest0001", "/orders/older00002"]);
    expect(links[0].textContent).toContain("Grill House");
    expect(links[0].textContent).toContain("Έγινε δεκτή");
    expect(links[0].textContent).toContain("BK-NEWEST");
    expect(links[1].textContent).toContain("Δεν έγινε δεκτή");
    expect(screen.queryByRole("button", { name: "Περισσότερες παραγγελίες" })).toBeNull();
  });

  it("κενό ιστορικό → φιλικό μήνυμα και σύνδεσμος στα καταστήματα", async () => {
    render(<MyOrdersClient />);
    await answer(0, []);
    expect(screen.getByRole("heading", { name: "Δεν έχεις παραγγελίες ακόμη" })).toBeTruthy();
  });

  it("σελιδοποίηση: 10 ανά σελίδα, startAfter το τελευταίο έγγραφο, χωρίς διπλότυπα", async () => {
    render(<MyOrdersClient />);
    const firstPage = Array.from({ length: 11 }, (_, index) => orderDoc(`order${String(index).padStart(5, "0")}`));
    await answer(0, firstPage);

    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Περισσότερες παραγγελίες" }));
    expect(screen.getByRole("button", { name: /Φόρτωση/ })).toBeTruthy();

    expect(h.queries[1].constraints).toContainEqual({ type: "startAfter", args: [firstPage[9]] });
    await answer(1, [orderDoc("order00009"), orderDoc("order00010"), orderDoc("order00011")]);

    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Περισσότερες παραγγελίες" })).toBeNull();
  });

  it("ιστορική παραγγελία (χωρίς νέα πεδία) εμφανίζεται κανονικά", async () => {
    render(<MyOrdersClient />);
    await answer(0, [
      { id: "legacy0001", data: () => ({ shopName: "Παλιό", userId: "user-1", status: "completed", total: 9.5, lines: [], createdAt: { toDate: () => new Date("2025-01-01T10:00:00Z") } }) },
    ]);
    const row = screen.getByRole("link", { name: /Παλιό/ });
    expect(row.textContent).toContain("Ολοκληρώθηκε");
    expect(row.textContent).toContain("9,50€");
  });

  it("σφάλμα (π.χ. λείπει index) → μήνυμα και «Δοκίμασε ξανά»", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<MyOrdersClient />);
    await act(async () => h.queries[0].deferred.reject({ code: "failed-precondition" }));
    expect(screen.getByRole("alert").textContent).toContain("δεν είναι διαθέσιμο");
    fireEvent.click(screen.getByRole("button", { name: /Δοκίμασε ξανά/ }));
    await waitFor(() => expect(h.queries).toHaveLength(2));
    await answer(1, [orderDoc("order00001")]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("αλλαγή χρήστη: οι παραγγελίες του προηγούμενου εξαφανίζονται αμέσως", async () => {
    const view = render(<MyOrdersClient />);
    await answer(0, [orderDoc("useronesorder")]);
    expect(screen.getByText("BK-USERON")).toBeTruthy();

    h.authState.user = { uid: "user-2", isAnonymous: false };
    view.rerender(<MyOrdersClient />);
    expect(screen.queryByText("BK-USERON")).toBeNull();
    expect(h.queries[1].constraints[0]).toEqual({ type: "where", args: ["userId", "==", "user-2"] });

    // Καθυστερημένη απάντηση για τον προηγούμενο χρήστη αγνοείται
    await answer(1, []);
    expect(screen.queryByText("BK-USERON")).toBeNull();
  });
});

describe("Οι παραγγελίες μου — επισκέπτης", () => {
  it("τελευταία παραγγελία του ΙΔΙΟΥ uid, χωρίς ερώτημα λίστας", () => {
    h.authState.user = { uid: "anon-1", isAnonymous: true };
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 1 });
    render(<MyOrdersClient />);
    expect(screen.getByText("BK-ABC123")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Παρακολούθηση παραγγελίας/ }).getAttribute("href")).toBe("/orders/abc123xyz");
    expect(h.queries).toHaveLength(0);
    expect(document.body.textContent).toContain("αλλάξεις συσκευή");
  });

  it("αναφορά άλλου uid στον ίδιο browser → δεν εμφανίζεται", () => {
    h.authState.user = { uid: "anon-2", isAnonymous: true };
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 1 });
    render(<MyOrdersClient />);
    expect(screen.queryByText("BK-ABC123")).toBeNull();
    expect(screen.getByRole("heading", { name: "Δεν βρέθηκε πρόσφατη παραγγελία" })).toBeTruthy();
  });

  it("κανένα session → σύνδεση, χωρίς δημιουργία ανώνυμου χρήστη", () => {
    h.authState.user = null;
    render(<MyOrdersClient />);
    expect(screen.getByRole("button", { name: /Σύνδεση/ })).toBeTruthy();
    expect(h.ensureSignedIn).not.toHaveBeenCalled();
    expect(h.queries).toHaveLength(0);
  });
});

describe("UserMenu", () => {
  it("επισκέπτης με πρόσφατη παραγγελία → «Η παραγγελία μου»", () => {
    h.authState.user = { uid: "anon-1", isAnonymous: true };
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 1 });
    render(<UserMenu />);
    expect(screen.getByRole("link", { name: "Η παραγγελία μου" }).getAttribute("href")).toBe("/orders/abc123xyz");
  });

  it("άλλος επισκέπτης στον ίδιο browser → κανένας σύνδεσμος", () => {
    h.authState.user = { uid: "anon-2", isAnonymous: true };
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 1 });
    render(<UserMenu />);
    expect(screen.queryByRole("link", { name: "Η παραγγελία μου" })).toBeNull();
  });

  it("εγγεγραμμένος → «Οι παραγγελίες μου» στο μενού χρήστη", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("menuitem", { name: /Οι παραγγελίες μου/ }).getAttribute("href")).toBe("/orders");
  });
});
