// @vitest-environment jsdom
/* Ταμπλό: τι ακριβώς γράφει η αλλαγή κατάστασης (milestone 2: cancelReason).
 * Το αν το επιτρέπουν τα rules ελέγχεται στο tests/emulator. */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ updateDoc: vi.fn(async () => undefined) }));

vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: null } }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "owner-a", isAnonymous: false }, isAuthenticated: true }),
}));
vi.mock("firebase/firestore", () => ({
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
  collection: () => ({}),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDocs: vi.fn(async () => ({ docs: [] })),
  limit: () => ({}),
  onSnapshot: () => () => undefined,
  orderBy: () => ({}),
  query: () => ({}),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  updateDoc: h.updateDoc,
  where: () => ({}),
}));

import { useAdminOrders } from "@/hooks/useAdminOrders";

beforeEach(() => h.updateDoc.mockClear());

describe("useAdminOrders.updateStatus", () => {
  it("προώθηση: μόνο status + serverTimestamp — κανένα άλλο πεδίο", async () => {
    const { result } = renderHook(() => useAdminOrders("shop-a"));
    await act(() => result.current.updateStatus("o1", "accepted"));
    expect(h.updateDoc).toHaveBeenCalledWith({ path: "orders/o1" }, { status: "accepted", updatedAt: "SERVER_TIMESTAMP" });
  });

  it("απόρριψη: γράφεται και ο λόγος", async () => {
    const { result } = renderHook(() => useAdminOrders("shop-a"));
    await act(() => result.current.updateStatus("o1", "cancelled", "rejected_by_shop"));
    expect(h.updateDoc).toHaveBeenCalledWith(
      { path: "orders/o1" },
      { status: "cancelled", updatedAt: "SERVER_TIMESTAMP", cancelReason: "rejected_by_shop" },
    );
  });

  it("λόγος χωρίς ακύρωση αγνοείται", async () => {
    const { result } = renderHook(() => useAdminOrders("shop-a"));
    await act(() => result.current.updateStatus("o1", "preparing", "cancelled_by_shop"));
    expect(h.updateDoc).toHaveBeenCalledWith({ path: "orders/o1" }, { status: "preparing", updatedAt: "SERVER_TIMESTAMP" });
  });
});
