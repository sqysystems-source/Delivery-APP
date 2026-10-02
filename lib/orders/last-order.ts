/* ==========================================================================
 *  Buka Delivery — lib/orders/last-order.ts   (milestone 2)
 *
 *  «Η τελευταία μου παραγγελία» για επισκέπτες, στον ΙΔΙΟ browser.
 *
 *    { v: 1, uid, orderId, savedAt }   ← localStorage, ΤΙΠΟΤΑ άλλο
 *
 *  • Δεσμεύεται στον uid: ένας άλλος χρήστης στον ίδιο browser δεν τη βλέπει
 *    (readLastOrderFor επιστρέφει null για άλλο uid).
 *  • ΔΕΝ είναι εξουσιοδότηση. Η σελίδα παρακολούθησης διαβάζει την
 *    παραγγελία από το Firestore και τα Security Rules επιτρέπουν την
 *    ανάγνωση μόνο όταν orders/{id}.userId == request.auth.uid.
 *  • Αν ο επισκέπτης καθαρίσει τα δεδομένα του browser ή αλλάξει συσκευή,
 *    χάνει και το ανώνυμο session — η παραγγελία δεν είναι πια προσβάσιμη
 *    από αυτόν. Αυτό εξηγείται ρητά στο UI.
 * ========================================================================== */

import { useSyncExternalStore } from "react";
import { createBrowserStore } from "@/lib/browser-store";
import { isValidDocumentId } from "@/lib/checkout/validation";

export const LAST_ORDER_STORAGE_KEY = "buka:last-order:v1";

export type LastOrderRef = {
  uid: string;
  orderId: string;
  savedAt: number;
};

export function parseLastOrder(raw: string | null): LastOrderRef | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { v, uid, orderId, savedAt } = parsed as Record<string, unknown>;
  if (v !== 1) return null;
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128) return null;
  if (!isValidDocumentId(orderId)) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  return { uid, orderId, savedAt };
}

const store = createBrowserStore<LastOrderRef | null>({
  key: LAST_ORDER_STORAGE_KEY,
  parse: parseLastOrder,
  serialize: (value) =>
    value
      ? JSON.stringify({ v: 1, uid: value.uid, orderId: value.orderId, savedAt: value.savedAt })
      : null,
  empty: null,
});

export function saveLastOrder(ref: LastOrderRef): void {
  if (!ref.uid || !isValidDocumentId(ref.orderId)) return;
  store.write({ uid: ref.uid, orderId: ref.orderId, savedAt: ref.savedAt });
}

export function readLastOrderFor(uid: string | null | undefined): LastOrderRef | null {
  if (!uid) return null;
  const value = store.getSnapshot();
  return value && value.uid === uid ? value : null;
}

/** Η αναφορά μόνο αν ανήκει στον τρέχοντα uid — αλλιώς null */
export function useLastOrder(uid: string | null | undefined): LastOrderRef | null {
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return uid && value && value.uid === uid ? value : null;
}
