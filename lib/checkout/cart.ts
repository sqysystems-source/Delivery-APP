/* ==========================================================================
 *  Buka Delivery — lib/checkout/cart.ts
 *
 *  Καθαρή λογική καλαθιού (χωρίς React), ώστε να δοκιμάζεται απομονωμένα:
 *    • parseStoredCart      — αυστηρή επικύρωση ό,τι βρεθεί στο localStorage
 *    • computeCartTotals    — σύνολα με την ΙΔΙΑ αριθμητική που έχει ο server
 *    • removeSubmittedLines — αφαιρεί ΜΟΝΟ ό,τι στάλθηκε, κρατά νέες προσθήκες
 *    • applyQuoteToCart     — ενημερώνει τιμές/όρους από απάντηση του server
 * ========================================================================== */

import type {
  CartLine,
  CartShopRef,
  CartState,
  CartTotals,
  CheckoutLineInput,
  CheckoutQuote,
} from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import {
  centsToEuros,
  computeTotalsCents,
  parseShopTerms,
  toCents,
} from "@/lib/checkout/money";
import { cleanSingleLine, isValidDocumentId } from "@/lib/checkout/validation";

export const EMPTY_CART: CartState = { shop: null, lines: [] };

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ ΑΠΟΘΗΚΕΥΜΕΝΟΥ ΚΑΛΑΘΙΟΥ
 *
 *  Το localStorage είναι είσοδος χρήστη: μπορεί να είναι από παλιότερη
 *  έκδοση, μισογραμμένο ή πειραγμένο. Τίποτα δεν χρησιμοποιείται πριν
 *  περάσει από εδώ.
 * ========================================================================== */

function parseShopRef(raw: unknown): CartShopRef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const shop = raw as Record<string, unknown>;

  if (!isValidDocumentId(shop.id)) return null;

  const name = cleanSingleLine(shop.name);
  if (!name || name.length > CHECKOUT_LIMITS.shopNameMax) return null;

  // Οι όροι επικυρώνονται με τον ίδιο κανόνα που χρησιμοποιεί ο server
  const terms = parseShopTerms({
    minOrder: shop.minOrder,
    deliveryFee: shop.deliveryFee,
    freeDeliveryOver: shop.freeDeliveryOver,
  });
  if (!terms.ok) return null;

  return {
    id: shop.id,
    name,
    minOrder: centsToEuros(terms.terms.minOrderCents),
    deliveryFee: centsToEuros(terms.terms.deliveryFeeCents),
    freeDeliveryOver:
      terms.terms.freeDeliveryOverCents === null
        ? null
        : centsToEuros(terms.terms.freeDeliveryOverCents),
  };
}

function parseLine(raw: unknown): CartLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const line = raw as Record<string, unknown>;

  if (!isValidDocumentId(line.itemId)) return null;

  const name = cleanSingleLine(line.name);
  if (!name || name.length > CHECKOUT_LIMITS.itemNameMax) return null;

  const unitPrice = line.unitPrice;
  if (
    typeof unitPrice !== "number" ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    unitPrice > CHECKOUT_LIMITS.maxItemPrice
  ) {
    return null;
  }

  const quantity = line.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > CHECKOUT_LIMITS.maxQuantityPerLine
  ) {
    return null;
  }

  return { itemId: line.itemId, name, unitPrice, quantity };
}

/**
 * Διαβάζει την ακατέργαστη τιμή του localStorage.
 *
 * Πολιτική: χαλασμένο κατάστημα → άδειο καλάθι (δεν μπορούμε να ξέρουμε σε
 * ποιον ανήκουν τα προϊόντα). Χαλασμένες γραμμές → πετιούνται, οι υπόλοιπες
 * μένουν. Διπλότυπα → ενώνονται, με ταβάνι το όριο ανά προϊόν.
 */
export function parseStoredCart(raw: string | null | undefined): CartState {
  if (!raw) return EMPTY_CART;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CART;
  }

  if (typeof parsed !== "object" || parsed === null) return EMPTY_CART;
  const value = parsed as Record<string, unknown>;

  const shop = parseShopRef(value.shop);
  if (!shop || !Array.isArray(value.lines)) return EMPTY_CART;

  const merged = new Map<string, CartLine>();
  for (const entry of value.lines) {
    const line = parseLine(entry);
    if (!line) continue;

    const existing = merged.get(line.itemId);
    if (existing) {
      existing.quantity = Math.min(
        existing.quantity + line.quantity,
        CHECKOUT_LIMITS.maxQuantityPerLine,
      );
    } else if (merged.size < CHECKOUT_LIMITS.maxLines) {
      merged.set(line.itemId, { ...line });
    }
  }

  const lines = Array.from(merged.values());
  return lines.length === 0 ? EMPTY_CART : { shop, lines };
}

/* ==========================================================================
 *  ΣΥΝΟΛΑ
 * ========================================================================== */

export function computeCartTotals(cart: CartState): CartTotals {
  const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalCents = cart.lines.reduce(
    (sum, line) => sum + toCents(line.unitPrice) * line.quantity,
    0,
  );

  const termsResult = cart.shop
    ? parseShopTerms({
        minOrder: cart.shop.minOrder,
        deliveryFee: cart.shop.deliveryFee,
        freeDeliveryOver: cart.shop.freeDeliveryOver,
      })
    : null;

  const terms =
    termsResult && termsResult.ok
      ? termsResult.terms
      : { minOrderCents: 0, deliveryFeeCents: 0, freeDeliveryOverCents: null };

  const totals = computeTotalsCents(subtotalCents, terms);

  return {
    itemCount,
    subtotal: centsToEuros(totals.subtotalCents),
    deliveryFee: centsToEuros(totals.deliveryFeeCents),
    total: centsToEuros(totals.totalCents),
    minOrder: centsToEuros(terms.minOrderCents),
    missingForMinOrder: centsToEuros(totals.missingForMinOrderCents),
    subtotalCents: totals.subtotalCents,
    deliveryFeeCents: totals.deliveryFeeCents,
    totalCents: totals.totalCents,
    minOrderCents: terms.minOrderCents,
    missingForMinOrderCents: totals.missingForMinOrderCents,
    exceedsMaxOrder: totals.totalCents > CHECKOUT_LIMITS.maxOrderTotalCents,
    canCheckout:
      cart.lines.length > 0 &&
      totals.missingForMinOrderCents === 0 &&
      totals.totalCents <= CHECKOUT_LIMITS.maxOrderTotalCents,
  };
}

/* ==========================================================================
 *  ΜΕΤΑ ΤΗΝ ΑΠΟΣΤΟΛΗ
 * ========================================================================== */

/** Το «στιγμιότυπο» του καλαθιού τη στιγμή που πατήθηκε επιβεβαίωση */
export type SubmittedCartSnapshot = {
  shopId: string;
  lines: CartLine[];
};

export function snapshotCart(cart: CartState): SubmittedCartSnapshot | null {
  if (!cart.shop || cart.lines.length === 0) return null;
  return {
    shopId: cart.shop.id,
    lines: cart.lines.map((line) => ({ ...line })),
  };
}

/**
 * Μετά από ΕΠΙΤΥΧΗ καταχώρηση: αφαιρεί από το καλάθι ακριβώς τις ποσότητες
 * που στάλθηκαν. Ό,τι προστέθηκε όσο περίμενε το αίτημα μένει στο καλάθι —
 * το «άδειασμα καλαθιού» δεν σβήνει ποτέ κάτι που δεν παραγγέλθηκε.
 */
export function removeSubmittedLines(
  current: CartState,
  submitted: SubmittedCartSnapshot,
): CartState {
  if (!current.shop || current.shop.id !== submitted.shopId) return current;

  const submittedQuantities = new Map<string, number>();
  for (const line of submitted.lines) {
    submittedQuantities.set(
      line.itemId,
      (submittedQuantities.get(line.itemId) ?? 0) + line.quantity,
    );
  }

  const remaining = current.lines
    .map((line) => ({
      ...line,
      quantity: line.quantity - (submittedQuantities.get(line.itemId) ?? 0),
    }))
    .filter((line) => line.quantity > 0);

  return remaining.length === 0 ? EMPTY_CART : { shop: current.shop, lines: remaining };
}

/**
 * Ενημερώνει το καλάθι με τις ΕΞΟΥΣΙΟΔΟΤΗΜΕΝΕΣ τιμές και όρους του server
 * (μετά από price_changed κ.λπ.). Οι ποσότητες ΔΕΝ αλλάζουν — ο πελάτης
 * αποφασίζει τι κρατά αφού δει τις νέες τιμές.
 */
export function applyQuoteToCart(current: CartState, quote: CheckoutQuote): CartState {
  if (!current.shop || current.shop.id !== quote.shopId) return current;

  const verified = new Map(quote.lines.map((line) => [line.itemId, line]));

  return {
    shop: {
      ...current.shop,
      name: quote.shopName,
      minOrder: quote.shopTerms.minOrder,
      deliveryFee: quote.shopTerms.deliveryFee,
      freeDeliveryOver: quote.shopTerms.freeDeliveryOver,
    },
    lines: current.lines.map((line) => {
      const match = verified.get(line.itemId);
      return match ? { ...line, name: match.name, unitPrice: match.unitPrice } : line;
    }),
  };
}

/** Μόνο ids και ποσότητες — αυτά στέλνονται στον server, τίποτε άλλο */
export function toRequestLines(lines: CartLine[]): CheckoutLineInput[] {
  return lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity }));
}
