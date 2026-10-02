/* ==========================================================================
 *  Buka Delivery — lib/checkout/constants.ts
 *
 *  Όρια του checkout. Τα διαβάζουν ΚΑΙ ο browser (φόρμα, καλάθι) ΚΑΙ ο
 *  server (/api/orders), ώστε ο πελάτης να μη βλέπει ποτέ «δεκτό» κάτι που
 *  θα απορρίψει ο server — ή το αντίστροφο.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type { PaymentMethod } from "@/types";

export const CHECKOUT_LIMITS = {
  /* Όρια παραγγελίας — ίδια με την προηγούμενη έκδοση του API */
  maxLines: 40,
  maxQuantityPerLine: 20,
  maxTotalItems: 100,
  maxOrderTotalCents: 50_000, // 500,00€
  /** Μόνο έλεγχος λογικής για το expectedTotalCents του αιτήματος· το όριο
   *  των 500€ εφαρμόζεται στο ΕΠΑΛΗΘΕΥΜΕΝΟ σύνολο, ώστε ο πελάτης να παίρνει
   *  `order_too_large` με σύνοψη και όχι γενικό σφάλμα επικύρωσης. */
  maxExpectedTotalCents: 10_000_000,
  maxCompatAddressLength: 200,
  maxNotesLength: 300,

  /* Στοιχεία πελάτη / παράδοσης */
  fullNameMin: 2,
  fullNameMax: 80,
  phoneRawMax: 32,
  streetMin: 3,
  streetMax: 120,
  cityMin: 2,
  cityMax: 60,
  floorMax: 20,
  doorbellMax: 40,
  instructionsMax: 200,

  /* Τεχνικά */
  idempotencyKeyMin: 16,
  idempotencyKeyMax: 64,
  documentIdMax: 128,
  shopNameMax: 200,
  itemNameMax: 120,
  /** Milestone 3: 16 KB → 64 KB, ώστε να χωρούν 40 γραμμές με επιλογές
   *  (έως 30 ids η καθεμία — δες OPTION_LIMITS στο lib/menu/options.ts). */
  maxRequestBytes: 65_536,

  /* Ταβάνια ρυθμίσεων καταστήματος/καταλόγου (σε ευρώ) */
  maxItemPrice: 999,
  maxMinOrder: 500,
  maxDeliveryFee: 100,
  maxFreeDeliveryOver: 1_000,
} as const;

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash_on_delivery"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_on_delivery: "Μετρητά κατά την παράδοση",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}
