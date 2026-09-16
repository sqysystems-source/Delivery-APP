/* ==========================================================================
 *  Buka Delivery — lib/auth.ts
 *
 *  Όλη η λογική ταυτοποίησης σε ένα σημείο. Τα components δεν καλούν ποτέ
 *  απευθείας το Firebase Auth — καλούν αυτές τις συναρτήσεις, οι οποίες
 *  επιστρέφουν πάντα καθαρά ελληνικά μηνύματα λάθους.
 *
 *  ── ΤΟ ΚΡΙΣΙΜΟ ΣΗΜΕΙΟ: ΑΝΑΒΑΘΜΙΣΗ ΑΝΩΝΥΜΟΥ ΛΟΓΑΡΙΑΣΜΟΥ ─────────────────
 *  Η εφαρμογή ήδη κάνει anonymous sign-in στο checkout. Αν ένας τέτοιος
 *  χρήστης κάνει αργότερα εγγραφή, ΔΕΝ φτιάχνουμε νέο λογαριασμό: κάνουμε
 *  linkWithCredential() πάνω στον υπάρχοντα. Έτσι κρατάει το ίδιο uid και
 *  μαζί του όλο το ιστορικό παραγγελιών του.
 *
 *  Αν φτιάχναμε νέο λογαριασμό, ο πελάτης θα έχανε τις παραγγελίες που
 *  μόλις έκανε — και θα το ανακάλυπτε την πιο άβολη στιγμή.
 *
 *  ── ΠΡΟΫΠΟΘΕΣΗ ──────────────────────────────────────────────────────────
 *  Firebase Console → Authentication → Sign-in method:
 *    • Anonymous       → Enabled  (ήδη)
 *    • Email/Password  → Enabled  (ΝΕΟ — χωρίς αυτό θα παίρνεις
 *                                  auth/operation-not-allowed)
 * ========================================================================== */

import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

/* ==========================================================================
 *  ΤΥΠΟΙ
 *  (Αν προτιμάς, μετακίνησέ τους στο types/index.ts — απλώς άλλαξε τα imports)
 * ========================================================================== */

/** Μια αποθηκευμένη διεύθυνση του χρήστη (στοιχείο του πίνακα `addresses`) */
export type UserAddress = {
  id: string;
  label: string;
  street: string;
  city?: string;
  notes?: string;
  isDefault?: boolean;
};

/** Το document users/{uid} */
export type UserProfile = {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  addresses: UserAddress[];
  /** ISO string — μετατρέπεται από Firestore Timestamp */
  createdAt: string | null;
  updatedAt: string | null;
  role: "customer" | "owner" | "admin";
};

export type RegisterInput = {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
};

/* ==========================================================================
 *  ΜΗΝΥΜΑΤΑ ΛΑΘΟΥΣ
 * ========================================================================== */

const ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Το email δεν είναι έγκυρο.",
  "auth/user-disabled": "Ο λογαριασμός έχει απενεργοποιηθεί.",
  "auth/user-not-found": "Δεν βρέθηκε λογαριασμός με αυτό το email.",
  "auth/wrong-password": "Λάθος κωδικός.",
  "auth/invalid-credential": "Λάθος email ή κωδικός.",
  "auth/email-already-in-use":
    "Υπάρχει ήδη λογαριασμός με αυτό το email. Δοκίμασε σύνδεση.",
  "auth/credential-already-in-use":
    "Υπάρχει ήδη λογαριασμός με αυτό το email. Δοκίμασε σύνδεση.",
  "auth/weak-password": "Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.",
  "auth/too-many-requests":
    "Πολλές προσπάθειες. Περίμενε λίγα λεπτά και δοκίμασε ξανά.",
  "auth/network-request-failed": "Πρόβλημα σύνδεσης. Έλεγξε το internet σου.",
  "auth/operation-not-allowed":
    "Η σύνδεση με email δεν είναι ενεργοποιημένη στο Firebase Console.",
  "auth/requires-recent-login":
    "Για ασφάλεια, κάνε ξανά σύνδεση πριν από αυτή την ενέργεια.",
  "permission-denied": "Δεν έχεις δικαίωμα για αυτή την ενέργεια.",
};

/** Μετατρέπει οποιοδήποτε σφάλμα Firebase σε κατανοητό ελληνικό μήνυμα */
export function authErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  }
  if (error instanceof Error && error.message) return error.message;
  return "Κάτι πήγε στραβά. Δοκίμασε ξανά.";
}

/* ==========================================================================
 *  ΒΟΗΘΗΤΙΚΑ
 * ========================================================================== */

function timestampToIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return null;
}

/** Μετατρέπει το Firestore document σε UserProfile με ασφαλείς προεπιλογές */
export function mapUserProfile(uid: string, data: Record<string, unknown>): UserProfile {
  const role = data.role;

  return {
    uid,
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    email: typeof data.email === "string" ? data.email : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    addresses: Array.isArray(data.addresses) ? (data.addresses as UserAddress[]) : [],
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    role: role === "owner" || role === "admin" ? role : "customer",
  };
}

/* ==========================================================================
 *  ΔΗΜΙΟΥΡΓΙΑ ΠΡΟΦΙΛ ΣΤΟ FIRESTORE
 * ========================================================================== */

/**
 * Γράφει το users/{uid} document.
 *
 * Το `role` γράφεται πάντα ως "customer" και τα Security Rules απαγορεύουν
 * στον χρήστη να το αλλάξει ποτέ. Η αναβάθμιση σε "owner"/"admin" γίνεται
 * μόνο από το Admin SDK.
 */
async function createProfileDocument(user: User, input: RegisterInput): Promise<void> {
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    fullName: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() ?? "",
    addresses: [],
    role: "customer",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Εξασφαλίζει ότι ο συνδεδεμένος χρήστης έχει profile document.
 *
 * Χρειάζεται για λογαριασμούς που δημιουργήθηκαν πριν μπει αυτό το σύστημα,
 * ή στο σπάνιο σενάριο όπου η εγγραφή πέτυχε στο Auth αλλά η εγγραφή στο
 * Firestore απέτυχε (π.χ. έπεσε το δίκτυο ανάμεσα στα δύο βήματα).
 *
 * ΔΕΝ κάνει merge σε υπάρχον document: τα rules απαγορεύουν αλλαγή του
 * createdAt, οπότε ένα τυφλό setDoc θα απορριπτόταν.
 */
export async function ensureProfileDocument(user: User): Promise<void> {
  if (user.isAnonymous) return;

  const reference = doc(db, "users", user.uid);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) return;

  await createProfileDocument(user, {
    fullName: user.displayName ?? "",
    email: user.email ?? "",
    password: "",
  });
}

/* ==========================================================================
 *  ΕΓΓΡΑΦΗ
 * ========================================================================== */

export async function registerWithEmail(input: RegisterInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const current = auth.currentUser;

  let user: User;

  if (current?.isAnonymous) {
    /* Αναβάθμιση του ανώνυμου λογαριασμού — κρατά το ίδιο uid */
    const credential = EmailAuthProvider.credential(email, input.password);
    const result = await linkWithCredential(current, credential);
    user = result.user;
  } else {
    const result = await createUserWithEmailAndPassword(auth, email, input.password);
    user = result.user;
  }

  /* Το displayName ζει στο Auth και είναι διαθέσιμο χωρίς read στο Firestore */
  await updateProfile(user, { displayName: fullName });

  await createProfileDocument(user, { ...input, fullName, email });

  return user;
}

/* ==========================================================================
 *  ΣΥΝΔΕΣΗ / ΑΠΟΣΥΝΔΕΣΗ
 * ========================================================================== */

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(
    auth,
    email.trim().toLowerCase(),
    password,
  );

  // Δίχτυ ασφαλείας για παλιούς ή ημιτελείς λογαριασμούς
  await ensureProfileDocument(result.user).catch(() => {
    /* Αν αποτύχει, η σύνδεση παραμένει έγκυρη — το προφίλ θα φτιαχτεί αργότερα */
  });

  return result.user;
}

export async function logout(): Promise<void> {
  await signOut(auth);
}

export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

/* ==========================================================================
 *  ΕΝΗΜΕΡΩΣΗ ΠΡΟΦΙΛ
 * ========================================================================== */

export async function updateUserProfile(
  uid: string,
  changes: Partial<Pick<UserProfile, "fullName" | "phone" | "addresses">>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

  if (changes.fullName !== undefined) payload.fullName = changes.fullName.trim();
  if (changes.phone !== undefined) payload.phone = changes.phone.trim();
  if (changes.addresses !== undefined) payload.addresses = changes.addresses;

  await updateDoc(doc(db, "users", uid), payload);

  /* Κρατάμε το displayName του Auth συγχρονισμένο με το προφίλ */
  if (changes.fullName !== undefined && auth.currentUser?.uid === uid) {
    await updateProfile(auth.currentUser, { displayName: changes.fullName.trim() });
  }
}

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ ΦΟΡΜΩΝ (client-side — τα rules ελέγχουν ξανά στον server)
 * ========================================================================== */

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return "Συμπλήρωσε το email σου.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "Το email δεν είναι έγκυρο.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return "Συμπλήρωσε κωδικό.";
  if (password.length < 6) return "Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες.";
  return null;
}

export function validateFullName(fullName: string): string | null {
  const value = fullName.trim();
  if (!value) return "Συμπλήρωσε το ονοματεπώνυμό σου.";
  if (value.length < 2) return "Το όνομα είναι πολύ σύντομο.";
  if (value.length > 80) return "Το όνομα είναι πολύ μεγάλο.";
  return null;
}

/** Το τηλέφωνο είναι προαιρετικό — ελέγχεται μόνο αν συμπληρωθεί */
export function validatePhone(phone: string): string | null {
  const value = phone.trim();
  if (!value) return null;

  const digits = value.replace(/[\s-]/g, "");
  if (!/^(\+30)?[2-7]\d{9}$/.test(digits)) {
    return "Το τηλέφωνο δεν είναι έγκυρο (10 ψηφία).";
  }
  return null;
}

/** Αρχικά ονόματος για το avatar, π.χ. «Κώστας Παπαδόπουλος» → «ΚΠ» */
export function getInitials(name: string, fallback = "?"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
