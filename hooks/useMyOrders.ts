"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useMyOrders.ts   (milestone 2)
 *
 *  Ιστορικό παραγγελιών του ΣΥΝΔΕΔΕΜΕΝΟΥ χρήστη, σε σελίδες των PAGE_SIZE.
 *
 *    where("userId", "==", uid) + orderBy("createdAt", "desc") + limit
 *
 *  • Το uid έρχεται από το Firebase Auth — ποτέ από URL ή storage.
 *  • Η ταξινόμηση γίνεται με το `createdAt` του SERVER (serverTimestamp).
 *  • Composite index: orders → userId ASC + createdAt DESC (το ίδιο που
 *    χρησιμοποιεί ήδη το rate limit του /api/orders).
 *  • Τα Security Rules επιτρέπουν αυτό το query μόνο με limit ≤ 50.
 *  • Αποτελέσματα κλειδωμένα στο uid: μετά από αποσύνδεση/αλλαγή χρήστη τα
 *    παλιά δεν εμφανίζονται ούτε για ένα render.
 * ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { mapCustomerOrder, type CustomerOrder } from "@/lib/orders/customer-order";

export const MY_ORDERS_PAGE_SIZE = 10;

type Page = {
  uid: string;
  orders: CustomerOrder[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  error: string | null;
};

export type UseMyOrders = {
  orders: CustomerOrder[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  reload: () => void;
};

function errorMessage(code: string | undefined): string {
  if (code === "failed-precondition") {
    return "Το ιστορικό δεν είναι διαθέσιμο αυτή τη στιγμή (λείπει ρύθμιση της βάσης). Δοκίμασε αργότερα.";
  }
  if (code === "permission-denied") {
    return "Δεν έχεις πρόσβαση σε αυτό το ιστορικό. Συνδέσου ξανά και δοκίμασε πάλι.";
  }
  return "Δεν ήταν δυνατή η φόρτωση των παραγγελιών. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.";
}

async function fetchPage(
  uid: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<Omit<Page, "uid" | "error">> {
  const constraints = [
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    // Ένα παραπάνω για να ξέρουμε αν υπάρχει επόμενη σελίδα
    limit(MY_ORDERS_PAGE_SIZE + 1),
  ];
  const snapshot = await getDocs(query(collection(db, "orders"), ...constraints));
  const docs = snapshot.docs.slice(0, MY_ORDERS_PAGE_SIZE);
  return {
    orders: docs.map((document) => mapCustomerOrder(document.id, document.data())),
    cursor: docs.length > 0 ? docs[docs.length - 1] : cursor,
    hasMore: snapshot.docs.length > MY_ORDERS_PAGE_SIZE,
  };
}

/** @param uid — ΜΟΝΟ για εγγεγραμμένο χρήστη· null για επισκέπτη/αποσυνδεδεμένο */
export function useMyOrders(uid: string | null): UseMyOrders {
  const [page, setPage] = useState<Page | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    fetchPage(uid, null)
      .then((result) => {
        if (!cancelled) setPage({ uid, ...result, error: null });
      })
      .catch((caught: { code?: string }) => {
        if (cancelled) return;
        console.error("[orders] Αποτυχία φόρτωσης ιστορικού:", caught?.code);
        setPage({ uid, orders: [], cursor: null, hasMore: false, error: errorMessage(caught?.code) });
      });

    return () => {
      cancelled = true;
    };
  }, [uid, reloadToken]);

  const current = page && page.uid === uid ? page : null;

  const loadMore = useCallback(() => {
    if (!uid || !current || !current.hasMore || moreFor === uid) return;
    const requestedFor = uid;
    setMoreFor(requestedFor);

    fetchPage(requestedFor, current.cursor)
      .then((result) => {
        setPage((previous) =>
          previous && previous.uid === requestedFor
            ? {
                uid: requestedFor,
                // Χωρίς διπλότυπα αν μια παραγγελία «γλίστρησε» ανάμεσα σε σελίδες
                orders: [
                  ...previous.orders,
                  ...result.orders.filter(
                    (order) => !previous.orders.some((existing) => existing.id === order.id),
                  ),
                ],
                cursor: result.cursor,
                hasMore: result.hasMore,
                error: null,
              }
            : previous,
        );
      })
      .catch((caught: { code?: string }) => {
        setPage((previous) =>
          previous && previous.uid === requestedFor
            ? { ...previous, error: errorMessage(caught?.code) }
            : previous,
        );
      })
      .finally(() => setMoreFor((value) => (value === requestedFor ? null : value)));
  }, [uid, current, moreFor]);

  const reload = useCallback(() => {
    setPage(null);
    setReloadToken((value) => value + 1);
  }, []);

  return {
    orders: current?.orders ?? [],
    loading: uid !== null && current === null,
    loadingMore: uid !== null && moreFor === uid,
    hasMore: current?.hasMore ?? false,
    error: current?.error ?? null,
    loadMore,
    reload,
  };
}
