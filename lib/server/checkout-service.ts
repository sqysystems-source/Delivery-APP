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
 *  ── ΤΙ ΔΕΝ ΕΜΠΙΣΤΕΥΟΜΑΣΤΕ ΠΟΤΕ ΑΠΟ ΤΟΝ CLIENT ──────────────────────────
 *  Τιμές, ονόματα προϊόντων/καταστήματος, userId, ownerUid, κατάσταση, ώρα.
 *  Το `expectedTotalCents` είναι μόνο μέτρο σύγκρισης, ΠΟΤΕ τιμή.
 * ========================================================================== */

import "server-only";

import { createHash } from "node:crypto";
import type {
  CheckoutErrorBody,
  CheckoutErrorCode,
  CheckoutFieldErrors,
  CheckoutQuote,
  CheckoutResponseBody,
  CheckoutSuccess,
  VerifiedOrderLine,
} from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import {
  centsToEuros,
  computeTotalsCents,
  isSafeCents,
  parseItemPriceCents,
  parseShopTerms,
} from "@/lib/checkout/money";
import { stableStringify } from "@/lib/checkout/idempotency";
import {
  buildCompatAddress,
  cleanSingleLine,
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

/* ==========================================================================
 *  ΣΥΜΒΟΛΑΙΟ STORE — το υλοποιεί το Firestore adapter (και τα tests)
 * ========================================================================== */

/** Η απάντηση όπως αποθηκεύεται (χωρίς το `replayed`, που ορίζεται κατά την επιστροφή) */
export type StoredCheckoutResponse = Omit<CheckoutSuccess, "replayed">;

export type IdempotencyRecord = {
  uid: string;
  requestHash: string;
  orderId: string;
  response: StoredCheckoutResponse;
};

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
  item_not_found:
    "Κάποιο προϊόν του καλαθιού δεν υπάρχει πια στον κατάλογο. Αφαίρεσέ το και δοκίμασε ξανά.",
  item_unavailable: "Κάποιο προϊόν του καλαθιού εξαντλήθηκε.",
  below_minimum_order: "Δεν καλύπτεται η ελάχιστη παραγγελία του καταστήματος.",
  order_too_large:
    "Η παραγγελία ξεπερνά το όριο των 500€. Επικοινώνησε με το κατάστημα για μεγάλες παραγγελίες.",
  price_changed:
    "Οι τιμές ή τα μεταφορικά άλλαξαν. Έλεγξε τη σύνοψη και επιβεβαίωσε ξανά την παραγγελία.",
  idempotency_key_reused:
    "Αυτή η προσπάθεια παραγγελίας έχει ήδη σταλεί με διαφορετικά στοιχεία. Έλεγξε την παραγγελία και επιβεβαίωσε ξανά.",
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

/** Κανονική μορφή του αιτήματος ΧΩΡΙΣ το κλειδί — ίδια δεδομένα, ίδιο hash */
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
    }),
  );
}

export function orderCodeFromId(orderId: string): string {
  return `BK-${orderId.slice(0, 6).toUpperCase()}`;
}

/* ==========================================================================
 *  ΤΙΜΟΛΟΓΗΣΗ — καθαρή συνάρτηση πάνω σε ό,τι διάβασε η συναλλαγή
 * ========================================================================== */

type PricingOk = {
  ok: true;
  quote: CheckoutQuote;
  ownerUid: string | null;
  etaMinutes: [number, number] | null;
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

export function priceOrder(
  request: ValidatedCheckoutRequest,
  shop: Record<string, unknown>,
  items: Array<Record<string, unknown> | null>,
  logger?: CheckoutLogger,
): PricingOk | PricingFailure {
  /* Κλειστό κατάστημα */
  if (shop.active === false) {
    return { ok: false, result: failure(409, "shop_closed") };
  }

  /* Οικονομικοί όροι — κακόμορφες τιμές = ελεγχόμενο σφάλμα, όχι λάθος χρέωση */
  const termsResult = parseShopTerms({
    minOrder: shop.minOrder,
    deliveryFee: shop.deliveryFee,
    freeDeliveryOver: shop.freeDeliveryOver,
  });
  if (!termsResult.ok) {
    logger?.error(
      `[orders] Κακόμορφο πεδίο ${termsResult.field} στο κατάστημα ${request.shopId}:`,
      termsResult.value,
    );
    return { ok: false, result: failure(500, "shop_config_invalid") };
  }
  const terms = termsResult.terms;

  const rawShopName = cleanSingleLine(shop.name);
  const shopName =
    rawShopName && rawShopName.length <= CHECKOUT_LIMITS.shopNameMax ? rawShopName : request.shopId;

  /* Γραμμές — η τιμή έρχεται ΑΠΟΚΛΕΙΣΤΙΚΑ από το menuItems */
  const lines: VerifiedOrderLine[] = [];
  let subtotalCents = 0;

  for (let index = 0; index < request.lines.length; index += 1) {
    const line = request.lines[index];
    const item = items[index];

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

    const unitPriceCents = parseItemPriceCents(item.price);
    if (unitPriceCents === null) {
      logger?.error(
        `[orders] Κακόμορφη τιμή στο προϊόν shops/${request.shopId}/menuItems/${line.itemId}:`,
        item.price,
      );
      return { ok: false, result: failure(500, "menu_config_invalid") };
    }

    const lineTotalCents = unitPriceCents * line.quantity;
    subtotalCents += lineTotalCents;

    lines.push({
      itemId: line.itemId,
      name,
      quantity: line.quantity,
      unitPrice: centsToEuros(unitPriceCents),
      lineTotal: centsToEuros(lineTotalCents),
      unitPriceCents,
      lineTotalCents,
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
  };

  /* Ελάχιστη παραγγελία — με τις ΕΞΟΥΣΙΟΔΟΤΗΜΕΝΕΣ τιμές */
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

    lines: quote.lines.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    subtotalCents: quote.subtotalCents,
    deliveryFeeCents: quote.deliveryFeeCents,
    totalCents: quote.totalCents,

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
  const token = parseBearer(input.authorization);
  if (!token) return failure(401, "unauthenticated");

  let uid: string;
  try {
    const decoded = await deps.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return failure(401, "unauthenticated");
  }
  if (typeof uid !== "string" || uid.length === 0) return failure(401, "unauthenticated");

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

        const items = await tx.getMenuItems(
          request.shopId,
          request.lines.map((line) => line.itemId),
        );

        const pricing = priceOrder(request, shop, items, logger);
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
          order: buildOrderDocument(uid, request, pricing, deps.serverTimestamp()),
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
  const response = record.response as Record<string, unknown> | undefined;

  if (
    typeof record.uid !== "string" ||
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
    uid: record.uid,
    requestHash: record.requestHash,
    orderId: record.orderId,
    response: response as unknown as StoredCheckoutResponse,
  };
}
