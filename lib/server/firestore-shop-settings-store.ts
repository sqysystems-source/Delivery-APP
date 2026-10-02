/* ==========================================================================
 *  Buka Delivery — lib/server/firestore-shop-settings-store.ts   (milestone 4)
 *
 *  Υλοποίηση του ShopSettingsStore πάνω στο Firebase Admin SDK. Η ανάγνωση
 *  του καταστήματος (έλεγχος ΤΡΕΧΟΝΤΟΣ ιδιοκτήτη) και η εγγραφή γίνονται στην
 *  ΙΔΙΑ συναλλαγή. Η εγγραφή είναι `update`: αγγίζει μόνο τα δοσμένα πεδία.
 * ========================================================================== */

import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { SETTINGS_DELETE_FIELD, type ShopSettingsStore } from "@/lib/server/shop-settings-service";

function materialize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value === SETTINGS_DELETE_FIELD ? FieldValue.delete() : value]),
  );
}

export function createFirestoreShopSettingsStore(db: Firestore): ShopSettingsStore {
  const shop = (shopId: string) => db.collection("shops").doc(shopId);

  return {
    runTransaction(fn) {
      return db.runTransaction(
        (transaction) =>
          fn({
            async getShop(shopId) {
              const snapshot = await transaction.get(shop(shopId));
              return snapshot.exists ? (snapshot.data() ?? {}) : null;
            },
            updateShop(shopId, data) {
              transaction.update(shop(shopId), materialize(data));
            },
          }),
        { maxAttempts: 5 },
      );
    },
  };
}
