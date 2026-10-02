/* ==========================================================================
 *  Buka Delivery — lib/server/checkout-service.ts
 *
 *  Η λογική του POST /api/orders, ανεξάρτητη από Next.js και από το ίδιο το
 *  Firestore: παίρνει τις εξαρτήσεις της ως παραμέτρους (store, επαλήθευση
 *  token, ρολόι), ώστε να δοκιμάζεται χωρίς πραγματική βάση.
 *
 *  ── ΡΟΗ ─────────────────────────────────────────────────────────────────
 *   1. Μέγεθος → ταυτότητα (Firebase ID token) → JSON → επικύρωση
 *   2. Idempotency: αν το (uid, κλειδί) έχει ήδη ολοκληρωθεί, επιστρέφεται
 *      το ΑΠΟΘΗΚΕΥΜΕΝΟ αποτέλεσμα — χωρίς rate limit, χωρίς νέα τιμολόγηση
 *   3. Rate limit ΜΟΝΟ για νέες παραγγελίες
 *   4. ΜΙΑ συναλλαγή Firestore που:
 *        ξαναδιαβάζει το κλειδί → διαβάζει κατάστημα + προϊόντα →
 *        υπολογίζει σε λεπτά → συγκρίνει με το σύνολο που είδε ο πελάτης →
 *        γράφει ΜΑΖΙ παραγγελία + αποτέλεσμα κλειδιού
 *
 *  ── ΑΝΑΚΤΗΣΗ ΠΡΟΣΠΑΘΕΙΑΣ (milestone 2) ─────────────────────────────────
 *  Το POST /api/orders/recover απαντά «υπάρχει παραγγελία με αυτό το κλειδί;»
 *  για τον ΤΡΕΧΟΝΤΑ uid. Αν δεν υπάρχει, ΚΛΕΙΝΕΙ το κλειδί (closed record)
 *  στην ίδια συναλλαγή, ώστε ένα αίτημα που ίσως ακόμη ταξιδεύει να μη
 *  μπορεί να δημιουργήσει παραγγελία αργότερα. Έτσι η απάντηση «καμία
 *  παραγγελία» είναι οριστική και ο πελάτης μπορεί να ξαναστείλει με
 *  νέο κλειδί χωρίς κίνδυνο διπλής παραγγελίας.
 *
 *  ── ΩΡΑΡΙΟ ΚΑΙ ΖΩΝΕΣ ΠΑΡΑΔΟΣΗΣ (milestone 4) ────────────────────────────
 *  Μέσα στη συναλλαγή, ΜΕΤΑ τον έλεγχο του κλειδιού (άρα οι επαναλήψεις και
 *  η ανάκτηση επιστρέφουν την αρχική παραγγελία χωρίς να ξαναελέγξουν
 *  ωράριο, ζώνη ή κατάλογο):
 *    • διαθεσιμότητα με ώρα SERVER (deps.now(), ξανά σε κάθε προσπάθεια της
 *      συναλλαγής) και τη ρύθμιση που διάβασε η συναλλαγή
 *    • ΤΚ → τρέχουσα ΔΙΑΘΕΣΙΜΗ ζώνη → μεταφορικά/ελάχιστη/δωρεάν της ζώνης
 *    • η ζώνη που είδε ο πελάτης πρέπει να είναι η ίδια (αλλιώς νέα επιβεβαίωση)
 *
 *  ΣΗΜΕΙΟ ΑΠΟΦΑΣΗΣ: η επιλεξιμότητα κρίνεται τη στιγμή `now` της
 *  προσπάθειας που κάνει commit, πάνω στο έγγραφο καταστήματος που διάβασε
 *  ΑΥΤΗ η προσπάθεια. Η συναλλαγή εγγυάται ότι η ρύθμιση δεν άλλαξε ανάμεσα
 *  στην ανάγνωση και την εγγραφή (αλλιώς ξανατρέχει). ΔΕΝ εγγυάται ότι το
 *  ρολόι δεν πέρασε την ώρα κλεισίματος στα λίγα ms μέχρι το commit — η
 *  παραγγελία που κρίθηκε εμπρόθεσμη καταχωρείται, και η στιγμή της κρίσης
 *  αποθηκεύεται ως `eligibilityCheckedAt`. Καμία παραγγελία δεν ακυρώνεται
 *  αναδρομικά επειδή έκλεισε το κατάστημα.
 *
 *  ── ΤΙ ΔΕΝ ΕΜΠΙΣΤΕΥΟΜΑΣΤΕ ΠΟΤΕ ΑΠΟ ΤΟΝ CLIENT ──────────────────────────
 *  Τιμές, ονόματα προϊόντων/καταστήματος, userId, ownerUid, κατάσταση, ώρα.
 *  Το `expectedTotalCents` είναι μόνο μέτρο σύγκρισης, ΠΟΤΕ τιμή.
 * ========================================================================== */

import "server-only";

import { createHash } from "node:crypto";
import type {
  CheckoutAvailabilityInfo,
  CheckoutErrorBody,
  CheckoutErrorCode,
  CheckoutFieldErrors,
  CheckoutQuote,
  CheckoutRecoveryResponseBody,
  CheckoutResponseBody,
  CheckoutSuccess,
  DeliveryTermsSnapshot,
  VerifiedOrderLine,
} from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import {
  centsToEuros,
  computeTotalsCents,
  isSafeCents,
  parseItemPriceCents,
  type ShopTermsCents,
} from "@/lib/checkout/money";
import { describeOrderBlock, evaluateShopAvailability } from "@/lib/shop/availability";
import { parseOpeningHours } from "@/lib/shop/opening-hours";
import { describeDeliveryProblem, parseDeliveryZones, resolveDeliveryTerms } from "@/lib/shop/delivery-zones";
import { stableStringify } from "@/lib/checkout/idempotency";
import {
  cartLineKey,
  describeSelectionProblem,
  resolveSelections,
  validateOptionGroups,
} from "@/lib/menu/options";
import {
  buildCompatAddress,
  cleanSingleLine,
  isValidIdempotencyKey,
  validateCheckoutRequest,
  type ValidatedCheckoutRequest,
} from "@/lib/checkout/validation";

/* ==========================================================================
 *  ΡΥΘΜΙΣΕΙΣ
 * ========================================================================== */

/** Ίδιο με την προηγούμενη έκδοση: 5 ΝΕΕΣ παραγγελίες ανά 60″ ανά uid */
export const RATE_LIMIT = { windowMs: 60_000, maxOrders: 5 } as const;

/** Πόσο κρατιέται το αποτέλεσμα ενός κλειδιού (για TTL policy, προαιρετικά) */
export const IDEMPOTENCY_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const CHECKOUT_REQUESTS_COLLECTION = "checkoutRequests";

/** Το σώμα του POST /api/orders/recover είναι μόνο `{ idempotencyKey }` */
export const MAX_RECOVERY_REQUEST_BYTES = 1_024;

/* ==========================================================================
 *  ΣΥΜΒΟΛΑΙΟ STORE — το υλοποιεί το Firestore adapter (και τα tests)
 * ========================================================================== */

/** Η απάντηση όπως αποθηκεύεται (χωρίς το `replayed`, που ορίζεται κατά την επιστροφή) */
export type StoredCheckoutResponse = Omit<CheckoutSuccess, "replayed">;

/** Ολοκληρωμένη προσπάθεια: η παραγγελία δημιουργήθηκε με αυτό το κλειδί */
export type CompletedAttemptRecord = {
  state: "completed";
  uid: string;
  requestHash: string;
  orderId: string;
  response: StoredCheckoutResponse;
};

/**
 * Κλειστή προσπάθεια (milestone 2): ο πελάτης ρώτησε μέσω του
 * /api/orders/recover και ΔΕΝ υπήρχε παραγγελία. Το κλειδί δεν μπορεί πια
 * να δημιουργήσει παραγγελία — ένα καθυστερημένο αίτημα παίρνει 409.
 */
export type ClosedAttemptRecord = {
  state: "closed";
  uid: string;
};

/** Ό,τι μπορεί να βρίσκεται στο checkoutRequests/{id} */
export type IdempotencyRecord = CompletedAttemptRecord | ClosedAttemptRecord;

export type CheckoutTransactionWrite = {
  orderId: string;
  order: Record<string, unknown>;
  recordId: string;
  record: Record<string, unknown>;
};

export interface CheckoutTransaction {
  getIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null>;
  getShop(shopId: string): Promise<Record<string, unknown> | null>;
  getMenuItems(
    shopId: string,
    itemIds: readonly string[],
  ): Promise<Array<Record<string, unknown> | null>>;
  /** Και τα δύο έγγραφα δημιουργούνται ΜΑΖΙ, με semantics «create» (όχι overwrite) */
  createOrderWithRecord(write: CheckoutTransactionWrite): void;
  /** Κλείνει ένα αχρησιμοποίητο κλειδί — semantics «create» (όχι overwrite) */
  createClosedAttempt(write: { recordId: string; record: Record<string, unknown> }): void;
}

export interface CheckoutStore {
  getIdempotencyRecord(recordId: string): Promise<IdempotencyRecord | null>;
  countRecentOrders(uid: string, sinceMs: number, limit: number): Promise<number>;
  newOrderId(): string;
  runTransaction<T>(fn: (tx: CheckoutTransaction) => Promise<T>): Promise<T>;
  /** Σφάλμα «το έγγραφο υπάρχει ήδη» από το create μέσα στη συναλλαγή */
  isAlreadyExistsError(error: unknown): boolean;
}

export type CheckoutLogger = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

export type CheckoutDeps = {
  store: CheckoutStore;
  verifyIdToken(token: string): Promise<{ uid: string }>;
  serverTimestamp(): unknown;
  timestampFromMillis(ms: number): unknown;
  now(): number;
  logger?: CheckoutLogger;
};

export type CheckoutHttpResult = {
  status: number;
  body: CheckoutResponseBody;
};

export type RecoveryHttpResult = {
  status: number;
  body: CheckoutRecoveryResponseBody;
};

/* ==========================================================================
 *  ΜΗΝΥΜΑΤΑ
 * ========================================================================== */

function euro(cents: number): string {
  return `${centsToEuros(cents).toFixed(2).replace(".", ",")}€`;
}

const MESSAGES: Record<Exclude<CheckoutErrorCode, "network_error" | "invalid_response" | "auth_failed">, string> = {
  invalid_json: "Μη έγκυρο αίτημα.",
  payload_too_large: "Το αίτημα είναι πολύ μεγάλο.",
  validation_failed: "Έλεγξε τα στοιχεία της παραγγελίας.",
  unauthenticated: "Απαιτείται ταυτοποίηση. Ανανέωσε τη σελίδα και δοκίμασε ξανά.",
  rate_limited: "Πολλές παραγγελίες σε σύντομο διάστημα. Περίμενε ένα λεπτό και δοκίμασε ξανά.",
  shop_not_found: "Το κατάστημα δεν βρέθηκε.",
  shop_closed: "Το κατάστημα είναι προσωρινά κλειστό και δεν δέχεται παραγγελίες.",
  postal_code_required:
    "Συμπλήρωσε τον ταχυδρομικό κώδικα — το κατάστημα εξυπηρετεί συγκεκριμένες περιοχές.",
  delivery_zone_unsupported: "Το κατάστημα δεν εξυπηρετεί αυτόν τον ταχυδρομικό κώδικα.",
  delivery_zone_unavailable: "Η περιοχή σου δεν εξυπηρετείται προσωρινά από το κατάστημα.",
  delivery_zone_changed:
    "Οι περιοχές παράδοσης του καταστήματος άλλαξαν. Έλεγξε τη σύνοψη και επιβεβαίωσε ξανά.",
  item_not_found:
    "Κάποιο προϊόν του καλαθιού δεν υπάρχει πια στον κατάλογο. Αφαίρεσέ το και δοκίμασε ξανά.",
  item_unavailable: "Κάποιο προϊόν του καλαθιού εξαντλήθηκε.",
  option_unavailable:
    "Κάποια επιλογή προϊόντος δεν είναι πια διαθέσιμη. Επεξεργάσου το προϊόν στο καλάθι.",
  options_changed:
    "Οι επιλογές κάποιου προϊόντος άλλαξαν στον κατάλογο. Επεξεργάσου το προϊόν στο καλάθι.",
  below_minimum_order: "Δεν καλύπτεται η ελάχιστη παραγγελία του καταστήματος.",
  order_too_large:
    "Η παραγγελία ξεπερνά το όριο των 500€. Επικοινώνησε με το κατάστημα για μεγάλες παραγγελίες.",
  price_changed:
    "Οι τιμές ή τα μεταφορικά άλλαξαν. Έλεγξε τη σύνοψη και επιβεβαίωσε ξανά την παραγγελία.",
  idempotency_key_reused:
    "Αυτή η προσπάθεια παραγγελίας έχει ήδη σταλεί με διαφορετικά στοιχεία. Έλεγξε την παραγγελία και επιβεβαίωσε ξανά.",
  checkout_attempt_closed:
    "Αυτή η προσπάθεια παραγγελίας έκλεισε χωρίς να καταχωρηθεί παραγγελία. Έλεγξε τα στοιχεία και επιβεβαίωσε ξανά.",
  shop_config_invalid:
    "Το κατάστημα έχει πρόβλημα στις ρυθμίσεις του και δεν δέχεται παραγγελίες αυτή τη στιγμή.",
  menu_config_invalid:
    "Υπάρχει πρόβλημα με τον κατάλογο του καταστήματος. Δοκίμασε ξανά αργότερα.",
  server_misconfigured: "Δεν ήταν δυνατή η καταχώρηση της παραγγελίας. Δοκίμασε ξανά σε λίγο.",
  internal_error: "Δεν ήταν δυνατή η καταχώρηση της παραγγελίας. Δοκίμασε ξανά σε λίγο.",
  method_not_allowed: "Χρησιμοποίησε POST για να καταχωρήσεις παραγγελία.",
};

function failure(
  status: number,
  code: keyof typeof MESSAGES,
  extra: Partial<Omit<CheckoutErrorBody, "ok" | "code">> = {},
): CheckoutHttpResult {
  return {
    status,
    body: { ok: false, code, message: extra.message ?? MESSAGES[code], ...stripUndefined(extra) },
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function methodNotAllowed(): CheckoutHttpResult {
  return failure(405, "method_not_allowed");
}

export function serverMisconfigured(): CheckoutHttpResult {
  return failure(500, "server_misconfigured");
}

/* ==========================================================================
 *  ΚΑΤΑΚΕΡΜΑΤΙΣΜΟΙ
 * ========================================================================== */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Το id του εγγράφου idempotency. Εξαρτάται από uid ΚΑΙ κλειδί: το ίδιο
 * κλειδί από διαφορετικό χρήστη είναι διαφορετικό έγγραφο. Το hash κρατά το
 * id σε σταθερό μήκος και χωρίς ειδικούς χαρακτήρες.
 */
export function idempotencyRecordId(uid: string, key: string): string {
  return sha256(`${uid}\u0000${key}`);
}

/**
 * Κανονική μορφή του αιτήματος ΧΩΡΙΣ το κλειδί — ίδια δεδομένα, ίδιο hash.
 * Milestone 3: οι γραμμές είναι ήδη κανονικές (validateAndMergeLines), άρα
 * περιλαμβάνουν τις κανονικές επιλογές: ίδιες επιλογές σε άλλη σειρά → ίδιο
 * hash· άλλες επιλογές → άλλο hash (idempotency_key_reused). Γραμμές χωρίς
 * επιλογές δεν έχουν πεδίο `selections`, οπότε τα hash του milestone 1/2
 * μένουν ίδια.
 */
/* Milestone 4: ο ΤΚ περιλαμβάνεται στην ταυτότητα του αιτήματος (επηρεάζει
 * ζώνη και ποσό): ίδιο αίτημα με «546 22» ή «54622» → ίδιο hash· άλλος ΤΚ →
 * άλλο hash (idempotency_key_reused). */
export function canonicalRequestHash(request: ValidatedCheckoutRequest): string {
  return sha256(
    stableStringify({
      shopId: request.shopId,
      customer: request.customer,
      delivery: request.delivery,
      notes: request.notes ?? null,
      paymentMethod: request.paymentMethod,
      lines: request.lines,
      expectedTotalCents: request.expectedTotalCents,
      /* Milestone 4: η ζώνη που είδε ο πελάτης. Απούσα → το πεδίο παραλείπεται
       * εντελώς (stableStringify), άρα τα hash των παλιών αιτημάτων μένουν ίδια.
       * Ο ΤΚ μετέχει ήδη μέσω του κανονικοποιημένου `delivery.postalCode`. */
      expectedDeliveryZoneId: request.expectedDeliveryZoneId,
    }),
  );
}

export function orderCodeFromId(orderId: string): string {
  return `BK-${orderId.slice(0, 6).toUpperCase()}`;
}

/* ==========================================================================
 *  ΤΥΠΟΙ ΤΙΜΟΛΟΓΗΣΗΣ
 * ========================================================================== */

type PricingOk = {
  ok: true;
  quote: CheckoutQuote;
  ownerUid: string | null;
  etaMinutes: [number, number] | null;
  delivery: DeliveryTermsSnapshot;
};

type PricingFailure = { ok: false; result: CheckoutHttpResult };

function parseEtaMinutes(value: unknown): [number, number] | null {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0)
  ) {
    return [value[0] as number, value[1] as number];
  }
  return null;
}

/* ==========================================================================
 *  ΕΠΙΛΕΞΙΜΟΤΗΤΑ (milestone 4) — διαθεσιμότητα + ζώνη, ΠΡΙΝ την τιμολόγηση
 * ========================================================================== */

export type OrderEligibility =
  | { ok: true; terms: ShopTermsCents; delivery: DeliveryTermsSnapshot }
  | PricingFailure;

/**
 * Μπορεί να δημιουργηθεί ΤΩΡΑ (`nowMs`, ώρα server) παραγγελία σε αυτό το
 * κατάστημα, για αυτόν τον ΤΚ; Και με ποιους όρους παράδοσης;
 */
export function checkOrderEligibility(
  request: ValidatedCheckoutRequest,
  shop: Record<string, unknown>,
  nowMs: number,
  logger?: CheckoutLogger,
): OrderEligibility {
  /* 1. Διαθεσιμότητα: παύση → κακόμορφη ρύθμιση → ωράριο */
  const availability = evaluateShopAvailability(shop, nowMs);
  if (availability.state !== "open") {
    const info: CheckoutAvailabilityInfo = {
      state: availability.state,
      nextOpenAt: availability.nextOpenAt !== null ? new Date(availability.nextOpenAt).toISOString() : null,
    };
    if (availability.state === "unavailable") {
      const hours = parseOpeningHours(shop.openingHours);
      logger?.error(
        `[orders] Κακόμορφη ρύθμιση διαθεσιμότητας στο κατάστημα ${request.shopId}:`,
        hours.kind === "invalid" ? hours.errors : { active: shop.active },
      );
      return {
        ok: false,
        result: failure(409, "shop_config_invalid", {
          message: describeOrderBlock(availability, nowMs),
          availability: info,
        }),
      };
    }
    return {
      ok: false,
      result: failure(409, "shop_closed", {
        message: describeOrderBlock(availability, nowMs),
        availability: info,
      }),
    };
  }

  /* 2. Όροι παράδοσης: γενικοί (χωρίς ζώνες) ή της ΔΙΑΘΕΣΙΜΗΣ ζώνης του ΤΚ */
  const postalCode = request.delivery.postalCode ?? null;
  const resolution = resolveDeliveryTerms(shop, postalCode);
  if (resolution.ok) return { ok: true, terms: resolution.terms, delivery: resolution.snapshot };

  const message = describeDeliveryProblem(resolution.reason, postalCode);
  switch (resolution.reason) {
    case "shop_terms_invalid":
      // Ίδια συμπεριφορά με πριν το milestone 4: ελεγχόμενο 500, ποτέ λάθος χρέωση
      logger?.error(
        `[orders] Κακόμορφο πεδίο ${resolution.field} στο κατάστημα ${request.shopId}:`,
        shop[resolution.field ?? ""],
      );
      return { ok: false, result: failure(500, "shop_config_invalid") };
    case "zones_config_invalid": {
      const parsed = parseDeliveryZones(shop.deliveryZones);
      logger?.error(
        `[orders] Κακόμορφες ζώνες παράδοσης στο κατάστημα ${request.shopId}:`,
        parsed.kind === "invalid" ? parsed.errors : null,
      );
      return { ok: false, result: failure(409, "shop_config_invalid", { message }) };
    }
    case "postal_code_required":
      return {
        ok: false,
        result: failure(400, "postal_code_required", { message, fieldErrors: { postalCode: message } }),
      };
    case "postal_code_invalid":
      return {
        ok: false,
        result: failure(400, "validation_failed", { fieldErrors: { postalCode: message } }),
      };
    case "unsupported":
      return {
        ok: false,
        result: failure(409, "delivery_zone_unsupported", { message, fieldErrors: { postalCode: message } }),
      };
    case "zone_unavailable":
      return {
        ok: false,
        result: failure(409, "delivery_zone_unavailable", { message, fieldErrors: { postalCode: message } }),
      };
  }
}

function describeZoneChange(delivery: DeliveryTermsSnapshot): string {
  const terms = `μεταφορικά ${delivery.deliveryFeeCents === 0 ? "δωρεάν" : euro(delivery.deliveryFeeCents)}, ελάχιστη παραγγελία ${euro(delivery.minOrderCents)}`;
  return delivery.mode === "zone"
    ? `Ο ΤΚ ${delivery.postalCode} εξυπηρετείται πλέον από τη ζώνη «${delivery.zoneName}» (${terms}). Δεν στάλθηκε καμία παραγγελία — έλεγξε τη σύνοψη και επιβεβαίωσε ξανά.`
    : `Το κατάστημα δεν χρησιμοποιεί πια ζώνες ΤΚ· ισχύουν οι γενικοί όροι (${terms}). Δεν στάλθηκε καμία παραγγελία — έλεγξε τη σύνοψη και επιβεβαίωσε ξανά.`;
}

/* ==========================================================================
 *  ΤΙΜΟΛΟΓΗΣΗ — καθαρή συνάρτηση πάνω σε ό,τι διάβασε η συναλλαγή
 *
 *  Milestone 4: οι όροι (μεταφορικά/ελάχιστη/δωρεάν) έρχονται από την
 *  checkOrderEligibility — της ζώνης ή του καταστήματος. Το υποσύνολο είναι
 *  τα προϊόντα ΜΑΖΙ με τις επιλογές τους (milestone 3).
 * ========================================================================== */

export function priceOrder(
  request: ValidatedCheckoutRequest,
  shop: Record<string, unknown>,
  items: ReadonlyMap<string, Record<string, unknown> | null>,
  eligibility: { terms: ShopTermsCents; delivery: DeliveryTermsSnapshot },
  logger?: CheckoutLogger,
): PricingOk | PricingFailure {
  const { terms, delivery } = eligibility;

  const rawShopName = cleanSingleLine(shop.name);
  const shopName =
    rawShopName && rawShopName.length <= CHECKOUT_LIMITS.shopNameMax ? rawShopName : request.shopId;

  /* Γραμμές — η τιμή έρχεται ΑΠΟΚΛΕΙΣΤΙΚΑ από το menuItems.
   * Milestone 3: πολλές γραμμές (παραλλαγές) μπορεί να δείχνουν στο ΙΔΙΟ
   * προϊόν· το `items` είναι ευρετήριο itemId → έγγραφο (ή null). */
  const lines: VerifiedOrderLine[] = [];
  let subtotalCents = 0;

  for (const line of request.lines) {
    const item = items.get(line.itemId) ?? null;

    if (!item) {
      return {
        ok: false,
        result: failure(409, "item_not_found", { itemId: line.itemId }),
      };
    }

    const rawName = cleanSingleLine(item.name);
    const name =
      rawName && rawName.length <= CHECKOUT_LIMITS.itemNameMax ? rawName : line.itemId;

    if (item.available === false) {
      return {
        ok: false,
        result: failure(409, "item_unavailable", {
          itemId: line.itemId,
          message: `Το προϊόν «${name}» εξαντλήθηκε. Αφαίρεσέ το από το καλάθι και δοκίμασε ξανά.`,
        }),
      };
    }

    const basePriceCents = parseItemPriceCents(item.price);
    if (basePriceCents === null) {
      logger?.error(
        `[orders] Κακόμορφη τιμή στο προϊόν shops/${request.shopId}/menuItems/${line.itemId}:`,
        item.price,
      );
      return { ok: false, result: failure(500, "menu_config_invalid") };
    }

    /* Ρύθμιση επιλογών ΟΠΩΣ ΕΙΝΑΙ ΤΩΡΑ στον κατάλογο — κακόμορφη = ελεγχόμενο
     * σφάλμα, ποτέ σιωπηλή αγνόηση (θα χρέωνε άλλο προϊόν από αυτό που είδε). */
    const config = validateOptionGroups(item.optionGroups, "read");
    if (!config.ok) {
      logger?.error(
        `[orders] Κακόμορφες επιλογές στο προϊόν shops/${request.shopId}/menuItems/${line.itemId}:`,
        config.errors,
      );
      return { ok: false, result: failure(500, "menu_config_invalid") };
    }

    const selections = line.selections ?? [];
    const resolved = resolveSelections(config.groups, selections);
    if (!resolved.ok) {
      const lineKey = cartLineKey(line.itemId, selections);
      return {
        ok: false,
        result: failure(
          409,
          resolved.problem.reason === "unavailable" ? "option_unavailable" : "options_changed",
          {
            itemId: line.itemId,
            lineKey,
            message: describeSelectionProblem(resolved.problem, name),
          },
        ),
      };
    }

    const unitPriceCents = basePriceCents + resolved.extraCents;
    const lineTotalCents = unitPriceCents * line.quantity;
    if (!isSafeCents(unitPriceCents) || !isSafeCents(lineTotalCents)) {
      return { ok: false, result: failure(500, "menu_config_invalid") };
    }
    subtotalCents += lineTotalCents;

    lines.push({
      itemId: line.itemId,
      name,
      quantity: line.quantity,
      unitPrice: centsToEuros(unitPriceCents),
      lineTotal: centsToEuros(lineTotalCents),
      unitPriceCents,
      lineTotalCents,
      /* Στιγμιότυπο επιλογών ΜΟΝΟ όταν υπάρχουν — οι απλές γραμμές κρατούν
       * ακριβώς το σχήμα του milestone 1/2. */
      ...(resolved.options.length > 0
        ? {
            basePrice: centsToEuros(basePriceCents),
            basePriceCents,
            options: resolved.options,
          }
        : {}),
    });
  }

  if (!isSafeCents(subtotalCents)) {
    return { ok: false, result: failure(500, "menu_config_invalid") };
  }

  const totals = computeTotalsCents(subtotalCents, terms);

  const quote: CheckoutQuote = {
    shopId: request.shopId,
    shopName,
    lines,
    subtotal: centsToEuros(totals.subtotalCents),
    deliveryFee: centsToEuros(totals.deliveryFeeCents),
    total: centsToEuros(totals.totalCents),
    subtotalCents: totals.subtotalCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    totalCents: totals.totalCents,
    shopTerms: {
      minOrder: centsToEuros(terms.minOrderCents),
      deliveryFee: centsToEuros(terms.deliveryFeeCents),
      freeDeliveryOver:
        terms.freeDeliveryOverCents === null ? null : centsToEuros(terms.freeDeliveryOverCents),
    },
    delivery,
  };

  /* Milestone 4: η ζώνη που είδε ο πελάτης ≠ η τρέχουσα → νέα επιβεβαίωση.
   * Ποτέ σιωπηλή μετάβαση σε άλλη ζώνη ή στους γενικούς όρους. */
  const seenZoneId = request.expectedDeliveryZoneId ?? null;
  const currentZoneId = delivery.mode === "zone" ? delivery.zoneId : null;
  if (seenZoneId !== currentZoneId) {
    return {
      ok: false,
      result: failure(409, "delivery_zone_changed", { message: describeZoneChange(delivery), quote }),
    };
  }

  /* Ελάχιστη παραγγελία — με τις ΕΞΟΥΣΙΟΔΟΤΗΜΕΝΕΣ τιμές (της ζώνης, αν υπάρχει) */
  if (totals.missingForMinOrderCents > 0) {
    return {
      ok: false,
      result: failure(400, "below_minimum_order", {
        message: `Η ελάχιστη παραγγελία για αυτό το κατάστημα είναι ${euro(terms.minOrderCents)}. Λείπουν ${euro(totals.missingForMinOrderCents)}.`,
        quote,
      }),
    };
  }

  /* Ανώτατο όριο */
  if (totals.totalCents > CHECKOUT_LIMITS.maxOrderTotalCents) {
    return { ok: false, result: failure(400, "order_too_large", { quote }) };
  }

  return {
    ok: true,
    quote,
    ownerUid: typeof shop.ownerUid === "string" && shop.ownerUid.length > 0 ? shop.ownerUid : null,
    etaMinutes: parseEtaMinutes(shop.etaMinutes),
    delivery,
  };
}

/* ==========================================================================
 *  ΕΓΓΡΑΦΑ
 * ========================================================================== */

function buildStoredResponse(
  orderId: string,
  quote: CheckoutQuote,
  request: ValidatedCheckoutRequest,
): StoredCheckoutResponse {
  return {
    ok: true,
    orderId,
    code: orderCodeFromId(orderId),
    status: "pending",
    paymentMethod: request.paymentMethod,
    address: buildCompatAddress(request.delivery),
    ...quote,
  };
}

function buildOrderDocument(
  uid: string,
  request: ValidatedCheckoutRequest,
  pricing: PricingOk,
  serverTimestamp: unknown,
  eligibilityCheckedAt: unknown,
): Record<string, unknown> {
  const { quote } = pricing;

  return {
    shopId: request.shopId,
    shopName: quote.shopName,
    ownerUid: pricing.ownerUid,
    userId: uid,

    customer: { ...request.customer },
    delivery: { ...request.delivery },
    // Συμβατότητα με τις παλιές οθόνες — παράγεται ΕΔΩ από επικυρωμένα πεδία
    address: buildCompatAddress(request.delivery),
    ...(request.notes ? { notes: request.notes } : {}),
    paymentMethod: request.paymentMethod,

    /* Αμετάβλητο στιγμιότυπο: ονόματα, επιλογές, βάση, προσαυξήσεις, μονάδα,
     * ποσότητα, σύνολο γραμμής — όπως τα επαλήθευσε ο server ΤΩΡΑ. Οι οθόνες
     * και οι αποδείξεις διαβάζουν ΑΥΤΑ, ποτέ τον σημερινό κατάλογο. */
    lines: quote.lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      ...(line.options && line.options.length > 0
        ? {
            basePrice: line.basePrice,
            basePriceCents: line.basePriceCents,
            options: line.options.map((option) => ({ ...option })),
          }
        : {}),
    })),
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    subtotalCents: quote.subtotalCents,
    deliveryFeeCents: quote.deliveryFeeCents,
    totalCents: quote.totalCents,

    /* Milestone 4: ΑΜΕΤΑΒΛΗΤΟ στιγμιότυπο όρων παράδοσης (ζώνη, ΤΚ, μεταφορικά,
     * όρια). Οι οθόνες διαβάζουν ΑΥΤΟ, όχι τη σημερινή ρύθμιση ζωνών. */
    deliveryTerms: { ...pricing.delivery },
    /* Η στιγμή (ώρα server) στην οποία κρίθηκε ότι το κατάστημα δεχόταν παραγγελίες */
    eligibilityCheckedAt,

    status: "pending",
    etaMinutes: pricing.etaMinutes,
    source: "web",
    schemaVersion: 2,
    createdAt: serverTimestamp,
  };
}

/* ==========================================================================
 *  ΕΠΑΝΑΛΗΨΗ Ή ΣΥΓΚΡΟΥΣΗ ΚΛΕΙΔΙΟΥ
 * ========================================================================== */

function replayOrConflict(
  record: IdempotencyRecord,
  uid: string,
  requestHash: string,
): CheckoutHttpResult {
  if (record.uid !== uid) {
    // Πρακτικά αδύνατο (το id περιέχει το uid)· δεν αποκαλύπτουμε τίποτα
    return failure(409, "idempotency_key_reused");
  }

  /* Το κλειδί έκλεισε μέσω /api/orders/recover → ΚΑΜΙΑ παραγγελία, ποτέ */
  if (record.state === "closed") {
    return failure(409, "checkout_attempt_closed");
  }

  if (record.requestHash !== requestHash) {
    return failure(409, "idempotency_key_reused", {
      existingOrder: { orderId: record.orderId, code: record.response.code },
    });
  }

  return { status: 200, body: { ...record.response, replayed: true } };
}

/* ==========================================================================
 *  ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ
 * ========================================================================== */

type TransactionOutcome =
  | { kind: "existing"; record: IdempotencyRecord }
  | { kind: "rejected"; result: CheckoutHttpResult }
  | { kind: "created"; response: StoredCheckoutResponse };

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  return match ? match[1] : null;
}

/** Ταυτότητα ΜΟΝΟ από το επαληθευμένο Firebase ID token — ποτέ από το σώμα */
async function authenticate(
  deps: Pick<CheckoutDeps, "verifyIdToken">,
  authorization: string | null,
): Promise<string | null> {
  const token = parseBearer(authorization);
  if (!token) return null;
  try {
    const decoded = await deps.verifyIdToken(token);
    return typeof decoded.uid === "string" && decoded.uid.length > 0 ? decoded.uid : null;
  } catch {
    return null;
  }
}

export async function handleCheckoutRequest(
  deps: CheckoutDeps,
  input: { authorization: string | null; rawBody: string },
): Promise<CheckoutHttpResult> {
  const { store, logger } = deps;

  /* ------------------------------ 1. Μέγεθος ----------------------------- */
  if (new TextEncoder().encode(input.rawBody).length > CHECKOUT_LIMITS.maxRequestBytes) {
    return failure(413, "payload_too_large");
  }

  /* ----------------------------- 2. Ταυτότητα ---------------------------- */
  const uid = await authenticate(deps, input.authorization);
  if (!uid) return failure(401, "unauthenticated");

  /* ------------------------------ 3. JSON -------------------------------- */
  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return failure(400, "invalid_json");
  }

  /* ----------------------------- 4. Επικύρωση ---------------------------- */
  const validation = validateCheckoutRequest(json);
  if (!validation.ok) {
    const fieldErrors: CheckoutFieldErrors = validation.fieldErrors;
    return failure(400, "validation_failed", { fieldErrors });
  }
  const request = validation.value;

  const recordId = idempotencyRecordId(uid, request.idempotencyKey);
  const requestHash = canonicalRequestHash(request);

  try {
    /* ---------------- 5. Γρήγορος δρόμος: ήδη ολοκληρωμένο ---------------- */
    const existing = await store.getIdempotencyRecord(recordId);
    if (existing) return replayOrConflict(existing, uid, requestHash);

    /* ------------------- 6. Rate limit — μόνο νέες παραγγελίες ------------- */
    const recent = await store.countRecentOrders(
      uid,
      deps.now() - RATE_LIMIT.windowMs,
      RATE_LIMIT.maxOrders,
    );
    if (recent >= RATE_LIMIT.maxOrders) return failure(429, "rate_limited");

    /* ---------------------- 7. Ατομική συναλλαγή -------------------------- */
    let outcome: TransactionOutcome;
    try {
      outcome = await store.runTransaction<TransactionOutcome>(async (tx) => {
        const record = await tx.getIdempotencyRecord(recordId);
        if (record) return { kind: "existing", record };

        const shop = await tx.getShop(request.shopId);
        if (!shop) return { kind: "rejected", result: failure(404, "shop_not_found") };

        /* Milestone 4: ώρα SERVER, ξαναδιαβασμένη σε ΚΑΘΕ προσπάθεια της
         * συναλλαγής (μια επανάληψη λόγω σύγκρουσης ελέγχει ξανά το «τώρα»). */
        const decidedAt = deps.now();
        const eligibility = checkOrderEligibility(request, shop, decidedAt, logger);
        if (!eligibility.ok) return { kind: "rejected", result: eligibility.result };

        /* Κάθε προϊόν διαβάζεται ΜΙΑ φορά, όσες παραλλαγές κι αν έχει */
        const itemIds = [...new Set(request.lines.map((line) => line.itemId))];
        const itemDocs = await tx.getMenuItems(request.shopId, itemIds);
        const items = new Map(itemIds.map((itemId, index) => [itemId, itemDocs[index] ?? null]));

        const pricing = priceOrder(request, shop, items, eligibility, logger);
        if (!pricing.ok) return { kind: "rejected", result: pricing.result };

        /* Το σύνολο που είδε ο πελάτης ≠ εξουσιοδοτημένο → ΚΑΜΙΑ εγγραφή */
        if (pricing.quote.totalCents !== request.expectedTotalCents) {
          return {
            kind: "rejected",
            result: failure(409, "price_changed", {
              message: `Οι τιμές ή τα μεταφορικά άλλαξαν. Νέο σύνολο: ${euro(pricing.quote.totalCents)} (αντί για ${euro(request.expectedTotalCents)}). Έλεγξε τη σύνοψη και επιβεβαίωσε ξανά.`,
              quote: pricing.quote,
            }),
          };
        }

        const orderId = store.newOrderId();
        const response = buildStoredResponse(orderId, pricing.quote, request);
        const now = deps.now();

        tx.createOrderWithRecord({
          orderId,
          order: buildOrderDocument(
            uid,
            request,
            pricing,
            deps.serverTimestamp(),
            deps.timestampFromMillis(decidedAt),
          ),
          recordId,
          record: {
            uid,
            requestHash,
            orderId,
            response,
            createdAt: deps.serverTimestamp(),
            expiresAt: deps.timestampFromMillis(now + IDEMPOTENCY_RECORD_TTL_MS),
          },
        });

        return { kind: "created", response };
      });
    } catch (error) {
      /* Ταυτόχρονο αίτημα με το ίδιο κλειδί πρόλαβε να γράψει πρώτο */
      if (store.isAlreadyExistsError(error)) {
        const winner = await store.getIdempotencyRecord(recordId);
        if (winner) return replayOrConflict(winner, uid, requestHash);
      }
      throw error;
    }

    switch (outcome.kind) {
      case "existing":
        return replayOrConflict(outcome.record, uid, requestHash);
      case "rejected":
        return outcome.result;
      case "created":
        return { status: 201, body: { ...outcome.response, replayed: false } };
    }
  } catch (error) {
    // Λεπτομέρειες μόνο στα logs — ο πελάτης δεν βλέπει ποτέ εσωτερικά σφάλματα
    logger?.error("[orders] Αποτυχία δημιουργίας παραγγελίας:", error);
    return failure(500, "internal_error");
  }
}

/* ==========================================================================
 *  ΑΝΑΓΝΩΣΗ ΑΠΟΘΗΚΕΥΜΕΝΟΥ ΑΠΟΤΕΛΕΣΜΑΤΟΣ
 * ========================================================================== */

/** Αμυντική ανάγνωση εγγράφου idempotency — κακόμορφο = σαν να μην υπάρχει */
export function parseIdempotencyRecord(data: unknown): IdempotencyRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;

  if (typeof record.uid !== "string" || record.uid.length === 0) return null;

  /* Κλειστή προσπάθεια (milestone 2) */
  if (record.state === "closed") {
    return { state: "closed", uid: record.uid };
  }

  /* Ολοκληρωμένη — τα έγγραφα του milestone 1 δεν έχουν `state` */
  if (record.state !== undefined && record.state !== "completed") return null;

  const response = record.response as Record<string, unknown> | undefined;
  if (
    typeof record.requestHash !== "string" ||
    typeof record.orderId !== "string" ||
    typeof response !== "object" ||
    response === null ||
    response.ok !== true ||
    typeof response.code !== "string" ||
    typeof response.orderId !== "string"
  ) {
    return null;
  }

  return {
    state: "completed",
    uid: record.uid,
    requestHash: record.requestHash,
    orderId: record.orderId,
    response: response as unknown as StoredCheckoutResponse,
  };
}

/* ==========================================================================
 *  ΑΝΑΚΤΗΣΗ ΠΡΟΣΠΑΘΕΙΑΣ — POST /api/orders/recover
 *
 *  Χρήση: ο browser κράτησε ΜΟΝΟ το κλειδί μιας προσπάθειας που δεν ξέρει αν
 *  ολοκληρώθηκε (π.χ. ανανέωση σελίδας μετά από χαμένη απάντηση). ΔΕΝ
 *  ξαναστέλνει την παραγγελία· ρωτά:
 *
 *    • υπάρχει ολοκληρωμένη προσπάθεια του ΙΔΙΟΥ uid → η αρχική απάντηση
 *      (outcome: "order_found", replayed: true)
 *    • δεν υπάρχει → δημιουργείται «κλειστή» εγγραφή ΑΤΟΜΙΚΑ και η απάντηση
 *      είναι οριστική (outcome: "no_order"): κανένα μεταγενέστερο αίτημα με
 *      αυτό το κλειδί δεν θα δημιουργήσει παραγγελία
 *    • ήδη κλειστή → "no_order" (ίδια απάντηση, idempotent)
 *
 *  Το uid έρχεται ΜΟΝΟ από το token και είναι μέρος του id του εγγράφου, οπότε
 *  ένας χρήστης δεν μπορεί να δει ή να κλείσει προσπάθεια άλλου χρήστη, ακόμη
 *  κι αν μάθει το κλειδί του. Ο έλεγχος `record.uid === uid` γίνεται ξανά ρητά,
 *  επειδή το Admin SDK παρακάμπτει τα Security Rules.
 * ========================================================================== */

function recoveryFailure(
  status: number,
  code: "invalid_json" | "payload_too_large" | "validation_failed" | "unauthenticated" | "internal_error" | "idempotency_key_reused",
  extra: Partial<Omit<CheckoutErrorBody, "ok" | "code">> = {},
): RecoveryHttpResult {
  return failure(status, code, extra) as RecoveryHttpResult;
}

function recoveryFromRecord(record: IdempotencyRecord, uid: string): RecoveryHttpResult {
  if (record.uid !== uid) {
    // Πρακτικά αδύνατο (το id περιέχει το uid)· δεν αποκαλύπτουμε τίποτα
    return recoveryFailure(409, "idempotency_key_reused");
  }
  if (record.state === "closed") {
    return { status: 200, body: { ok: true, outcome: "no_order" } };
  }
  return {
    status: 200,
    body: { ok: true, outcome: "order_found", order: { ...record.response, replayed: true } },
  };
}

type RecoveryOutcome =
  | { kind: "existing"; record: IdempotencyRecord }
  | { kind: "closed" };

export async function handleAttemptRecovery(
  deps: CheckoutDeps,
  input: { authorization: string | null; rawBody: string },
): Promise<RecoveryHttpResult> {
  const { store, logger } = deps;

  if (new TextEncoder().encode(input.rawBody).length > MAX_RECOVERY_REQUEST_BYTES) {
    return recoveryFailure(413, "payload_too_large");
  }

  const uid = await authenticate(deps, input.authorization);
  if (!uid) return recoveryFailure(401, "unauthenticated");

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return recoveryFailure(400, "invalid_json");
  }

  const key =
    typeof json === "object" && json !== null
      ? (json as Record<string, unknown>).idempotencyKey
      : undefined;
  if (!isValidIdempotencyKey(key)) {
    return recoveryFailure(400, "validation_failed", {
      fieldErrors: { idempotencyKey: "Μη έγκυρο αναγνωριστικό προσπάθειας." },
    });
  }

  const recordId = idempotencyRecordId(uid, key);

  try {
    /* Γρήγορος δρόμος — χωρίς συναλλαγή όταν η απάντηση είναι ήδη γνωστή */
    const existing = await store.getIdempotencyRecord(recordId);
    if (existing) return recoveryFromRecord(existing, uid);

    let outcome: RecoveryOutcome;
    try {
      outcome = await store.runTransaction<RecoveryOutcome>(async (tx) => {
        const record = await tx.getIdempotencyRecord(recordId);
        if (record) return { kind: "existing", record };

        tx.createClosedAttempt({
          recordId,
          record: {
            uid,
            state: "closed",
            createdAt: deps.serverTimestamp(),
            expiresAt: deps.timestampFromMillis(deps.now() + IDEMPOTENCY_RECORD_TTL_MS),
          },
        });
        return { kind: "closed" };
      });
    } catch (error) {
      /* Το αρχικό αίτημα (ή άλλος έλεγχος) πρόλαβε να γράψει πρώτο */
      if (store.isAlreadyExistsError(error)) {
        const winner = await store.getIdempotencyRecord(recordId);
        if (winner) return recoveryFromRecord(winner, uid);
      }
      throw error;
    }

    return outcome.kind === "existing"
      ? recoveryFromRecord(outcome.record, uid)
      : { status: 200, body: { ok: true, outcome: "no_order" } };
  } catch (error) {
    logger?.error("[orders/recover] Αποτυχία ελέγχου προσπάθειας:", error);
    return recoveryFailure(500, "internal_error", {
      message: "Δεν ήταν δυνατός ο έλεγχος της προηγούμενης παραγγελίας. Δοκίμασε ξανά σε λίγο.",
    });
  }
}
