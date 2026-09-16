/* ==========================================================================
 *  Buka Delivery — lib/firebase.ts
 *
 *  Αρχικοποίηση του Firebase Client SDK (τρέχει στον browser).
 *
 *  Γιατί `getApps().length ? getApp() : initializeApp(...)`:
 *  στο dev, το Fast Refresh του Next εκτελεί ξανά το module και μια δεύτερη
 *  initializeApp() θα πετούσε «Firebase App named '[DEFAULT]' already exists».
 *
 *  Εγκατάσταση:
 *    npm i firebase
 *
 *  Μεταβλητές περιβάλλοντος: δες το .env.local.example.
 *  Όλες είναι NEXT_PUBLIC_*, δηλαδή ΔΗΜΟΣΙΕΣ. Αυτό είναι φυσιολογικό στο
 *  Firebase — το apiKey δεν είναι μυστικό, είναι αναγνωριστικό του project.
 *  Την πραγματική προστασία την κάνουν ΑΠΟΚΛΕΙΣΤΙΚΑ τα Security Rules.
 * ========================================================================== */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
  type User,
} from "firebase/auth";

/* --------------------------------------------------------------------------
 *  Ρυθμίσεις
 * -------------------------------------------------------------------------- */

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Καθαρό μήνυμα λάθους αντί για κρυπτικό σφάλμα του SDK */
if (!firebaseConfig.projectId) {
  throw new Error(
    "[Buka] Λείπουν οι μεταβλητές Firebase. Αντίγραψε το .env.local.example " +
      "σε .env.local και συμπλήρωσε τα στοιχεία του project σου.",
  );
}

/* --------------------------------------------------------------------------
 *  Singletons
 * -------------------------------------------------------------------------- */

export const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);

/* --------------------------------------------------------------------------
 *  Emulators (τοπική ανάπτυξη χωρίς κόστος και χωρίς ρίσκο)
 *
 *    firebase emulators:start --only firestore,auth
 *    NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 στο .env.local
 * -------------------------------------------------------------------------- */

declare global {
  // eslint-disable-next-line no-var
  var __bukaEmulatorsConnected: boolean | undefined;
}

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1" &&
  !globalThis.__bukaEmulatorsConnected
) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  globalThis.__bukaEmulatorsConnected = true;
}

/* --------------------------------------------------------------------------
 *  Auth
 *
 *  Κάθε παραγγελία απαιτεί ταυτότητα χρήστη, ώστε τα Security Rules να
 *  μπορούν να δέσουν την παραγγελία με το uid. Μέχρι να μπει κανονική
 *  σύνδεση, χρησιμοποιούμε anonymous auth: μηδενική τριβή για τον πελάτη
 *  και, αργότερα, ο ανώνυμος λογαριασμός αναβαθμίζεται σε κανονικό με
 *  linkWithCredential() χωρίς να χαθεί το ιστορικό παραγγελιών.
 *
 *  Στο Firebase Console: Authentication → Sign-in method → Anonymous → Enable.
 * -------------------------------------------------------------------------- */

/** Επιστρέφει το uid του τρέχοντος χρήστη, κάνοντας anonymous sign-in αν χρειαστεί */
export async function ensureSignedIn(): Promise<string> {
  if (auth.currentUser) return auth.currentUser.uid;

  // Περιμένουμε πρώτα να αποκατασταθεί τυχόν υπάρχον session από το storage
  const existing = await new Promise<User | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });

  if (existing) return existing.uid;

  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}
