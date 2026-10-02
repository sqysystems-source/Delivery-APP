/* ==========================================================================
 *  Buka Delivery — lib/server/firestore-menu-store.ts   (milestone 3)
 *
 *  Υλοποίηση του MenuWriteStore πάνω στο Firebase Admin SDK. Η ανάγνωση του
 *  καταστήματος (έλεγχος ιδιοκτήτη), της κατηγορίας, του προϊόντος και η
 *  εγγραφή γίνονται στην ΙΔΙΑ συναλλαγή.
 * ========================================================================== */

import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { DELETE_FIELD, type MenuWriteStore } from "@/lib/server/menu-item-service";

function materialize(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value === DELETE_FIELD ? FieldValue.delete() : value]),
  );
}

export function createFirestoreMenuStore(db: Firestore): MenuWriteStore {
  const shop = (shopId: string) => db.collection("shops").doc(shopId);

  return {
    newItemId(shopId) {
      return shop(shopId).collection("menuItems").doc().id;
    },

    runTransaction(fn) {
      return db.runTransaction(
        (transaction) =>
          fn({
            async getShop(shopId) {
              const snapshot = await transaction.get(shop(shopId));
              return snapshot.exists ? (snapshot.data() ?? {}) : null;
            },
            async getCategory(shopId, categoryId) {
              const snapshot = await transaction.get(shop(shopId).collection("menuCategories").doc(categoryId));
              return snapshot.exists ? (snapshot.data() ?? {}) : null;
            },
            async getItem(shopId, itemId) {
              const snapshot = await transaction.get(shop(shopId).collection("menuItems").doc(itemId));
              return snapshot.exists ? (snapshot.data() ?? {}) : null;
            },
            createItem(shopId, itemId, data) {
              transaction.create(shop(shopId).collection("menuItems").doc(itemId), materialize(data));
            },
            updateItem(shopId, itemId, data) {
              transaction.update(shop(shopId).collection("menuItems").doc(itemId), materialize(data));
            },
          }),
        { maxAttempts: 5 },
      );
    },
  };
}
