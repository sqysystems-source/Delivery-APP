/* ==========================================================================
 *  Buka Delivery — lib/checkout/money.ts
 *
 *  Όλοι οι υπολογισμοί ποσών σε ΛΕΠΤΑ ΤΟΥ ΕΥΡΩ, ως ακέραιοι.
 *
 *  Χρησιμοποιείται από ΔΥΟ πλευρές με ΤΟΝ ΙΔΙΟ κώδικα:
 *    • server (/api/orders): υπολογίζει το εξουσιοδοτημένο ποσό
 *    • browser (καλάθι/checkout): υπολογίζει το ποσό που βλέπει ο πελάτης,
 *      το οποίο στέλνεται ως `expectedTotalCents` ΜΟΝΟ για σύγκριση
 *
 *  Επειδή η αριθμητική είναι ίδια, διαφορά ανάμεσα στα δύο σημαίνει ΠΑΝΤΑ ότι
 *  άλλαξε τιμή ή όρος του καταστήματος — ποτέ σφάλμα στρογγυλοποίησης.
 * ========================================================================== */

import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";

/**
 * Ευρώ → λεπτά. Για τιμές έως 2 δεκαδικά (που είναι ό,τι επιτρέπει η φόρμα
 * καταλόγου) το σφάλμα κινητής υποδιαστολής είναι πάντα < 0,5 λεπτό, οπότε
 * η στρογγυλοποίηση δίνει ακριβές αποτέλεσμα: 3.9 * 100 = 390.00000000000006 → 390.
 */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/** Λεπτά → ευρώ (για εμφάνιση και για συμβατά πεδία ευρώ) */
export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}

export function isSafeCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/* --------------------------------------------------------------------------
 *  Όροι καταστήματος
 * -------------------------------------------------------------------------- */

export type ShopTermsCents = {
  minOrderCents: number;
  deliveryFeeCents: number;
  /** null = δεν υπάρχει δωρεάν μεταφορά */
  freeDeliveryOverCents: number | null;
};

export type ShopTermsParseResult =
  | { ok: true; terms: ShopTermsCents }
  | { ok: false; field: "minOrder" | "deliveryFee" | "freeDeliveryOver"; value: unknown };

function parseEuroAmount(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  const cents = toCents(value);
  return isSafeCents(cents) ? cents : null;
}

/**
 * Διαβάζει και ΕΠΙΚΥΡΩΝΕΙ τους οικονομικούς όρους ενός καταστήματος.
 *
 * Απόντα πεδία κρατούν την παλιά συμπεριφορά (ελάχιστη 0€, μεταφορικά 0€,
 * χωρίς όριο δωρεάν μεταφοράς). Όμως ΚΑΚΟΜΟΡΦΕΣ τιμές (string, αρνητικές,
 * NaN, Infinity, παράλογα μεγάλες) ΔΕΝ «διορθώνονται» σιωπηλά: επιστρέφουν
 * σφάλμα, ώστε ο server να απαντήσει ελεγχόμενα αντί να χρεώσει λάθος ποσό.
 */
export function parseShopTerms(raw: {
  minOrder?: unknown;
  deliveryFee?: unknown;
  freeDeliveryOver?: unknown;
}): ShopTermsParseResult {
  const minOrderCents =
    raw.minOrder === undefined || raw.minOrder === null
      ? 0
      : parseEuroAmount(raw.minOrder, CHECKOUT_LIMITS.maxMinOrder);
  if (minOrderCents === null) return { ok: false, field: "minOrder", value: raw.minOrder };

  const deliveryFeeCents =
    raw.deliveryFee === undefined || raw.deliveryFee === null
      ? 0
      : parseEuroAmount(raw.deliveryFee, CHECKOUT_LIMITS.maxDeliveryFee);
  if (deliveryFeeCents === null) {
    return { ok: false, field: "deliveryFee", value: raw.deliveryFee };
  }

  let freeDeliveryOverCents: number | null = null;
  if (raw.freeDeliveryOver !== undefined && raw.freeDeliveryOver !== null) {
    freeDeliveryOverCents = parseEuroAmount(
      raw.freeDeliveryOver,
      CHECKOUT_LIMITS.maxFreeDeliveryOver,
    );
    if (freeDeliveryOverCents === null) {
      return { ok: false, field: "freeDeliveryOver", value: raw.freeDeliveryOver };
    }
  }

  return { ok: true, terms: { minOrderCents, deliveryFeeCents, freeDeliveryOverCents } };
}

/** Τιμή προϊόντος από τη βάση → λεπτά, ή null αν είναι κακόμορφη */
export function parseItemPriceCents(value: unknown): number | null {
  return parseEuroAmount(value, CHECKOUT_LIMITS.maxItemPrice);
}

/* --------------------------------------------------------------------------
 *  Σύνολα
 * -------------------------------------------------------------------------- */

export type TotalsCents = {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  /** Πόσα λείπουν για την ελάχιστη παραγγελία (0 όταν καλύπτεται) */
  missingForMinOrderCents: number;
  /** Πόσα λείπουν για δωρεάν μεταφορικά (null αν δεν ισχύει) */
  missingForFreeDeliveryCents: number | null;
};

/**
 * Ο κανόνας μεταφορικών — ίδιος στον server και στον browser:
 * δωρεάν όταν το υποσύνολο είναι ΤΟΥΛΑΧΙΣΤΟΝ ίσο με το όριο.
 */
export function computeTotalsCents(subtotalCents: number, terms: ShopTermsCents): TotalsCents {
  const qualifiesForFree =
    terms.freeDeliveryOverCents !== null && subtotalCents >= terms.freeDeliveryOverCents;

  const deliveryFeeCents = subtotalCents === 0 || qualifiesForFree ? 0 : terms.deliveryFeeCents;

  return {
    subtotalCents,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    missingForMinOrderCents: Math.max(0, terms.minOrderCents - subtotalCents),
    missingForFreeDeliveryCents:
      terms.freeDeliveryOverCents !== null && terms.deliveryFeeCents > 0 && !qualifiesForFree
        ? terms.freeDeliveryOverCents - subtotalCents
        : null,
  };
}
