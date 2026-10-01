/* ==========================================================================
 *  Buka Delivery — lib/checkout/idempotency.ts   (πλευρά browser)
 *
 *  Κύκλος ζωής του κλειδιού idempotency:
 *
 *    • Ένα κλειδί ανά ΛΟΓΙΚΗ προσπάθεια checkout.
 *    • ΙΔΙΟ κλειδί όταν ξαναστέλνεται το ΙΔΙΟ αίτημα — π.χ. μετά από χαμένη
 *      απάντηση δικτύου. Ο server αναγνωρίζει την επανάληψη και επιστρέφει την
 *      αρχική παραγγελία αντί να φτιάξει δεύτερη.
 *    • ΝΕΟ κλειδί όταν αλλάξει οτιδήποτε στο αίτημα (στοιχεία, ποσότητες,
 *      σχόλια, επιβεβαιωμένο σύνολο), και μετά από επιτυχία.
 *
 *  Η απόφαση «ίδιο ή νέο» παίρνεται από ένα αποτύπωμα (fingerprint) του
 *  αιτήματος χωρίς το κλειδί.
 * ========================================================================== */

import type { CheckoutRequest } from "@/types";

/** Νέο τυχαίο κλειδί (UUID v4 — 36 χαρακτήρες από [0-9a-f-]) */
export function generateIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Κάθε browser που τρέχει αυτή την εφαρμογή έχει Web Crypto· αν όχι, δεν
  // παράγουμε ψευδοτυχαίο κλειδί που θα μπορούσε να συγκρουστεί.
  throw new Error("Ο browser δεν υποστηρίζει ασφαλή παραγωγή τυχαίων αριθμών.");
}

/** JSON με ταξινομημένα κλειδιά και χωρίς undefined — σταθερό για ίδια δεδομένα */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

/** Αποτύπωμα αιτήματος — οι γραμμές ταξινομούνται ώστε η σειρά να μη μετράει */
export function requestFingerprint(request: Omit<CheckoutRequest, "idempotencyKey">): string {
  const lines = [...request.lines].sort((a, b) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
  );
  return stableStringify({ ...request, lines });
}

export type IdempotencyKeyState = {
  key: string;
  /** Το αποτύπωμα με το οποίο χρησιμοποιήθηκε το κλειδί (null = αχρησιμοποίητο) */
  fingerprint: string | null;
};

export function freshKeyState(generate: () => string = generateIdempotencyKey): IdempotencyKeyState {
  return { key: generate(), fingerprint: null };
}

/**
 * Ποιο κλειδί θα χρησιμοποιήσει η επόμενη αποστολή.
 *
 *   • Κανένα προηγούμενο → νέο κλειδί.
 *   • Ίδιο αποτύπωμα με την προηγούμενη αποστολή → ΙΔΙΟ κλειδί (ασφαλής επανάληψη).
 *   • Διαφορετικό αποτύπωμα → ΝΕΟ κλειδί (άλλαξε το αίτημα = νέα προσπάθεια).
 */
export function resolveKeyForSubmission(
  previous: IdempotencyKeyState | null,
  fingerprint: string,
  generate: () => string = generateIdempotencyKey,
): IdempotencyKeyState {
  if (!previous) return { key: generate(), fingerprint };
  if (previous.fingerprint === null || previous.fingerprint === fingerprint) {
    return { key: previous.key, fingerprint };
  }
  return { key: generate(), fingerprint };
}
