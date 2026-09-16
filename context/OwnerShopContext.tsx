"use client";

/* ==========================================================================
 *  Buka Delivery — context/OwnerShopContext.tsx
 *
 *  Βρίσκει ΜΙΑ ΦΟΡΑ ποιο κατάστημα ανήκει στον συνδεδεμένο χρήστη και το
 *  μοιράζεται σε όλες τις σελίδες του admin.
 *
 *  Χωρίς αυτό, κάθε σελίδα (παραγγελίες, κατάλογος, ρυθμίσεις) θα έκανε το
 *  δικό της ερώτημα «ποιο shop έχει ownerUid == το uid μου», με τη δική της
 *  κατάσταση φόρτωσης και τα δικά της μηνύματα λάθους — τριπλός κώδικας για
 *  μία πληροφορία που δεν αλλάζει.
 *
 *  Χρήση σε οποιαδήποτε σελίδα του admin:
 *    const { shopId, shop } = useOwnerShop();
 *
 *  ΠΡΟΫΠΟΘΕΣΗ: το document του καταστήματος έχει πεδίο `ownerUid` με το uid
 *  του καταστηματάρχη. Ορίζεται από το Firebase Console (δες το μήνυμα
 *  λάθους παρακάτω, που το εξηγεί και στον ίδιο τον χρήστη).
 * ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import type { Shop } from "@/types";

type OwnerShopContextValue = {
  shopId: string | null;
  shopName: string | null;
  shop: Shop | null;
  /** true όσο ψάχνουμε το κατάστημα */
  loading: boolean;
  error: string | null;
  /** Ξαναδοκιμάζει μετά από σφάλμα */
  retry: () => void;
};

const OwnerShopContext = createContext<OwnerShopContextValue | null>(null);

export function OwnerShopProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setShop(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    /* onSnapshot αντί για getDocs: αν ο διαχειριστής ορίσει τώρα το ownerUid
     * ή αλλάξει το όνομα/ωράριο του μαγαζιού, το panel το δείχνει αμέσως. */
    const unsubscribe = onSnapshot(
      query(collection(db, "shops"), where("ownerUid", "==", user.uid), limit(1)),
      (snapshot) => {
        const document = snapshot.docs[0];

        if (!document) {
          setShop(null);
          setError(
            "Ο λογαριασμός σου δεν είναι συνδεδεμένος με κατάστημα. Ζήτα από " +
              "τον διαχειριστή του Buka να ορίσει το πεδίο ownerUid στο " +
              "κατάστημά σου.",
          );
        } else {
          setShop({
            ...(document.data() as Omit<Shop, "id">),
            id: document.id,
          });
          setError(null);
        }

        setLoading(false);
      },
      (caught) => {
        console.error("[owner-shop] Αποτυχία εύρεσης καταστήματος:", caught);
        setError("Δεν ήταν δυνατή η φόρτωση του καταστήματος.");
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [user, isAuthenticated, attempt]);

  const value = useMemo<OwnerShopContextValue>(
    () => ({
      shopId: shop?.id ?? null,
      shopName: shop?.name ?? null,
      shop,
      loading,
      error,
      retry,
    }),
    [shop, loading, error, retry],
  );

  return (
    <OwnerShopContext.Provider value={value}>{children}</OwnerShopContext.Provider>
  );
}

export function useOwnerShop(): OwnerShopContextValue {
  const context = useContext(OwnerShopContext);
  if (!context) {
    throw new Error(
      "Το useOwnerShop() πρέπει να χρησιμοποιείται μέσα σε <OwnerShopProvider> " +
        "(μπαίνει στο app/(admin)/layout.tsx).",
    );
  }
  return context;
}
