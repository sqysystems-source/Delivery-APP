/* ==========================================================================
 *  Buka Delivery — lib/checkout/submit-order.ts   (πλευρά browser)
 *
 *  Στέλνει το αίτημα checkout στο POST /api/orders.
 *
 *  Επιστρέφει την ΕΞΟΥΣΙΟΔΟΤΗΜΕΝΗ απάντηση του server (orderId, κωδικός,
 *  επαληθευμένες γραμμές, σύνολα, τρόπος πληρωμής). Σε αποτυχία πετά
 *  CheckoutError που κρατά ΑΘΙΚΤΑ τα στοιχεία του server — κωδικό, HTTP
 *  status, μήνυμα, λάθη ανά πεδίο, νέες τιμές — ώστε το UI να αντιδράσει
 *  σωστά αντί να δείξει ένα γενικό «κάτι πήγε στραβά».
 * ========================================================================== */

import type {
  CheckoutAvailabilityInfo,
  CheckoutErrorBody,
  CheckoutErrorCode,
  CheckoutFieldErrors,
  CheckoutQuote,
  CheckoutRequest,
  CheckoutSuccess,
} from "@/types";
import { parseOptionSnapshot } from "@/lib/menu/options";
import { readDeliveryTermsSnapshot } from "@/lib/shop/delivery-zones";
import { auth, ensureSignedIn } from "@/lib/firebase";

export const CHECKOUT_ENDPOINT = "/api/orders";
const DEFAULT_TIMEOUT_MS = 20_000;

/* --------------------------------------------------------------------------
 *  Σφάλμα checkout
 * -------------------------------------------------------------------------- */

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;
  /** HTTP status· 0 όταν δεν ήρθε καμία απάντηση */
  readonly status: number;
  readonly fieldErrors?: CheckoutFieldErrors;
  readonly quote?: CheckoutQuote;
  readonly itemId?: string;
  /** Milestone 3: option_unavailable / options_changed — ποια γραμμή */
  readonly lineKey?: string;
  readonly existingOrder?: { orderId: string; code: string };
  /** Milestone 4 — shop_closed / shop_config_invalid: η διαθεσιμότητα όπως την είδε ο server */
  readonly availability?: CheckoutAvailabilityInfo;
  /**
   * true όταν ΔΕΝ ξέρουμε αν δημιουργήθηκε παραγγελία (χάθηκε η απάντηση,
   * timeout, 5xx). Η επανάληψη με το ΙΔΙΟ κλειδί είναι ασφαλής: ο server
   * επιστρέφει την αρχική παραγγελία αντί να φτιάξει δεύτερη.
   */
  readonly uncertain: boolean;

  constructor(options: {
    code: CheckoutErrorCode;
    status: number;
    message: string;
    uncertain: boolean;
    fieldErrors?: CheckoutFieldErrors;
    quote?: CheckoutQuote;
    itemId?: string;
    lineKey?: string;
    existingOrder?: { orderId: string; code: string };
    availability?: CheckoutAvailabilityInfo;
  }) {
    super(options.message);
    this.name = "CheckoutError";
    this.code = options.code;
    this.status = options.status;
    this.uncertain = options.uncertain;
    this.fieldErrors = options.fieldErrors;
    this.quote = options.quote;
    this.itemId = options.itemId;
    this.lineKey = options.lineKey;
    this.existingOrder = options.existingOrder;
    this.availability = options.availability;
  }
}

export function isCheckoutError(value: unknown): value is CheckoutError {
  return value instanceof CheckoutError;
}

/* --------------------------------------------------------------------------
 *  Έλεγχος σχήματος απάντησης
 * -------------------------------------------------------------------------- */

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isQuote(value: unknown): value is CheckoutQuote {
  if (typeof value !== "object" || value === null) return false;
  const quote = value as Record<string, unknown>;
  const terms = quote.shopTerms as Record<string, unknown> | undefined;

  return (
    typeof quote.shopId === "string" &&
    typeof quote.shopName === "string" &&
    Array.isArray(quote.lines) &&
    quote.lines.every(
      (line: unknown) =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as Record<string, unknown>).itemId === "string" &&
        typeof (line as Record<string, unknown>).name === "string" &&
        isNumber((line as Record<string, unknown>).unitPrice) &&
        isNumber((line as Record<string, unknown>).quantity) &&
        isNumber((line as Record<string, unknown>).lineTotal) &&
        /* Milestone 3: στιγμιότυπο επιλογών, όταν υπάρχει, πρέπει να διαβάζεται */
        ((line as Record<string, unknown>).options === undefined ||
          parseOptionSnapshot((line as Record<string, unknown>).options) !== null),
    ) &&
    isNumber(quote.subtotal) &&
    isNumber(quote.deliveryFee) &&
    isNumber(quote.total) &&
    Number.isSafeInteger(quote.totalCents) &&
    typeof terms === "object" &&
    terms !== null &&
    isNumber(terms.minOrder) &&
    isNumber(terms.deliveryFee) &&
    (terms.freeDeliveryOver === null || isNumber(terms.freeDeliveryOver)) &&
    /* Milestone 4: προαιρετικό (παλιές αποθηκευμένες απαντήσεις δεν το έχουν),
     * αλλά αν υπάρχει πρέπει να διαβάζεται */
    (quote.delivery === undefined || readDeliveryTermsSnapshot(quote.delivery) !== null)
  );
}

function parseAvailabilityInfo(value: unknown): CheckoutAvailabilityInfo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const info = value as Record<string, unknown>;
  if (info.state !== "closed" && info.state !== "paused" && info.state !== "unavailable") return undefined;
  const nextOpenAt =
    typeof info.nextOpenAt === "string" && !Number.isNaN(Date.parse(info.nextOpenAt)) ? info.nextOpenAt : null;
  return { state: info.state, nextOpenAt };
}

/** Πλήρης, έγκυρη απάντηση επιτυχίας — κοινό με το recover-attempt.ts */
export function isCheckoutSuccessBody(value: unknown): value is CheckoutSuccess {
  return isSuccess(value);
}

function isSuccess(value: unknown): value is CheckoutSuccess {
  if (!isQuote(value)) return false;
  const body = value as unknown as Record<string, unknown>;
  return (
    body.ok === true &&
    typeof body.orderId === "string" &&
    body.orderId.length > 0 &&
    typeof body.code === "string" &&
    body.status === "pending" &&
    body.paymentMethod === "cash_on_delivery" &&
    typeof body.address === "string"
  );
}

function isErrorBody(value: unknown): value is CheckoutErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return body.ok === false && typeof body.code === "string" && typeof body.message === "string";
}

/* --------------------------------------------------------------------------
 *  Μηνύματα για σφάλματα που συμβαίνουν ΠΡΙΝ/ΕΞΩ από τον server
 * -------------------------------------------------------------------------- */

const CLIENT_MESSAGES = {
  auth_failed:
    "Δεν ήταν δυνατή η σύνδεση με τον λογαριασμό σου. Έλεγξε το internet και δοκίμασε ξανά.",
  network_error:
    "Δεν λάβαμε επιβεβαίωση από τον server. Η παραγγελία ίσως έχει καταχωρηθεί — πάτα «Δοκίμασε ξανά» χωρίς αλλαγές και θα ελέγξουμε με ασφάλεια, χωρίς να δημιουργηθεί δεύτερη.",
  invalid_response:
    "Λάβαμε μη αναμενόμενη απάντηση από τον server. Πάτα «Δοκίμασε ξανά» χωρίς αλλαγές — δεν θα δημιουργηθεί δεύτερη παραγγελία.",
} as const;

/* --------------------------------------------------------------------------
 *  Αποστολή
 * -------------------------------------------------------------------------- */

export type SubmitOrderOptions = {
  timeoutMs?: number;
  /** Για tests */
  fetchImpl?: typeof fetch;
  /** Για tests — παρακάμπτει το Firebase Auth */
  getIdToken?: () => Promise<string>;
  /** Για tests — ποιος uid αντιστοιχεί στο token (προεπιλογή: auth.currentUser) */
  getUid?: () => string | null;
  /**
   * Καλείται ΑΦΟΥ βρεθεί ταυτότητα και ΠΡΙΝ φύγει το αίτημα, με τον uid του
   * token. Το checkout το χρησιμοποιεί για να καταγράψει το κλειδί της
   * προσπάθειας (μόνο κλειδί + uid), ώστε μια ανανέωση σελίδας να μπορεί να
   * ελέγξει το αποτέλεσμα αντί να στείλει δεύτερη παραγγελία.
   */
  onBeforeSend?: (uid: string) => void;
};

async function defaultGetIdToken(): Promise<string> {
  await ensureSignedIn();
  const user = auth.currentUser;
  if (!user) throw new Error("no current user");
  return user.getIdToken();
}

export async function submitOrder(
  request: CheckoutRequest,
  options: SubmitOrderOptions = {},
): Promise<CheckoutSuccess> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getIdToken = options.getIdToken ?? defaultGetIdToken;

  /* 1. Ταυτότητα — αν αποτύχει εδώ, ΤΙΠΟΤΑ δεν στάλθηκε: όχι αβεβαιότητα */
  let idToken: string;
  try {
    idToken = await getIdToken();
  } catch {
    throw new CheckoutError({
      code: "auth_failed",
      status: 0,
      message: CLIENT_MESSAGES.auth_failed,
      uncertain: false,
    });
  }

  /* 1β. Καταγραφή προσπάθειας — αν αποτύχει, απλώς δεν θα υπάρχει ανάκτηση */
  const uid = (options.getUid ?? (() => auth.currentUser?.uid ?? null))();
  if (uid && options.onBeforeSend) {
    try {
      options.onBeforeSend(uid);
    } catch {
      /* π.χ. μπλοκαρισμένο storage — η αποστολή συνεχίζει */
    }
  }

  /* 2. Αίτημα με όριο χρόνου */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // Timeout ή πτώση δικτύου: το αίτημα ΙΣΩΣ έφτασε και ολοκληρώθηκε
    throw new CheckoutError({
      code: "network_error",
      status: 0,
      message: CLIENT_MESSAGES.network_error,
      uncertain: true,
    });
  } finally {
    clearTimeout(timer);
  }

  /* 3. Ανάγνωση απάντησης */
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok && isSuccess(body)) {
    return body;
  }

  if (isErrorBody(body)) {
    throw new CheckoutError({
      code: body.code,
      status: response.status,
      message: body.message,
      // Ένα 5xx μπορεί να προήλθε ΜΕΤΑ την καταχώρηση — το αντιμετωπίζουμε ως αβέβαιο
      uncertain: response.status >= 500,
      fieldErrors: body.fieldErrors,
      quote: isQuote(body.quote) ? body.quote : undefined,
      itemId: typeof body.itemId === "string" ? body.itemId : undefined,
      lineKey: typeof body.lineKey === "string" ? body.lineKey : undefined,
      existingOrder:
        body.existingOrder &&
        typeof body.existingOrder.orderId === "string" &&
        typeof body.existingOrder.code === "string"
          ? body.existingOrder
          : undefined,
      availability: parseAvailabilityInfo(body.availability),
    });
  }

  // Κάτι που δεν αναγνωρίζουμε (π.χ. σελίδα σφάλματος του hosting)
  throw new CheckoutError({
    code: "invalid_response",
    status: response.status,
    message: CLIENT_MESSAGES.invalid_response,
    uncertain: true,
  });
}
