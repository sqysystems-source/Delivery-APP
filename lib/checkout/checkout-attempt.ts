/* ==========================================================================
 *  Buka Delivery — lib/checkout/checkout-attempt.ts   (milestone 2)
 *
 *  Η ΜΟΝΗ πληροφορία checkout που επιβιώνει σε ανανέωση σελίδας: ποιο
 *  κλειδί idempotency στάλθηκε, από ποιον uid, και πότε.
 *
 *    { v: 1, attempts: [{ uid, key, startedAt }] }   ← localStorage
 *
 *  ΚΑΝΕΝΑ όνομα, τηλέφωνο, διεύθυνση, σχόλιο ή ποσό. Το αποθηκευμένο κλειδί
 *  ΔΕΝ είναι εξουσιοδότηση: ο server απαντά μόνο για τον uid του Firebase ID
 *  token (το id του εγγράφου είναι sha256(uid ␀ key)).
 *
 *  Κύκλος ζωής:
 *    • γράφεται ΑΜΕΣΩΣ πριν φύγει το αίτημα (μετά την ταυτοποίηση)
 *    • σβήνεται σε οριστική απάντηση (επιτυχία ή οριστική απόρριψη)
 *    • μένει σε αβέβαιη αποτυχία → μετά από ανανέωση η σελίδα ρωτά το
 *      POST /api/orders/recover, ΧΩΡΙΣ να ξαναστείλει την παραγγελία
 *    • παλαιότερο από ATTEMPT_MAX_AGE_MS → δεν ελέγχεται αυτόματα (ο server
 *      κρατά τις εγγραφές 7 ημέρες· μετά το TTL ένας έλεγχος θα ήταν άκυρος)
 * ========================================================================== */

import { useSyncExternalStore } from "react";
import { createBrowserStore } from "@/lib/browser-store";
import { isValidIdempotencyKey } from "@/lib/checkout/validation";

export const CHECKOUT_ATTEMPT_STORAGE_KEY = "buka:checkout-attempt:v1";

/** Μικρότερο από τις 7 ημέρες του IDEMPOTENCY_RECORD_TTL_MS στον server */
export const ATTEMPT_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;

/** Το πολύ τόσες προσπάθειες (μία ανά uid) σε έναν browser */
const MAX_ATTEMPTS = 5;

export type CheckoutAttempt = {
  uid: string;
  key: string;
  /** Date.now() του browser τη στιγμή της αποστολής */
  startedAt: number;
};

const EMPTY: readonly CheckoutAttempt[] = Object.freeze([]);

function isValidUid(value: unknown): value is string {
  // Firebase uid: έως 128 χαρακτήρες, χωρίς κενά/ελέγχου
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\x21-\x7e]+$/.test(value);
}

export function parseCheckoutAttempts(raw: string | null): readonly CheckoutAttempt[] {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY;
  const record = parsed as { v?: unknown; attempts?: unknown };
  if (record.v !== 1 || !Array.isArray(record.attempts)) return EMPTY;

  const byUid = new Map<string, CheckoutAttempt>();
  for (const entry of record.attempts.slice(0, MAX_ATTEMPTS * 2)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { uid, key, startedAt } = entry as Record<string, unknown>;
    if (!isValidUid(uid) || !isValidIdempotencyKey(key)) continue;
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || startedAt <= 0) continue;
    const previous = byUid.get(uid);
    if (!previous || previous.startedAt < startedAt) byUid.set(uid, { uid, key, startedAt });
  }

  const attempts = [...byUid.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_ATTEMPTS);
  return attempts.length === 0 ? EMPTY : Object.freeze(attempts);
}

function serialize(attempts: readonly CheckoutAttempt[]): string | null {
  if (attempts.length === 0) return null;
  return JSON.stringify({
    v: 1,
    // Ρητή αντιγραφή ΜΟΝΟ των τριών πεδίων — τίποτα άλλο δεν φτάνει στο storage
    attempts: attempts.map(({ uid, key, startedAt }) => ({ uid, key, startedAt })),
  });
}

const store = createBrowserStore<readonly CheckoutAttempt[]>({
  key: CHECKOUT_ATTEMPT_STORAGE_KEY,
  parse: parseCheckoutAttempts,
  serialize,
  empty: EMPTY,
});

export function readCheckoutAttempts(): readonly CheckoutAttempt[] {
  return store.getSnapshot();
}

/** Καταγράφει (ή αντικαθιστά) την προσπάθεια του συγκεκριμένου uid */
export function saveCheckoutAttempt(attempt: CheckoutAttempt): void {
  if (!isValidUid(attempt.uid) || !isValidIdempotencyKey(attempt.key)) return;
  const others = readCheckoutAttempts().filter((entry) => entry.uid !== attempt.uid);
  store.write(
    [{ uid: attempt.uid, key: attempt.key, startedAt: attempt.startedAt }, ...others].slice(
      0,
      MAX_ATTEMPTS,
    ),
  );
}

/** Σβήνει την προσπάθεια ΜΟΝΟ αν είναι ακόμη αυτή με το ίδιο κλειδί */
export function clearCheckoutAttempt(uid: string, key: string): void {
  const current = readCheckoutAttempts();
  const next = current.filter((entry) => !(entry.uid === uid && entry.key === key));
  if (next.length !== current.length) store.write(next);
}

/** «Κατάλαβα» στην ειδοποίηση για προσπάθειες άλλης σύνδεσης */
export function clearCheckoutAttemptsExcept(uid: string | null): void {
  const current = readCheckoutAttempts();
  const next = current.filter((entry) => entry.uid === uid);
  if (next.length !== current.length) store.write(next);
}

export function useCheckoutAttempts(): readonly CheckoutAttempt[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function isAttemptExpired(attempt: CheckoutAttempt, now: number): boolean {
  return now - attempt.startedAt > ATTEMPT_MAX_AGE_MS;
}
