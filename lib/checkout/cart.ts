/* ==========================================================================
 *  Buka Delivery — lib/checkout/cart.ts
 *
 *  Καθαρή λογική καλαθιού (χωρίς React), ώστε να δοκιμάζεται απομονωμένα:
 *    • parseStoredCart      — αυστηρή επικύρωση ό,τι βρεθεί στο localStorage
 *    • computeCartTotals    — σύνολα με την ΙΔΙΑ αριθμητική που έχει ο server
 *    • removeSubmittedLines — αφαιρεί ΜΟΝΟ ό,τι στάλθηκε, κρατά νέες προσθήκες
 *    • applyQuoteToCart     — ενημερώνει τιμές/όρους από απάντηση του server
 *
 *  Milestone 3 — επιλογές προϊόντος:
 *    • Η ταυτότητα γραμμής είναι lineKeyOf(line) = itemId + κανονικές
 *      επιλογές. Ίδιο προϊόν με ίδιες επιλογές → μία γραμμή (ενώνονται οι
 *      ποσότητες)· με άλλες επιλογές → ξεχωριστές γραμμές.
 *    • Το όριο 20 τεμαχίων ισχύει ανά ΠΡΟΪΟΝ, για όλες τις παραλλαγές μαζί
 *      (ίδιο με τον server).
 *    • addLineToCart / replaceCartLine — προσθήκη και επεξεργασία γραμμής,
 *      με ασφαλή ένωση όταν η επεξεργασία κάνει δύο γραμμές ίδιες.
 * ========================================================================== */

import type {
  MenuItem,
  OptionSelection,
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
  parseItemPriceCents,
  parseShopTerms,
  toCents,
  type ShopTermsCents,
} from "@/lib/checkout/money";
import { cleanSingleLine, isValidDocumentId } from "@/lib/checkout/validation";
import {
  describeSelectionProblem,
  lineKeyOf,
  parseOptionSnapshot,
  resolveSelections,
  selectionsFromOptions,
  validateOptionGroups,
} from "@/lib/menu/options";

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
    // Milestone 4: μόνο το ρητό true — οτιδήποτε άλλο = όπως πριν
    ...(shop.zonedDelivery === true ? { zonedDelivery: true as const } : {}),
  };
}

function isDisplayPrice(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= CHECKOUT_LIMITS.maxItemPrice
  );
}

function parseLine(raw: unknown): CartLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const line = raw as Record<string, unknown>;

  if (!isValidDocumentId(line.itemId)) return null;

  const name = cleanSingleLine(line.name);
  if (!name || name.length > CHECKOUT_LIMITS.itemNameMax) return null;

  const quantity = line.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > CHECKOUT_LIMITS.maxQuantityPerLine
  ) {
    return null;
  }

  /* Milestone 3: στιγμιότυπο επιλογών. Κακόμορφο → η γραμμή πετιέται (δεν
   * μπορούμε να ξέρουμε τι είχε διαλέξει ο πελάτης — ούτε το «μαντεύουμε»). */
  const options = parseOptionSnapshot(line.options);
  if (options === null) return null;

  if (options.length === 0) {
    // Παλιό σχήμα (ή προϊόν χωρίς επιλογές): ακριβώς όπως πριν
    if (!isDisplayPrice(line.unitPrice)) return null;
    return { itemId: line.itemId, name, unitPrice: line.unitPrice, quantity };
  }

  if (!isDisplayPrice(line.basePrice)) return null;
  /* Η τιμή μονάδας ΞΑΝΑΥΠΟΛΟΓΙΖΕΤΑΙ από βάση + επιλογές — δεν εμπιστευόμαστε
   * το αποθηκευμένο unitPrice (απλώς για εμφάνιση· ο server τιμολογεί). */
  const unitPriceCents =
    toCents(line.basePrice) + options.reduce((sum, option) => sum + option.priceDeltaCents, 0);

  return {
    itemId: line.itemId,
    name,
    unitPrice: centsToEuros(unitPriceCents),
    quantity,
    basePrice: centsToEuros(toCents(line.basePrice)),
    options,
  };
}

/** Πόσα τεμάχια του ΠΡΟΪΟΝΤΟΣ (όλες οι παραλλαγές) έχει το καλάθι, εκτός από μία γραμμή */
export function productQuantity(lines: readonly CartLine[], itemId: string, exceptKey?: string): number {
  return lines.reduce(
    (sum, line) =>
      line.itemId === itemId && (exceptKey === undefined || lineKeyOf(line) !== exceptKey)
        ? sum + line.quantity
        : sum,
    0,
  );
}

/**
 * Διαβάζει την ακατέργαστη τιμή του localStorage.
 *
 * Πολιτική: χαλασμένο κατάστημα → άδειο καλάθι (δεν μπορούμε να ξέρουμε σε
 * ποιον ανήκουν τα προϊόντα). Χαλασμένες γραμμές → πετιούνται, οι υπόλοιπες
 * μένουν. Διπλότυπα (ίδιο κλειδί γραμμής) → ενώνονται. Το όριο τεμαχίων ανά
 * προϊόν μετρά όλες τις παραλλαγές: ό,τι περισσεύει κόβεται από τις
 * τελευταίες γραμμές.
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
  const perProduct = new Map<string, number>();

  for (const entry of value.lines) {
    const line = parseLine(entry);
    if (!line) continue;

    const used = perProduct.get(line.itemId) ?? 0;
    const allowed = Math.min(line.quantity, CHECKOUT_LIMITS.maxQuantityPerLine - used);
    if (allowed <= 0) continue;

    const key = lineKeyOf(line);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += allowed;
    } else if (merged.size < CHECKOUT_LIMITS.maxLines) {
      merged.set(key, { ...line, quantity: allowed });
    } else {
      continue;
    }
    perProduct.set(line.itemId, used + allowed);
  }

  const lines = Array.from(merged.values());
  return lines.length === 0 ? EMPTY_CART : { shop, lines };
}

/* ==========================================================================
 *  ΠΡΟΣΘΗΚΗ / ΕΠΕΞΕΡΓΑΣΙΑ ΓΡΑΜΜΗΣ
 * ========================================================================== */

export type BuildCartLineResult =
  | { ok: true; line: CartLine }
  | { ok: false; message: string };

/**
 * Φτιάχνει γραμμή καλαθιού από το προϊόν ΟΠΩΣ το έδειξε ο κατάλογος και τα
 * ids που διάλεξε ο πελάτης. Η τιμή εδώ είναι μόνο για εμφάνιση· ο server
 * ξαναϋπολογίζει τα πάντα από τα ids.
 */
export function buildCartLine(
  item: Pick<MenuItem, "id" | "name" | "price" | "optionGroups" | "available">,
  selections: readonly OptionSelection[],
  quantity: number,
): BuildCartLineResult {
  const name = cleanSingleLine(item.name).slice(0, CHECKOUT_LIMITS.itemNameMax);
  if (!isValidDocumentId(item.id) || !name || item.available === false) {
    return { ok: false, message: "Το προϊόν δεν είναι διαθέσιμο." };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > CHECKOUT_LIMITS.maxQuantityPerLine) {
    return { ok: false, message: `Η ποσότητα είναι από 1 έως ${CHECKOUT_LIMITS.maxQuantityPerLine}.` };
  }

  const baseCents = parseItemPriceCents(item.price);
  const config = validateOptionGroups(item.optionGroups, "read");
  if (baseCents === null || !config.ok) {
    return { ok: false, message: "Το προϊόν δεν μπορεί να παραγγελθεί αυτή τη στιγμή." };
  }

  const resolved = resolveSelections(config.groups, selections);
  if (!resolved.ok) return { ok: false, message: describeSelectionProblem(resolved.problem, name) };

  if (resolved.options.length === 0) {
    return { ok: true, line: { itemId: item.id, name, unitPrice: centsToEuros(baseCents), quantity } };
  }
  return {
    ok: true,
    line: {
      itemId: item.id,
      name,
      unitPrice: centsToEuros(baseCents + resolved.extraCents),
      quantity,
      basePrice: centsToEuros(baseCents),
      options: resolved.options,
    },
  };
}

export type CartLineChange =
  | { ok: true; cart: CartState; merged: boolean }
  | { ok: false; reason: "product_limit" | "line_limit" | "not_found" };

/**
 * Προσθέτει γραμμή (ΙΔΙΟ κατάστημα — η σύγκρουση καταστημάτων λύνεται πιο
 * πάνω, στο CartContext). Ίδιο κλειδί → ενώνονται οι ποσότητες.
 */
export function addLineToCart(current: CartState, shop: CartShopRef, line: CartLine): CartLineChange {
  const lines = current.shop?.id === shop.id ? current.lines : [];
  const key = lineKeyOf(line);

  if (productQuantity(lines, line.itemId) + line.quantity > CHECKOUT_LIMITS.maxQuantityPerLine) {
    return { ok: false, reason: "product_limit" };
  }

  const existing = lines.find((entry) => lineKeyOf(entry) === key);
  if (!existing && lines.length >= CHECKOUT_LIMITS.maxLines) {
    return { ok: false, reason: "line_limit" };
  }

  const nextLines = existing
    ? lines.map((entry) =>
        entry === existing
          ? { ...line, quantity: existing.quantity + line.quantity }
          : entry,
      )
    : [...lines, line];

  return { ok: true, cart: { shop, lines: nextLines }, merged: Boolean(existing) };
}

/**
 * Επεξεργασία γραμμής (επιλογές και/ή ποσότητα).
 *
 * Αν οι ΝΕΕΣ επιλογές συμπίπτουν με ΑΛΛΗ γραμμή του καλαθιού, οι δύο γραμμές
 * ενώνονται σε μία, στη θέση της γραμμής που επεξεργάστηκε ο πελάτης, με
 * άθροισμα ποσοτήτων. Το άθροισμα δεν μπορεί να ξεπεράσει το όριο ανά
 * προϊόν, γιατί και οι δύο γραμμές είναι ήδη του ίδιου προϊόντος.
 */
export function replaceCartLine(current: CartState, oldKey: string, next: CartLine): CartLineChange {
  const index = current.lines.findIndex((line) => lineKeyOf(line) === oldKey);
  if (index === -1 || !current.shop) return { ok: false, reason: "not_found" };

  const original = current.lines[index];
  if (original.itemId !== next.itemId) return { ok: false, reason: "not_found" };

  const others = productQuantity(current.lines, next.itemId, oldKey);
  if (others + next.quantity > CHECKOUT_LIMITS.maxQuantityPerLine) {
    return { ok: false, reason: "product_limit" };
  }

  const newKey = lineKeyOf(next);
  const collision =
    newKey === oldKey ? -1 : current.lines.findIndex((line) => lineKeyOf(line) === newKey);

  if (collision === -1) {
    const lines = current.lines.map((line, position) => (position === index ? next : line));
    return { ok: true, cart: { shop: current.shop, lines }, merged: false };
  }

  const target = current.lines[collision];
  const mergedLine: CartLine = { ...next, quantity: next.quantity + target.quantity };
  const lines = current.lines
    .map((line, position) => (position === index ? mergedLine : line))
    .filter((_, position) => position !== collision);
  return { ok: true, cart: { shop: current.shop, lines }, merged: true };
}

/* ==========================================================================
 *  ΣΥΝΟΛΑ
 * ========================================================================== */

/**
 * Milestone 4: `termsOverride` = οι όροι της ζώνης ΤΚ (όταν το κατάστημα έχει
 * ζώνες). Χωρίς αυτό ισχύουν οι όροι του καταστήματος στο καλάθι, όπως πριν.
 * Το υποσύνολο περιλαμβάνει πάντα τις επιλογές (η τιμή μονάδας τις έχει ήδη).
 */
export function computeCartTotals(cart: CartState, termsOverride?: ShopTermsCents): CartTotals {
  const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalCents = cart.lines.reduce(
    (sum, line) => sum + toCents(line.unitPrice) * line.quantity,
    0,
  );

  const termsResult = termsOverride
    ? ({ ok: true, terms: termsOverride } as const)
    : cart.shop
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
    freeDeliveryOverCents: terms.freeDeliveryOverCents,
    missingForFreeDeliveryCents: totals.missingForFreeDeliveryCents,
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
    lines: cart.lines.map((line) => ({
      ...line,
      ...(line.options ? { options: line.options.map((option) => ({ ...option })) } : {}),
    })),
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

  /* Milestone 3: ανά ΓΡΑΜΜΗ (itemId + επιλογές), όχι ανά προϊόν — μια άλλη
   * παραλλαγή του ίδιου προϊόντος που προστέθηκε στο μεταξύ μένει άθικτη. */
  const submittedQuantities = new Map<string, number>();
  for (const line of submitted.lines) {
    const key = lineKeyOf(line);
    submittedQuantities.set(key, (submittedQuantities.get(key) ?? 0) + line.quantity);
  }

  const remaining = current.lines
    .map((line) => ({
      ...line,
      quantity: line.quantity - (submittedQuantities.get(lineKeyOf(line)) ?? 0),
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

  const verified = new Map(quote.lines.map((line) => [lineKeyOf(line), line]));
  /* Milestone 4: οι όροι ΖΩΝΗΣ ισχύουν μόνο για έναν ΤΚ — δεν γίνονται γενικοί
   * όροι του καταστήματος στο καλάθι (το checkout τους κρατά χωριστά). */
  const zoneTerms = quote.delivery?.mode === "zone";

  return {
    shop: zoneTerms
      ? { ...current.shop, name: quote.shopName }
      : {
          ...current.shop,
          name: quote.shopName,
          minOrder: quote.shopTerms.minOrder,
          deliveryFee: quote.shopTerms.deliveryFee,
          freeDeliveryOver: quote.shopTerms.freeDeliveryOver,
        },
    lines: current.lines.map((line) => {
      const match = verified.get(lineKeyOf(line));
      if (!match) return line;
      /* Milestone 3: και οι ετικέτες/προσαυξήσεις των επιλογών παίρνουν τις
       * εξουσιοδοτημένες τιμές (ίδια ids — μόνο κείμενα/ποσά αλλάζουν). */
      return match.options && match.options.length > 0 && match.basePrice !== undefined
        ? {
            ...line,
            name: match.name,
            unitPrice: match.unitPrice,
            basePrice: match.basePrice,
            options: match.options.map((option) => ({ ...option })),
          }
        : { ...line, name: match.name, unitPrice: match.unitPrice };
    }),
  };
}

/**
 * Μόνο ids, ποσότητες και ids επιλογών — αυτά στέλνονται στον server,
 * τίποτε άλλο. Ετικέτες και τιμές επιλογών ΔΕΝ φεύγουν ποτέ από τον browser.
 */
export function toRequestLines(lines: CartLine[]): CheckoutLineInput[] {
  return lines.map((line) => {
    const selections = line.options ? selectionsFromOptions(line.options) : [];
    return selections.length > 0
      ? { itemId: line.itemId, quantity: line.quantity, selections }
      : { itemId: line.itemId, quantity: line.quantity };
  });
}
