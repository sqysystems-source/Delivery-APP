/* ==========================================================================
 *  Buka Delivery — lib/checkout/validation.ts
 *
 *  Κανόνες επικύρωσης του checkout, κοινοί για φόρμα και server.
 *
 *  Ο browser τους χρησιμοποιεί για άμεσα, inline μηνύματα. Ο server τους
 *  ξανατρέχει σε ό,τι φτάσει στο /api/orders — η επικύρωση του browser είναι
 *  ευκολία για τον πελάτη, ΠΟΤΕ προστασία.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type {
  CheckoutDelivery,
  CheckoutFieldErrors,
  CheckoutLineInput,
  PaymentMethod,
} from "@/types";
import { CHECKOUT_LIMITS, isPaymentMethod } from "@/lib/checkout/constants";
import { normalizePhone } from "@/lib/checkout/phone";
import { canonicalizeSelections, cartLineKey } from "@/lib/menu/options";
import { POSTAL_CODE_INPUT_MAX, normalizePostalCode } from "@/lib/shop/postal-code";

/* ==========================================================================
 *  ΚΑΘΑΡΙΣΜΟΣ ΚΕΙΜΕΝΟΥ
 * ========================================================================== */

/* Χαρακτήρες ελέγχου και αόρατοι χαρακτήρες κατεύθυνσης (bidi), που μπορούν
 * να «κρύψουν» ή να αναποδογυρίσουν κείμενο σε αποδείξεις και οθόνες. */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Μονή γραμμή: αφαιρεί αόρατους χαρακτήρες, ενώνει κενά, κόβει άκρα */
export function cleanSingleLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Πολλές γραμμές: κρατά αλλαγές γραμμής (έως 2 συνεχόμενες), καθαρίζει τα υπόλοιπα */
export function cleanMultiLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Για σύγκριση: χωρίς τόνους, πεζά, χωρίς σημεία στίξης */
export function normalizeForComparison(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("el")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const HAS_LETTER = /\p{L}/u;

/* ==========================================================================
 *  IDs ΕΓΓΡΑΦΩΝ FIRESTORE
 *
 *  Λίστα ΕΠΙΤΡΕΠΤΩΝ χαρακτήρων (όχι απαγορευμένων): γράμματα, αριθμοί, _ και -.
 *  Αποκλείει έτσι το «/» (που θα άλλαζε τη διαδρομή του εγγράφου), τα «.» και
 *  «..», και τα δεσμευμένα ids της μορφής __κάτι__.
 * ========================================================================== */

const DOCUMENT_ID = /^[A-Za-z0-9_-]+$/;

export function isValidDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= CHECKOUT_LIMITS.documentIdMax &&
    DOCUMENT_ID.test(value) &&
    !/^__.*__$/.test(value)
  );
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]+$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= CHECKOUT_LIMITS.idempotencyKeyMin &&
    value.length <= CHECKOUT_LIMITS.idempotencyKeyMax &&
    IDEMPOTENCY_KEY.test(value)
  );
}

/* ==========================================================================
 *  ΕΝΔΕΙΚΤΙΚΕΣ ΚΑΙ «ΜΟΝΟ ΕΤΙΚΕΤΑ» ΔΙΕΥΘΥΝΣΕΙΣ
 *
 *  Οι ενδεικτικές είναι οι παλιές προεπιλογές του επιλογέα διεύθυνσης
 *  (DELIVERY_ADDRESSES στο mock-data) και γενικές λέξεις-κράτησης θέσης.
 *  Απορρίπτονται μόνο ως ΑΚΡΙΒΗΣ αντιστοιχία: το «Κεντρική Πλατεία 5» ή
 *  «Πανεπιστημιούπολη, Εστία Β» είναι κανονικές διευθύνσεις και περνούν.
 * ========================================================================== */

const PLACEHOLDER_STREETS = new Set(
  [
    "Κεντρική Πλατεία",
    "Οδός Ερμού 45",
    "Πανεπιστημιούπολη",
    "Παραλιακή Λεωφόρος 12",
    "Διεύθυνση",
    "Η διεύθυνσή μου",
    "Οδός",
    "Οδός και αριθμός",
    "Δοκιμή",
    "Test",
    "Address",
    "Street",
  ].map(normalizeForComparison),
);

const LABEL_ONLY_STREETS = new Set(
  [
    "Σπίτι",
    "Το σπίτι μου",
    "Δουλειά",
    "Εργασία",
    "Γραφείο",
    "Άλλο",
    "Home",
    "Work",
    "Office",
    "Other",
  ].map(normalizeForComparison),
);

export function isPlaceholderStreet(street: string): boolean {
  return PLACEHOLDER_STREETS.has(normalizeForComparison(street));
}

export function isLabelOnlyStreet(street: string): boolean {
  return LABEL_ONLY_STREETS.has(normalizeForComparison(street));
}

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ ΠΕΔΙΩΝ — επιστρέφουν ελληνικό μήνυμα ή null
 *  (Οι τιμές αναμένονται ήδη καθαρισμένες με cleanSingleLine/cleanMultiLine.)
 * ========================================================================== */

export function validateFullName(value: string): string | null {
  if (!value) return "Συμπλήρωσε το ονοματεπώνυμό σου.";
  if (value.length < CHECKOUT_LIMITS.fullNameMin) return "Το όνομα είναι πολύ σύντομο.";
  if (value.length > CHECKOUT_LIMITS.fullNameMax) {
    return `Το όνομα είναι πολύ μεγάλο (έως ${CHECKOUT_LIMITS.fullNameMax} χαρακτήρες).`;
  }
  if (!HAS_LETTER.test(value)) return "Γράψε ένα έγκυρο ονοματεπώνυμο.";
  return null;
}

export function validatePhoneInput(value: string): string | null {
  if (!value) return "Συμπλήρωσε τηλέφωνο επικοινωνίας.";
  if (value.length > CHECKOUT_LIMITS.phoneRawMax || normalizePhone(value) === null) {
    return "Το τηλέφωνο δεν είναι έγκυρο. Γράψε 10 ψηφία (π.χ. 6912345678) ή διεθνή μορφή με +.";
  }
  return null;
}

export function validateStreet(value: string): string | null {
  if (!value) return "Συμπλήρωσε οδό και αριθμό.";
  if (value.length < CHECKOUT_LIMITS.streetMin) return "Η διεύθυνση είναι πολύ σύντομη.";
  if (value.length > CHECKOUT_LIMITS.streetMax) {
    return `Η διεύθυνση είναι πολύ μεγάλη (έως ${CHECKOUT_LIMITS.streetMax} χαρακτήρες).`;
  }
  if (!HAS_LETTER.test(value)) return "Γράψε το όνομα της οδού, όχι μόνο αριθμό.";
  if (isPlaceholderStreet(value)) {
    return "Αυτή είναι ενδεικτική διεύθυνση. Γράψε τη δική σου οδό και αριθμό.";
  }
  if (isLabelOnlyStreet(value)) {
    return "Γράψε την οδό και τον αριθμό, όχι μόνο την ετικέτα (π.χ. «Σπίτι»).";
  }
  return null;
}

export function validateCity(value: string): string | null {
  if (!value) return "Συμπλήρωσε πόλη ή περιοχή.";
  if (value.length < CHECKOUT_LIMITS.cityMin) return "Η πόλη είναι πολύ σύντομη.";
  if (value.length > CHECKOUT_LIMITS.cityMax) {
    return `Η πόλη είναι πολύ μεγάλη (έως ${CHECKOUT_LIMITS.cityMax} χαρακτήρες).`;
  }
  if (!HAS_LETTER.test(value)) return "Γράψε έγκυρη πόλη ή περιοχή.";
  return null;
}

/**
 * Milestone 4: ταχυδρομικός κώδικας. Κενός επιτρέπεται εδώ (καταστήματα
 * χωρίς ζώνες ΤΚ)· το «υποχρεωτικό» το αποφασίζει η ρύθμιση του καταστήματος
 * — στη φόρμα μέσω `required`, στον server μέσω resolveDeliveryTerms.
 */
export function validatePostalCode(value: string, required = false): string | null {
  if (!value) {
    return required
      ? "Συμπλήρωσε τον ταχυδρομικό κώδικα — το κατάστημα εξυπηρετεί συγκεκριμένες περιοχές."
      : null;
  }
  if (value.length > POSTAL_CODE_INPUT_MAX || normalizePostalCode(value) === null) {
    return "Ο ταχυδρομικός κώδικας πρέπει να έχει 5 ψηφία (π.χ. 546 22).";
  }
  return null;
}

function validateOptionalText(value: string, max: number, what: string): string | null {
  if (value.length > max) return `${what}: έως ${max} χαρακτήρες.`;
  return null;
}

export function validateFloor(value: string): string | null {
  return validateOptionalText(value, CHECKOUT_LIMITS.floorMax, "Όροφος");
}

export function validateDoorbell(value: string): string | null {
  return validateOptionalText(value, CHECKOUT_LIMITS.doorbellMax, "Κουδούνι");
}

export function validateInstructions(value: string): string | null {
  return validateOptionalText(value, CHECKOUT_LIMITS.instructionsMax, "Οδηγίες παράδοσης");
}

export function validateNotes(value: string): string | null {
  return validateOptionalText(value, CHECKOUT_LIMITS.maxNotesLength, "Σχόλια παραγγελίας");
}

/** Μπορεί μια αποθηκευμένη διεύθυνση να χρησιμοποιηθεί ως διεύθυνση παράδοσης; */
export function isUsableStreet(street: unknown): boolean {
  return validateStreet(cleanSingleLine(street)) === null;
}

/* ==========================================================================
 *  ΦΟΡΜΑ CHECKOUT (browser)
 * ========================================================================== */

export type CheckoutFormValues = {
  fullName: string;
  phone: string;
  street: string;
  city: string;
  /** Milestone 4 — όπως τον γράφει ο πελάτης («546 22»)· κανονικοποιείται στην αποστολή */
  postalCode: string;
  floor: string;
  doorbell: string;
  instructions: string;
};

export type CheckoutFormField = keyof CheckoutFormValues;

/** Η σειρά με την οποία εμφανίζονται — και εστιάζονται — τα πεδία */
export const CHECKOUT_FORM_FIELDS: readonly CheckoutFormField[] = [
  "fullName",
  "phone",
  "street",
  "city",
  "postalCode",
  "floor",
  "doorbell",
  "instructions",
];

export type CheckoutFormOptions = {
  /** Milestone 4: το κατάστημα έχει ενεργές ζώνες ΤΚ */
  postalCodeRequired?: boolean;
};

export function validateFormField(
  field: CheckoutFormField,
  raw: string,
  options: CheckoutFormOptions = {},
): string | null {
  switch (field) {
    case "fullName":
      return validateFullName(cleanSingleLine(raw));
    case "phone":
      return validatePhoneInput(cleanSingleLine(raw));
    case "street":
      return validateStreet(cleanSingleLine(raw));
    case "city":
      return validateCity(cleanSingleLine(raw));
    case "postalCode":
      return validatePostalCode(cleanSingleLine(raw), options.postalCodeRequired === true);
    case "floor":
      return validateFloor(cleanSingleLine(raw));
    case "doorbell":
      return validateDoorbell(cleanSingleLine(raw));
    case "instructions":
      return validateInstructions(cleanMultiLine(raw));
  }
}

export function validateCheckoutForm(
  values: CheckoutFormValues,
  notes: string,
  options: CheckoutFormOptions = {},
): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  for (const field of CHECKOUT_FORM_FIELDS) {
    const error = validateFormField(field, values[field] ?? "", options);
    if (error) errors[field] = error;
  }
  const notesError = validateNotes(cleanMultiLine(notes));
  if (notesError) errors.notes = notesError;
  return errors;
}

/** Καθαρισμένη μορφή των πεδίων παράδοσης, χωρίς κενά προαιρετικά πεδία */
export function buildDeliveryFromForm(values: CheckoutFormValues): CheckoutDelivery {
  const floor = cleanSingleLine(values.floor);
  const doorbell = cleanSingleLine(values.doorbell);
  const instructions = cleanMultiLine(values.instructions);
  /* Milestone 4: ΜΟΝΟ κανονικός ΤΚ φεύγει· κενός → κανένα πεδίο (ίδιο αίτημα με πριν) */
  const postalCode = normalizePostalCode(cleanSingleLine(values.postalCode ?? ""));

  return {
    street: cleanSingleLine(values.street),
    city: cleanSingleLine(values.city),
    ...(postalCode ? { postalCode } : {}),
    ...(floor ? { floor } : {}),
    ...(doorbell ? { doorbell } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/**
 * Η συμβατή συμβολοσειρά `address` («Οδός, Πόλη») που διαβάζουν οι παλιές
 * οθόνες. Με τα όρια 120 + 2 + 60 χωρά πάντα στους 200 χαρακτήρες.
 */
export function buildCompatAddress(delivery: Pick<CheckoutDelivery, "street" | "city">): string {
  return `${delivery.street}, ${delivery.city}`.slice(0, CHECKOUT_LIMITS.maxCompatAddressLength);
}

/* ==========================================================================
 *  ΓΡΑΜΜΕΣ ΠΑΡΑΓΓΕΛΙΑΣ
 * ========================================================================== */

export type LinesValidationResult =
  | { ok: true; lines: CheckoutLineInput[] }
  | { ok: false; error: string };

/**
 * Επικυρώνει γραμμές, ΕΝΟΠΟΙΕΙ διπλότυπα και ΞΑΝΑΕΛΕΓΧΕΙ τα όρια ΜΕΤΑ την
 * ενοποίηση: δύο γραμμές των 15 για το ίδιο προϊόν είναι 30 τεμάχια, όχι
 * «δύο έγκυρες γραμμές».
 *
 * Milestone 3:
 *   • Η ταυτότητα γραμμής είναι itemId + ΚΑΝΟΝΙΚΕΣ επιλογές (cartLineKey):
 *     ίδιες επιλογές σε άλλη σειρά = ίδια γραμμή, άλλες επιλογές = άλλη.
 *   • Το όριο ανά προϊόν (20) μετρά ΟΛΕΣ τις παραλλαγές του προϊόντος μαζί —
 *     το «σπάσιμο» σε παραλλαγές δεν το παρακάμπτει.
 *   • Κακόμορφες/διπλές επιλογές απορρίπτονται (δεν διορθώνονται σιωπηλά).
 *
 * Επιστρέφει γραμμές ταξινομημένες κατά κλειδί γραμμής, ώστε το ίδιο καλάθι
 * να παράγει πάντα την ίδια κανονική μορφή.
 */
export function validateAndMergeLines(raw: unknown): LinesValidationResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Το καλάθι είναι άδειο." };
  }
  if (raw.length > CHECKOUT_LIMITS.maxLines) {
    return {
      ok: false,
      error: `Πάρα πολλά διαφορετικά προϊόντα (έως ${CHECKOUT_LIMITS.maxLines}).`,
    };
  }

  const merged = new Map<string, CheckoutLineInput>();
  const perProduct = new Map<string, number>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, error: "Μη έγκυρη γραμμή παραγγελίας." };
    }
    const line = entry as Record<string, unknown>;

    if (!isValidDocumentId(line.itemId)) {
      return { ok: false, error: "Μη έγκυρο προϊόν στο καλάθι." };
    }

    const quantity = line.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > CHECKOUT_LIMITS.maxQuantityPerLine
    ) {
      return {
        ok: false,
        error: `Μη έγκυρη ποσότητα (1 έως ${CHECKOUT_LIMITS.maxQuantityPerLine} τεμάχια ανά προϊόν).`,
      };
    }

    const selections = canonicalizeSelections(line.selections);
    if (!selections.ok) return { ok: false, error: selections.error };

    const key = cartLineKey(line.itemId, selections.selections);
    const existing = merged.get(key);
    merged.set(key, {
      itemId: line.itemId,
      quantity: (existing?.quantity ?? 0) + quantity,
      ...(selections.selections.length > 0 ? { selections: selections.selections } : {}),
    });
    perProduct.set(line.itemId, (perProduct.get(line.itemId) ?? 0) + quantity);
  }

  let totalUnits = 0;
  for (const quantity of perProduct.values()) {
    if (quantity > CHECKOUT_LIMITS.maxQuantityPerLine) {
      return {
        ok: false,
        error: `Έως ${CHECKOUT_LIMITS.maxQuantityPerLine} τεμάχια ανά προϊόν (μαζί με όλες τις παραλλαγές του).`,
      };
    }
    totalUnits += quantity;
  }

  if (totalUnits > CHECKOUT_LIMITS.maxTotalItems) {
    return {
      ok: false,
      error: `Η παραγγελία έχει πάρα πολλά τεμάχια (έως ${CHECKOUT_LIMITS.maxTotalItems}).`,
    };
  }

  const lines = Array.from(merged, ([key, line]) => ({ key, line }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ line }) => line);

  return { ok: true, lines };
}

/* ==========================================================================
 *  ΑΙΤΗΜΑ /api/orders (server)
 * ========================================================================== */

/** Η κανονική, επικυρωμένη μορφή ενός αιτήματος checkout */
export type ValidatedCheckoutRequest = {
  idempotencyKey: string;
  shopId: string;
  customer: { fullName: string; phone: string };
  delivery: CheckoutDelivery;
  notes?: string;
  paymentMethod: PaymentMethod;
  lines: CheckoutLineInput[];
  expectedTotalCents: number;
  /** Milestone 4: μόνο όταν ο πελάτης είδε ζώνη ΤΚ */
  expectedDeliveryZoneId?: string;
};

export type CheckoutRequestValidation =
  | { ok: true; value: ValidatedCheckoutRequest }
  | { ok: false; fieldErrors: CheckoutFieldErrors };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): { ok: boolean; value: string } {
  if (value === undefined || value === null) return { ok: true, value: "" };
  return typeof value === "string" ? { ok: true, value } : { ok: false, value: "" };
}

/**
 * Επικυρώνει ΟΛΟ το αίτημα και επιστρέφει κανονική μορφή.
 *
 * Άγνωστα πεδία (π.χ. `price`, `total`, `userId`, `status`, `shopName`) δεν
 * απορρίπτονται — απλώς ΑΓΝΟΟΥΝΤΑΙ: η κανονική μορφή χτίζεται μόνο από τα
 * πεδία που ορίζει το CheckoutRequest, οπότε δεν φτάνουν ποτέ στη βάση.
 */
export function validateCheckoutRequest(raw: unknown): CheckoutRequestValidation {
  const body = asRecord(raw);
  if (!body) return { ok: false, fieldErrors: { lines: "Μη έγκυρο αίτημα." } };

  const errors: CheckoutFieldErrors = {};

  if (!isValidIdempotencyKey(body.idempotencyKey)) {
    errors.idempotencyKey = "Μη έγκυρο αναγνωριστικό αιτήματος.";
  }

  if (!isValidDocumentId(body.shopId)) {
    errors.shopId = "Μη έγκυρο κατάστημα.";
  }

  if (!isPaymentMethod(body.paymentMethod)) {
    errors.paymentMethod = "Διαθέσιμος τρόπος πληρωμής: μετρητά κατά την παράδοση.";
  }

  const expected = body.expectedTotalCents;
  if (
    typeof expected !== "number" ||
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    expected > CHECKOUT_LIMITS.maxExpectedTotalCents
  ) {
    errors.expectedTotalCents = "Μη έγκυρο αναμενόμενο σύνολο.";
  }

  /* ---------------------------- Πελάτης ---------------------------- */
  const customer = asRecord(body.customer) ?? {};
  const fullNameRaw = optionalString(customer.fullName);
  const phoneRaw = optionalString(customer.phone);
  const fullName = cleanSingleLine(fullNameRaw.value);
  const phoneInput = cleanSingleLine(phoneRaw.value);

  const fullNameError = fullNameRaw.ok ? validateFullName(fullName) : "Μη έγκυρο όνομα.";
  if (fullNameError) errors.fullName = fullNameError;

  const phoneError = phoneRaw.ok ? validatePhoneInput(phoneInput) : "Μη έγκυρο τηλέφωνο.";
  if (phoneError) errors.phone = phoneError;

  /* ---------------------------- Παράδοση --------------------------- */
  const delivery = asRecord(body.delivery) ?? {};
  const fields = {
    street: optionalString(delivery.street),
    city: optionalString(delivery.city),
    postalCode: optionalString(delivery.postalCode),
    floor: optionalString(delivery.floor),
    doorbell: optionalString(delivery.doorbell),
    instructions: optionalString(delivery.instructions),
  };

  const street = cleanSingleLine(fields.street.value);
  const city = cleanSingleLine(fields.city.value);
  const floor = cleanSingleLine(fields.floor.value);
  const doorbell = cleanSingleLine(fields.doorbell.value);
  const instructions = cleanMultiLine(fields.instructions.value);

  const streetError = fields.street.ok ? validateStreet(street) : "Μη έγκυρη διεύθυνση.";
  if (streetError) errors.street = streetError;
  const cityError = fields.city.ok ? validateCity(city) : "Μη έγκυρη πόλη.";
  if (cityError) errors.city = cityError;
  /* Milestone 4: ΤΚ προαιρετικός εδώ — αν δοθεί, πρέπει να είναι έγκυρος. Το
   * «υποχρεωτικός» το ελέγχει ο server με τη ρύθμιση ζωνών του καταστήματος. */
  const postalCodeInput = cleanSingleLine(fields.postalCode.value);
  const postalCodeError = fields.postalCode.ok
    ? validatePostalCode(postalCodeInput)
    : "Μη έγκυρος ταχυδρομικός κώδικας.";
  if (postalCodeError) errors.postalCode = postalCodeError;
  const postalCode = postalCodeError ? null : normalizePostalCode(postalCodeInput);
  const floorError = fields.floor.ok ? validateFloor(floor) : "Μη έγκυρος όροφος.";
  if (floorError) errors.floor = floorError;
  const doorbellError = fields.doorbell.ok ? validateDoorbell(doorbell) : "Μη έγκυρο κουδούνι.";
  if (doorbellError) errors.doorbell = doorbellError;
  const instructionsError = fields.instructions.ok
    ? validateInstructions(instructions)
    : "Μη έγκυρες οδηγίες.";
  if (instructionsError) errors.instructions = instructionsError;

  /* ------------------ Ζώνη που είδε ο πελάτης (milestone 4) ---------------- */
  const expectedZone = body.expectedDeliveryZoneId;
  if (
    expectedZone !== undefined &&
    expectedZone !== null &&
    !(typeof expectedZone === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(expectedZone))
  ) {
    errors.expectedDeliveryZoneId = "Μη έγκυρη ζώνη παράδοσης.";
  }

  /* ----------------------------- Σχόλια ---------------------------- */
  const notesRaw = optionalString(body.notes);
  const notes = cleanMultiLine(notesRaw.value);
  const notesError = notesRaw.ok ? validateNotes(notes) : "Μη έγκυρα σχόλια.";
  if (notesError) errors.notes = notesError;

  /* ----------------------------- Γραμμές --------------------------- */
  const lines = validateAndMergeLines(body.lines);
  if (!lines.ok) errors.lines = lines.error;

  if (Object.keys(errors).length > 0 || !lines.ok) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    value: {
      idempotencyKey: body.idempotencyKey as string,
      shopId: body.shopId as string,
      customer: { fullName, phone: normalizePhone(phoneInput) as string },
      delivery: {
        street,
        city,
        /* Milestone 4: μόνο όταν δόθηκε — αιτήματα χωρίς ΤΚ κρατούν το ΙΔΙΟ
         * κανονικό σχήμα (και το ίδιο hash idempotency) με πριν */
        ...(postalCode ? { postalCode } : {}),
        ...(floor ? { floor } : {}),
        ...(doorbell ? { doorbell } : {}),
        ...(instructions ? { instructions } : {}),
      },
      ...(notes ? { notes } : {}),
      paymentMethod: body.paymentMethod as PaymentMethod,
      lines: lines.lines,
      expectedTotalCents: expected as number,
      ...(typeof expectedZone === "string" ? { expectedDeliveryZoneId: expectedZone } : {}),
    },
  };
}
