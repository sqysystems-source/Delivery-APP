/* ==========================================================================
 *  Buka Delivery — lib/server/firebase-admin.ts
 *
 *  Αρχικοποίηση Firebase Admin SDK — ΜΟΝΟ για server.
 *
 *  Το `import "server-only"` κάνει το build να αποτύχει αν κάποιο Client
 *  Component προσπαθήσει να εισαγάγει αυτό το αρχείο: τα διαπιστευτήρια του
 *  service account δεν μπορούν να καταλήξουν στο bundle του browser.
 *
 *  Μεταβλητή περιβάλλοντος (Vercel → Settings → Environment Variables):
 *    FIREBASE_SERVICE_ACCOUNT = ολόκληρο το JSON του service account
 * ========================================================================== */

import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

type ServiceAccountJson = {
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
};

export function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new ServerConfigError("Λείπει η μεταβλητή περιβάλλοντος FIREBASE_SERVICE_ACCOUNT.");
  }

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(raw) as ServiceAccountJson;
  } catch {
    throw new ServerConfigError("Η FIREBASE_SERVICE_ACCOUNT δεν είναι έγκυρο JSON.");
  }

  if (
    typeof parsed.project_id !== "string" ||
    typeof parsed.client_email !== "string" ||
    typeof parsed.private_key !== "string"
  ) {
    throw new ServerConfigError(
      "Η FIREBASE_SERVICE_ACCOUNT δεν έχει project_id / client_email / private_key.",
    );
  }

  return initializeApp({
    credential: cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    }),
  });
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
