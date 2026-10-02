/* ==========================================================================
 *  Buka Delivery — lib/checkout/recover-attempt.ts   (πλευρά browser, milestone 2)
 *
 *  Ρωτά το POST /api/orders/recover αν μια προσπάθεια με γνωστό κλειδί
 *  δημιούργησε παραγγελία. ΔΕΝ στέλνει ποτέ παραγγελία.
 *
 *  Ταυτότητα: χρησιμοποιεί ΜΟΝΟ τον ήδη συνδεδεμένο χρήστη (auth.currentUser)
 *  και ΜΟΝΟ αν είναι ο ίδιος uid που έκανε την προσπάθεια. Δεν κάνει ποτέ
 *  νέο anonymous sign-in: ένας νέος uid δεν θα είχε πρόσβαση στην προσπάθεια
 *  και θα «αντικαθιστούσε» σιωπηλά τον επισκέπτη.
 * ========================================================================== */

import type { CheckoutRecoveryResponseBody, CheckoutSuccess } from "@/types";
import { auth } from "@/lib/firebase";
import { isCheckoutSuccessBody } from "@/lib/checkout/submit-order";

export const RECOVERY_ENDPOINT = "/api/orders/recover";
const DEFAULT_TIMEOUT_MS = 15_000;

export type RecoverAttemptOutcome =
  /** Η αρχική παραγγελία βρέθηκε — η απάντηση είναι αυτή του server */
  | { kind: "order_found"; order: CheckoutSuccess }
  /** Οριστικό: καμία παραγγελία, το κλειδί έκλεισε στον server */
  | { kind: "no_order" }
  /** Ο τρέχων χρήστης δεν είναι αυτός που έκανε την προσπάθεια */
  | { kind: "identity_mismatch" }
  /** Άγνωστο αποτέλεσμα — ΔΕΝ επιτρέπεται νέα αποστολή μέχρι να ξαναελεγχθεί */
  | { kind: "failed"; message: string }
  /** Το κλειδί απορρίφθηκε ως άκυρο — δεν μπορεί να ελεγχθεί ποτέ */
  | { kind: "invalid" };

export type RecoverAttemptOptions = {
  timeoutMs?: number;
  /** Για tests */
  fetchImpl?: typeof fetch;
  /** Για tests — επιστρέφει { uid, token } του τρέχοντος χρήστη ή null */
  getIdentity?: () => Promise<{ uid: string; token: string } | null>;
};

const FAILED_MESSAGE =
  "Δεν μπορέσαμε να ελέγξουμε αν καταχωρήθηκε η προηγούμενη παραγγελία σου. Έλεγξε τη σύνδεσή σου και πάτα «Έλεγχος ξανά».";

async function defaultGetIdentity(): Promise<{ uid: string; token: string } | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return { uid: user.uid, token: await user.getIdToken() };
}

export async function recoverCheckoutAttempt(
  attempt: { uid: string; key: string },
  options: RecoverAttemptOptions = {},
): Promise<RecoverAttemptOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let identity: { uid: string; token: string } | null;
  try {
    identity = await (options.getIdentity ?? defaultGetIdentity)();
  } catch {
    return { kind: "failed", message: FAILED_MESSAGE };
  }
  if (!identity) return { kind: "identity_mismatch" };
  if (identity.uid !== attempt.uid) return { kind: "identity_mismatch" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(RECOVERY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify({ idempotencyKey: attempt.key }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return { kind: "failed", message: FAILED_MESSAGE };
  } finally {
    clearTimeout(timer);
  }

  let body: CheckoutRecoveryResponseBody | null = null;
  try {
    body = (await response.json()) as CheckoutRecoveryResponseBody;
  } catch {
    body = null;
  }

  if (response.ok && body && body.ok === true) {
    if (body.outcome === "no_order") return { kind: "no_order" };
    if (
      body.outcome === "order_found" &&
      isCheckoutSuccessBody(body.order) &&
      body.order.orderId.length > 0
    ) {
      return { kind: "order_found", order: body.order };
    }
  }

  if (response.status === 400 && body && body.ok === false && body.code === "validation_failed") {
    return { kind: "invalid" };
  }

  return { kind: "failed", message: FAILED_MESSAGE };
}
