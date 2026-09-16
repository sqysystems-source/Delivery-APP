"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useAdminOrders.ts
 *
 *  Ζωντανή ροή παραγγελιών για το κατάστημα, με onSnapshot.
 *
 *  ── ΠΩΣ ΒΡΙΣΚΕΙ ΤΟ ΚΑΤΑΣΤΗΜΑ ────────────────────────────────────────────
 *  Ερώτημα στο `shops` με ownerUid == uid. Άρα, για να δουλέψει το panel,
 *  το document του καταστήματος πρέπει να έχει το πεδίο `ownerUid` με το
 *  uid του λογαριασμού του καταστηματάρχη (το seed έγραψε `null`).
 *
 *  Πώς το ορίζεις χωρίς terminal:
 *    1. Ο καταστηματάρχης κάνει εγγραφή κανονικά στο site
 *    2. Firebase Console → Authentication → Users → αντιγράφεις το User UID
 *    3. Firestore → shops → <το κατάστημα> → πεδίο ownerUid → επικόλληση
 *
 *  ── COMPOSITE INDEX (ΑΠΑΡΑΙΤΗΤΟ) ───────────────────────────────────────
 *    Collection: orders
 *    Πεδία: shopId (Ascending), createdAt (Descending)
 *  Χωρίς αυτό, το ερώτημα αποτυγχάνει με FAILED_PRECONDITION.
 *
 *  ── ΚΟΣΤΟΣ ──────────────────────────────────────────────────────────────
 *  Το onSnapshot χρεώνει reads μόνο για ό,τι αλλάζει, όχι ανά δευτερόλεπτο.
 *  Το φίλτρο 24ώρου κρατά το αρχικό snapshot μικρό: μια ταμειακή που μένει
 *  ανοιχτή όλη μέρα δεν ξαναδιαβάζει ποτέ το ιστορικό μηνών.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { OrderStatus } from "@/types";

/* --------------------------------------------------------------------------
 *  Τύποι
 * -------------------------------------------------------------------------- */

export type AdminOrderLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type AdminOrder = {
  id: string;
  /** Ο κωδικός που βλέπει ο πελάτης, π.χ. «BK-7F3A21» */
  code: string;
  shopId: string;
  shopName: string;
  address: string;
  lines: AdminOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  userId: string;
  notes?: string;
  /** null όσο το serverTimestamp δεν έχει επιβεβαιωθεί από τον server */
  createdAt: Date | null;
};

/** Πόσες ώρες πίσω φορτώνει το ταμπλό */
const HOURS_WINDOW = 24;
const MAX_ORDERS = 200;

/* --------------------------------------------------------------------------
 *  Μετατροπή document → AdminOrder (ανθεκτική σε ελλιπή πεδία)
 * -------------------------------------------------------------------------- */

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toLines(value: unknown): AdminOrderLine[] {
  if (!Array.isArray(value)) return [];

  return value.map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const unitPrice = toNumber(line.unitPrice);
    const quantity = toNumber(line.quantity);

    return {
      itemId: typeof line.itemId === "string" ? line.itemId : "",
      name: typeof line.name === "string" ? line.name : "Προϊόν",
      unitPrice,
      quantity,
      lineTotal: line.lineTotal !== undefined ? toNumber(line.lineTotal) : unitPrice * quantity,
    };
  });
}

const VALID_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "delivering",
  "completed",
  "cancelled",
];

function toStatus(value: unknown): OrderStatus {
  return VALID_STATUSES.includes(value as OrderStatus)
    ? (value as OrderStatus)
    : "pending";
}

function mapOrder(id: string, data: Record<string, unknown>): AdminOrder {
  return {
    id,
    code: `BK-${id.slice(0, 6).toUpperCase()}`,
    shopId: typeof data.shopId === "string" ? data.shopId : "",
    shopName: typeof data.shopName === "string" ? data.shopName : "",
    address: typeof data.address === "string" ? data.address : "",
    lines: toLines(data.lines),
    subtotal: toNumber(data.subtotal),
    deliveryFee: toNumber(data.deliveryFee),
    total: toNumber(data.total),
    status: toStatus(data.status),
    userId: typeof data.userId === "string" ? data.userId : "",
    notes: typeof data.notes === "string" ? data.notes : undefined,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
  };
}

/* --------------------------------------------------------------------------
 *  Το hook
 * -------------------------------------------------------------------------- */

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

/**
 * @param shopIdOverride — για λογαριασμούς admin που βλέπουν άλλο κατάστημα
 */
export function useAdminOrders(shopIdOverride?: string): UseAdminOrders {
  const { user, isAuthenticated } = useAuth();

  const [shopId, setShopId] = useState<string | null>(shopIdOverride ?? null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  /* Το αρχικό snapshot δεν πρέπει να χτυπήσει συναγερμό για παλιές παραγγελίες */
  const firstSnapshotRef = useRef(true);

  /* ------------------- 1. Ποιο κατάστημα ανήκει στον χρήστη ------------- */
  useEffect(() => {
    if (shopIdOverride) {
      setShopId(shopIdOverride);
      return;
    }

    if (!isAuthenticated || !user) {
      setShopId(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    getDocs(
      query(collection(db, "shops"), where("ownerUid", "==", user.uid), limit(1)),
    )
      .then((snapshot) => {
        if (cancelled) return;

        const document = snapshot.docs[0];
        if (!document) {
          setShopId(null);
          setError(
            "Ο λογαριασμός σου δεν είναι συνδεδεμένος με κατάστημα. " +
              "Ζήτα από τον διαχειριστή να ορίσει το πεδίο ownerUid στο κατάστημά σου.",
          );
          setLoading(false);
          return;
        }

        setShopId(document.id);
        setShopName((document.data().name as string) ?? document.id);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        console.error("[admin] Αποτυχία εύρεσης καταστήματος:", caught);
        setError("Δεν ήταν δυνατή η φόρτωση του καταστήματος.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, isAuthenticated, shopIdOverride]);

  /* ---------------------- 2. Ζωντανή ροή παραγγελιών -------------------- */
  useEffect(() => {
    if (!shopId) return;

    setLoading(true);
    firstSnapshotRef.current = true;

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
        setOrders(
          snapshot.docs.map((document) =>
            mapOrder(document.id, document.data() as Record<string, unknown>),
          ),
        );
        firstSnapshotRef.current = false;
        setError(null);
        setLoading(false);
      },
      (caught) => {
        console.error("[admin] Σφάλμα ροής παραγγελιών:", caught);
        setError(
          caught.code === "failed-precondition"
            ? "Λείπει το composite index (orders: shopId ASC + createdAt DESC). " +
                "Δες τα logs για τον έτοιμο σύνδεσμο δημιουργίας."
            : caught.code === "permission-denied"
              ? "Δεν έχεις δικαίωμα πρόσβασης στις παραγγελίες αυτού του καταστήματος."
              : "Χάθηκε η σύνδεση με τη βάση. Προσπάθεια επανασύνδεσης…",
        );
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [shopId]);

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

    return {
      pendingOrders: pending,
      activeOrders: active,
      completedOrders: completed,
    };
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
    shopName,
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
