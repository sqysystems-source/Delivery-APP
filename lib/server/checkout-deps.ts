/* ==========================================================================
 *  Buka Delivery — lib/server/checkout-deps.ts
 *
 *  Οι πραγματικές εξαρτήσεις (Firebase Admin SDK) του checkout-service.
 *  Κοινές για POST /api/orders και POST /api/orders/recover.
 * ========================================================================== */

import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CheckoutDeps } from "@/lib/server/checkout-service";
import { createFirestoreCheckoutStore } from "@/lib/server/firestore-checkout-store";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";

/** Πετά ServerConfigError όταν λείπει/είναι άκυρο το FIREBASE_SERVICE_ACCOUNT */
export function createCheckoutDeps(): CheckoutDeps {
  const auth = getAdminAuth();
  const db = getAdminDb();

  return {
    store: createFirestoreCheckoutStore(db),
    verifyIdToken: (token) => auth.verifyIdToken(token),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    timestampFromMillis: (ms) => Timestamp.fromMillis(ms),
    now: () => Date.now(),
    logger: console,
  };
}
