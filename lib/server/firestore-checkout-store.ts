/* ==========================================================================
 *  Buka Delivery — lib/server/firestore-checkout-store.ts
 *
 *  Υλοποίηση του CheckoutStore πάνω στο Firebase Admin SDK.
 *
 *  ── ΓΙΑΤΙ ΕΙΝΑΙ ΑΤΟΜΙΚΟ ─────────────────────────────────────────────────
 *  Όλη η δημιουργία γίνεται μέσα σε db.runTransaction():
 *    • Η συναλλαγή ΔΙΑΒΑΖΕΙ το έγγραφο checkoutRequests/{id}. Στο Admin SDK
 *      οι αναγνώσεις συναλλαγής κλειδώνουν τα έγγραφα, οπότε δύο ταυτόχρονα
 *      αιτήματα με το ίδιο κλειδί σειριοποιούνται: το δεύτερο είτε περιμένει
 *      είτε ξαναδοκιμάζει και βλέπει το αποτέλεσμα του πρώτου.
 *    • Η παραγγελία και το αποτέλεσμα του κλειδιού γράφονται με `create`
 *      (αποτυγχάνει αν το έγγραφο υπάρχει) στο ΙΔΙΟ commit — ή γράφονται και
 *      τα δύο, ή κανένα.
 *
 *  Το ίδιο ισχύει για το κλείσιμο προσπάθειας (/api/orders/recover): ο
 *  έλεγχος «υπάρχει;» και η εγγραφή «κλειστή» γίνονται στην ίδια συναλλαγή,
 *  με `create`, άρα δεν μπορούν να συνυπάρξουν παραγγελία και κλείσιμο.
 *
 *  Το collection checkoutRequests είναι μόνο για τον server: τα Security
 *  Rules δεν έχουν κανόνα γι' αυτό, οπότε ο browser δεν έχει καμία πρόσβαση.
 * ========================================================================== */

import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  CHECKOUT_REQUESTS_COLLECTION,
  parseIdempotencyRecord,
  type CheckoutStore,
} from "@/lib/server/checkout-service";

/** gRPC ALREADY_EXISTS */
const ALREADY_EXISTS = 6;

export function createFirestoreCheckoutStore(db: Firestore): CheckoutStore {
  const requests = db.collection(CHECKOUT_REQUESTS_COLLECTION);
  const orders = db.collection("orders");

  return {
    async getIdempotencyRecord(recordId) {
      const snapshot = await requests.doc(recordId).get();
      return snapshot.exists ? parseIdempotencyRecord(snapshot.data()) : null;
    },

    /* Απαιτεί το composite index orders: userId ASC + createdAt DESC
     * (το ίδιο που χρησιμοποιούσε ήδη η προηγούμενη έκδοση). */
    async countRecentOrders(uid, sinceMs, limit) {
      const snapshot = await orders
        .where("userId", "==", uid)
        .where("createdAt", ">", Timestamp.fromMillis(sinceMs))
        .orderBy("createdAt", "desc")
        .limit(limit + 1)
        .get();
      return snapshot.size;
    },

    newOrderId() {
      return orders.doc().id;
    },

    runTransaction(fn) {
      return db.runTransaction(
        (transaction) =>
          fn({
            async getIdempotencyRecord(recordId) {
              const snapshot = await transaction.get(requests.doc(recordId));
              return snapshot.exists ? parseIdempotencyRecord(snapshot.data()) : null;
            },

            async getShop(shopId) {
              const snapshot = await transaction.get(db.collection("shops").doc(shopId));
              return snapshot.exists ? (snapshot.data() ?? {}) : null;
            },

            async getMenuItems(shopId, itemIds) {
              if (itemIds.length === 0) return [];
              const menuItems = db.collection("shops").doc(shopId).collection("menuItems");
              const snapshots = await transaction.getAll(
                ...itemIds.map((itemId) => menuItems.doc(itemId)),
              );
              return snapshots.map((snapshot) => (snapshot.exists ? (snapshot.data() ?? {}) : null));
            },

            createOrderWithRecord({ orderId, order, recordId, record }) {
              transaction.create(orders.doc(orderId), order);
              transaction.create(requests.doc(recordId), record);
            },

            /* Milestone 2: «κλειστή» προσπάθεια — create, ώστε αν το αρχικό
             * αίτημα πρόλαβε να γράψει, η συναλλαγή αποτυγχάνει με
             * ALREADY_EXISTS και ο καλών διαβάζει το αποτέλεσμά του. */
            createClosedAttempt({ recordId, record }) {
              transaction.create(requests.doc(recordId), record);
            },
          }),
        { maxAttempts: 5 },
      );
    },

    isAlreadyExistsError(error) {
      if (typeof error !== "object" || error === null) return false;
      const code = (error as { code?: unknown }).code;
      return code === ALREADY_EXISTS || code === "already-exists" || code === "ALREADY_EXISTS";
    },
  };
}
