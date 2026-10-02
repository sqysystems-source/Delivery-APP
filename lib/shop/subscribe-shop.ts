/* ==========================================================================
 *  Buka Delivery — lib/shop/subscribe-shop.ts   (milestone 4, browser)
 *
 *  ΕΝΑΣ listener (onSnapshot) στο shops/{shopId}: η βιτρίνα και το checkout
 *  μαθαίνουν αμέσως παύση, αλλαγή ωραρίου ή ζωνών — χωρίς polling. Η αλλαγή
 *  κατάστασης ΛΟΓΩ ΩΡΑΣ (π.χ. 23:00 κλείνει) γίνεται με χρονόμετρο στο
 *  hooks/useShopAvailability.ts, όχι με νέες αναγνώσεις.
 *
 *  Αν το Firestore δεν είναι διαθέσιμο (π.χ. αποτυχία αρχικοποίησης), ο
 *  καλών παίρνει onError — ποτέ εξαίρεση μέσα στο render.
 * ========================================================================== */

import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ShopSnapshotHandler = (data: Record<string, unknown> | null) => void;

export type SubscribeShop = (
  shopId: string,
  onData: ShopSnapshotHandler,
  onError: (error: unknown) => void,
) => () => void;

export const subscribeShopDocument: SubscribeShop = (shopId, onData, onError) => {
  try {
    return onSnapshot(
      doc(db, "shops", shopId),
      (snapshot) => {
        if (snapshot.exists()) {
          onData(snapshot.data() as Record<string, unknown>);
        } else if (snapshot.metadata.fromCache) {
          // Εκτός σύνδεσης: «δεν υπάρχει στην cache» ≠ «δεν υπάρχει» — δεν μαντεύουμε
          onError(new Error("Το κατάστημα δεν είναι διαθέσιμο εκτός σύνδεσης."));
        } else {
          onData(null);
        }
      },
      (error) => onError(error),
    );
  } catch (error) {
    onError(error);
    return () => {};
  }
};
