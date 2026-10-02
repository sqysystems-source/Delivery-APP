"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useOrderTracking.ts   (milestone 2)
 *
 *  Ζωντανή παρακολούθηση ΜΙΑΣ παραγγελίας: onSnapshot στο orders/{orderId}
 *  — ποτέ σε ολόκληρο το collection.
 *
 *  ── ΠΡΟΣΒΑΣΗ ────────────────────────────────────────────────────────────
 *  Ο listener ανοίγει ΜΟΝΟ με τον υπάρχοντα Firebase χρήστη (εγγεγραμμένο ή
 *  ανώνυμο). Δεν γίνεται ποτέ νέο anonymous sign-in εδώ: ένας νέος uid δεν
 *  θα είχε πρόσβαση και θα αντικαθιστούσε σιωπηλά το session του επισκέπτη.
 *  Η πρόσβαση ελέγχεται από τα Security Rules (userId == request.auth.uid)·
 *  επιπλέον ο client αρνείται να δείξει έγγραφο με άλλο userId.
 *
 *  ── ΚΑΤΑΣΤΑΣΕΙΣ ─────────────────────────────────────────────────────────
 *  Το αποτέλεσμα αποθηκεύεται μαζί με το «κλειδί» της συνδρομής
 *  (uid|orderId|προσπάθεια). Όταν αλλάξει χρήστης ή παραγγελία, το κλειδί
 *  αλλάζει και τα παλιά δεδομένα ΠΑΥΟΥΝ να φαίνονται στο ίδιο render — πριν
 *  καν κλείσει ο παλιός listener. Κανένα effect δεν γράφει state συγχρονισμένα.
 *
 *  ── ΣΥΝΔΕΣΗ ─────────────────────────────────────────────────────────────
 *  Σε απώλεια δικτύου ο listener ΔΕΝ αποτυγχάνει: το SDK δίνει δεδομένα από
 *  cache (metadata.fromCache) και ξανασυνδέεται μόνο του. Ένα «δεν υπάρχει»
 *  από cache δεν θεωρείται οριστικό. Τα πραγματικά σφάλματα του listener
 *  είναι τερματικά — τότε προσφέρεται «Δοκίμασε ξανά» (νέος listener).
 * ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { isValidDocumentId } from "@/lib/checkout/validation";
import { mapCustomerOrder, type CustomerOrder } from "@/lib/orders/customer-order";

export type OrderTrackingState =
  /** Περιμένουμε το Firebase Auth ή το πρώτο στιγμιότυπο */
  | { kind: "loading"; offline: boolean }
  /** Κανένα Firebase session σε αυτόν τον browser */
  | { kind: "signed_out" }
  /** Το id δεν έχει έγκυρη μορφή — δεν ρωτάμε καν τη βάση */
  | { kind: "invalid_id" }
  /**
   * Δεν υπάρχει Ή δεν ανήκει στον χρήστη — ΙΔΙΟ αποτέλεσμα σκόπιμα, ώστε να
   * μη φαίνεται αν ένα id υπάρχει.
   */
  | { kind: "unavailable" }
  /** Τερματικό σφάλμα listener· `order` = τελευταία γνωστή εικόνα (ίδιος χρήστης) */
  | { kind: "error"; order: CustomerOrder | null }
  | { kind: "ready"; order: CustomerOrder; offline: boolean };

type Snapshot =
  | { key: string; kind: "ready"; order: CustomerOrder; fromCache: boolean }
  | { key: string; kind: "pending_cache" }
  | { key: string; kind: "unavailable" }
  | { key: string; kind: "error"; order: CustomerOrder | null; code: string };

export type UseOrderTracking = {
  state: OrderTrackingState;
  /** Νέος listener μετά από τερματικό σφάλμα */
  retry: () => void;
  uid: string | null;
  isAnonymous: boolean;
};

export function useOrderTracking(orderId: string): UseOrderTracking {
  const { user, loading: authLoading } = useAuth();
  const online = useOnlineStatus();
  const uid = user?.uid ?? null;
  const validId = isValidDocumentId(orderId);

  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const subscriptionKey = !authLoading && uid && validId ? `${uid}|${orderId}|${attempt}` : null;

  useEffect(() => {
    if (!subscriptionKey || !uid) return;
    const key = subscriptionKey;

    const unsubscribe = onSnapshot(
      doc(db, "orders", orderId),
      { includeMetadataChanges: true },
      (document) => {
        if (!document.exists()) {
          // Από cache (offline) δεν είναι οριστικό — περιμένουμε τον server
          setSnapshot(
            document.metadata.fromCache ? { key, kind: "pending_cache" } : { key, kind: "unavailable" },
          );
          return;
        }

        const data = document.data() as Record<string, unknown>;
        /* Δίχτυ ασφαλείας: τα rules ήδη το εγγυώνται, αλλά ΠΟΤΕ δεν δείχνουμε
         * παραγγελία άλλου χρήστη, ακόμη κι αν τα rules αλλάξουν λανθασμένα */
        if (data.userId !== uid) {
          setSnapshot({ key, kind: "unavailable" });
          return;
        }

        setSnapshot({
          key,
          kind: "ready",
          order: mapCustomerOrder(document.id, data),
          fromCache: document.metadata.fromCache,
        });
      },
      (error: FirestoreError) => {
        if (error.code === "permission-denied" || error.code === "not-found") {
          setSnapshot({ key, kind: "unavailable" });
          return;
        }
        console.error("[orders] Σφάλμα παρακολούθησης παραγγελίας:", error.code);
        setSnapshot((previous) => ({
          key,
          kind: "error",
          code: error.code,
          order: previous?.key === key && previous.kind === "ready" ? previous.order : null,
        }));
      },
    );

    return unsubscribe;
  }, [subscriptionKey, uid, orderId]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  /* Ό,τι ανήκει σε άλλη συνδρομή (άλλος χρήστης/παραγγελία) αγνοείται */
  const current = snapshot && snapshot.key === subscriptionKey ? snapshot : null;

  let state: OrderTrackingState;
  if (!validId) {
    state = { kind: "invalid_id" };
  } else if (authLoading) {
    state = { kind: "loading", offline: !online };
  } else if (!uid) {
    state = { kind: "signed_out" };
  } else if (!current || current.kind === "pending_cache") {
    state = { kind: "loading", offline: !online || current?.kind === "pending_cache" };
  } else if (current.kind === "unavailable") {
    state = { kind: "unavailable" };
  } else if (current.kind === "error") {
    state = { kind: "error", order: current.order };
  } else {
    state = { kind: "ready", order: current.order, offline: !online || current.fromCache };
  }

  return { state, retry, uid, isAnonymous: user?.isAnonymous ?? false };
}
