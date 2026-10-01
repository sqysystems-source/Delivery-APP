"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useAdminOrders.ts
 *
 *  Ζωντανή ροή παραγγελιών για το κατάστημα, με onSnapshot.
 *
 *  ── ΠΩΣ ΒΡΙΣΚΕΙ ΤΟ ΚΑΤΑΣΤΗΜΑ ────────────────────────────────────────────
 *  Ερώτημα στο `shops` με ownerUid == uid. Το document του καταστήματος
 *  πρέπει να έχει το πεδίο `ownerUid` με το uid του καταστηματάρχη.
 *
 *  ── COMPOSITE INDEX (ΑΠΑΡΑΙΤΗΤΟ) ───────────────────────────────────────
 *    Collection: orders
 *    Πεδία: shopId (Ascending), createdAt (Descending)
 *
 *  ── ΜΟΡΦΗ ΠΑΡΑΓΓΕΛΙΩΝ ───────────────────────────────────────────────────
 *  Η μετατροπή γίνεται στο lib/admin/order-mapper.ts και διαβάζει ΚΑΙ τις
 *  νέες (με στοιχεία πελάτη/παράδοσης/πληρωμής) ΚΑΙ τις παλαιότερες.
 *
 *  ── ΚΑΤΑΣΤΑΣΗ ───────────────────────────────────────────────────────────
 *  Τα αποτελέσματα αποθηκεύονται μαζί με το «για ποιον/ποιο κατάστημα» και
 *  το loading/error προκύπτουν κατά το render. Έτσι κανένα effect δεν γράφει
 *  state συγχρονισμένα — μόνο οι callbacks του Firestore.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { mapAdminOrder, type AdminOrder } from "@/lib/admin/order-mapper";
import type { OrderStatus } from "@/types";

export type { AdminOrder, AdminOrderLine } from "@/lib/admin/order-mapper";

/** Πόσες ώρες πίσω φορτώνει το ταμπλό */
const HOURS_WINDOW = 24;
const MAX_ORDERS = 200;

export type UseAdminOrders = {
  shopId: string | null;
  shopName: string | null;
  orders: AdminOrder[];
  pendingOrders: AdminOrder[];
  activeOrders: AdminOrder[];
  completedOrders: AdminOrder[];
  loading: boolean;
  error: string | null;
  updateStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  updatingId: string | null;
};

type ShopLookup = {
  uid: string;
  shopId: string | null;
  shopName: string | null;
  error: string | null;
};

type OrderStream = {
  shopId: string;
  orders: AdminOrder[];
  error: string | null;
  loaded: boolean;
};

/**
 * @param shopIdOverride — για λογαριασμούς admin που βλέπουν άλλο κατάστημα
 */
export function useAdminOrders(shopIdOverride?: string): UseAdminOrders {
  const { user, isAuthenticated } = useAuth();
  const uid = isAuthenticated && user ? user.uid : null;

  const [lookup, setLookup] = useState<ShopLookup | null>(null);
  const [stream, setStream] = useState<OrderStream | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  /* ------------------- 1. Ποιο κατάστημα ανήκει στον χρήστη ------------- */
  useEffect(() => {
    if (shopIdOverride || !uid) return;

    let cancelled = false;

    getDocs(query(collection(db, "shops"), where("ownerUid", "==", uid), limit(1)))
      .then((snapshot) => {
        if (cancelled) return;
        const document = snapshot.docs[0];

        setLookup(
          document
            ? {
                uid,
                shopId: document.id,
                shopName: (document.data().name as string) ?? document.id,
                error: null,
              }
            : {
                uid,
                shopId: null,
                shopName: null,
                error:
                  "Ο λογαριασμός σου δεν είναι συνδεδεμένος με κατάστημα. " +
                  "Ζήτα από τον διαχειριστή να ορίσει το πεδίο ownerUid στο κατάστημά σου.",
              },
        );
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        console.error("[admin] Αποτυχία εύρεσης καταστήματος:", caught);
        setLookup({
          uid,
          shopId: null,
          shopName: null,
          error: "Δεν ήταν δυνατή η φόρτωση του καταστήματος.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [uid, shopIdOverride]);

  const currentLookup = lookup && lookup.uid === uid ? lookup : null;
  const shopId = shopIdOverride ?? currentLookup?.shopId ?? null;

  /* ---------------------- 2. Ζωντανή ροή παραγγελιών -------------------- */
  useEffect(() => {
    if (!shopId) return;

    const since = Timestamp.fromMillis(Date.now() - HOURS_WINDOW * 60 * 60 * 1000);

    const ordersQuery = query(
      collection(db, "orders"),
      where("shopId", "==", shopId),
      where("createdAt", ">", since),
      orderBy("createdAt", "desc"),
      limit(MAX_ORDERS),
    );

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        setStream({
          shopId,
          orders: snapshot.docs.map((document) =>
            mapAdminOrder(document.id, document.data() as Record<string, unknown>),
          ),
          error: null,
          loaded: true,
        });
      },
      (caught) => {
        console.error("[admin] Σφάλμα ροής παραγγελιών:", caught);
        const message =
          caught.code === "failed-precondition"
            ? "Λείπει το composite index (orders: shopId ASC + createdAt DESC). " +
              "Δες τα logs για τον έτοιμο σύνδεσμο δημιουργίας."
            : caught.code === "permission-denied"
              ? "Δεν έχεις δικαίωμα πρόσβασης στις παραγγελίες αυτού του καταστήματος."
              : "Χάθηκε η σύνδεση με τη βάση. Προσπάθεια επανασύνδεσης…";

        // Κρατάμε τις τελευταίες γνωστές παραγγελίες του ίδιου καταστήματος
        setStream((previous) => ({
          shopId,
          orders: previous?.shopId === shopId ? previous.orders : [],
          error: message,
          loaded: true,
        }));
      },
    );

    return unsubscribe;
  }, [shopId]);

  const currentStream = stream && stream.shopId === shopId ? stream : null;
  const orders = useMemo(() => currentStream?.orders ?? [], [currentStream]);

  /* ------------------------ Φόρτωση / σφάλμα (παράγωγα) ----------------- */
  let loading: boolean;
  if (shopIdOverride) {
    loading = !currentStream?.loaded;
  } else if (!uid) {
    loading = false;
  } else if (!currentLookup) {
    loading = true;
  } else {
    loading = currentLookup.shopId !== null && !currentStream?.loaded;
  }

  const error = (shopIdOverride ? null : currentLookup?.error) ?? currentStream?.error ?? null;

  /* --------------------------- 3. Ομαδοποίηση --------------------------- */
  const { pendingOrders, activeOrders, completedOrders } = useMemo(() => {
    const pending: AdminOrder[] = [];
    const active: AdminOrder[] = [];
    const completed: AdminOrder[] = [];

    for (const order of orders) {
      if (order.status === "pending") {
        pending.push(order);
      } else if (order.status === "completed" || order.status === "cancelled") {
        completed.push(order);
      } else {
        active.push(order);
      }
    }

    /* Οι νέες παραγγελίες: η παλαιότερη πρώτη — αυτή περιμένει περισσότερο */
    pending.reverse();

    return { pendingOrders: pending, activeOrders: active, completedOrders: completed };
  }, [orders]);

  /* ------------------------ 4. Αλλαγή κατάστασης ------------------------ */
  const updateStatus = useCallback(async (orderId: string, status: OrderStatus) => {
    setUpdatingId(orderId);
    try {
      /* Τα Security Rules επιτρέπουν ΜΟΝΟ αυτά τα πεδία — κανένα οικονομικό */
      await updateDoc(doc(db, "orders", orderId), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (caught) {
      console.error("[admin] Αποτυχία αλλαγής κατάστασης:", caught);
      throw new Error("Δεν ήταν δυνατή η ενημέρωση της παραγγελίας.");
    } finally {
      setUpdatingId(null);
    }
  }, []);

  return {
    shopId,
    shopName: shopIdOverride ? null : (currentLookup?.shopName ?? null),
    orders,
    pendingOrders,
    activeOrders,
    completedOrders,
    loading,
    error,
    updateStatus,
    updatingId,
  };
}
