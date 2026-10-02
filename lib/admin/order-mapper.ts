/* ==========================================================================
 *  Buka Delivery — lib/admin/order-mapper.ts
 *
 *  Μετατροπή εγγράφου `orders/{id}` σε AdminOrder για το ταμπλό.
 *
 *  Ανθεκτικό σε ΚΑΘΕ ηλικία παραγγελίας:
 *    • schemaVersion 2+: δομημένα customer / delivery / paymentMethod
 *    • παλαιότερες: μόνο το συμβατό `address` — τα νέα πεδία γίνονται null
 *      και το UI δείχνει κατάλληλο fallback. Καμία μετάπτωση δεν χρειάζεται.
 *
 *  Καθαρό module (χωρίς Firebase), ώστε να δοκιμάζεται απομονωμένα.
 * ========================================================================== */

import type {
  OrderLineOption,
  CheckoutCustomer,
  CheckoutDelivery,
  OrderCancelReason,
  OrderStatus,
  PaymentMethod,
} from "@/types";
import { isPaymentMethod } from "@/lib/checkout/constants";
import { centsToEuros } from "@/lib/checkout/money";
import { readOptionSnapshotForDisplay } from "@/lib/menu/options";

export type AdminOrderLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /**
   * Milestone 3: τι διάλεξε ο πελάτης, ΟΠΩΣ αποθηκεύτηκε στην παραγγελία
   * (όχι ο σημερινός κατάλογος). Κενό σε γραμμές χωρίς επιλογές.
   */
  options: OrderLineOption[];
  /** Βασική τιμή χωρίς επιλογές — null όταν δεν καταγράφηκε */
  basePrice: number | null;
};

export type AdminOrder = {
  id: string;
  /** Ο κωδικός που βλέπει ο πελάτης, π.χ. «BK-7F3A21» */
  code: string;
  shopId: string;
  shopName: string;
  /** Συμβατή διεύθυνση μίας γραμμής — υπάρχει σε όλες τις παραγγελίες */
  address: string;
  lines: AdminOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  userId: string;
  notes?: string;
  /** null όσο το serverTimestamp δεν έχει επιβεβαιωθεί από τον server */
  createdAt: Date | null;
  /** null σε παλαιότερες παραγγελίες */
  customer: CheckoutCustomer | null;
  /** null σε παλαιότερες παραγγελίες */
  delivery: CheckoutDelivery | null;
  /** null σε παλαιότερες παραγγελίες */
  paymentMethod: PaymentMethod | null;
  /** true όταν η παραγγελία δεν έχει δομημένα στοιχεία πελάτη/παράδοσης */
  isLegacy: boolean;
};

const VALID_STATUSES: readonly OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "delivering",
  "completed",
  "cancelled",
];

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toLines(value: unknown): AdminOrderLine[] {
  if (!Array.isArray(value)) return [];

  return value.map((entry) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const unitPrice = toNumber(line.unitPrice);
    const quantity = toNumber(line.quantity);

    const options = readOptionSnapshotForDisplay(line.options);
    const basePrice =
      typeof line.basePriceCents === "number" && Number.isSafeInteger(line.basePriceCents)
        ? centsToEuros(line.basePriceCents)
        : typeof line.basePrice === "number" && Number.isFinite(line.basePrice)
          ? line.basePrice
          : null;

    return {
      itemId: typeof line.itemId === "string" ? line.itemId : "",
      name: toText(line.name) || "Προϊόν",
      unitPrice,
      quantity,
      lineTotal: line.lineTotal !== undefined ? toNumber(line.lineTotal) : unitPrice * quantity,
      options,
      basePrice: options.length > 0 ? basePrice : null,
    };
  });
}

function toStatus(value: unknown): OrderStatus {
  return VALID_STATUSES.includes(value as OrderStatus) ? (value as OrderStatus) : "pending";
}

function toCustomer(value: unknown): CheckoutCustomer | null {
  if (typeof value !== "object" || value === null) return null;
  const customer = value as Record<string, unknown>;
  const fullName = toText(customer.fullName);
  const phone = toText(customer.phone);
  return fullName || phone ? { fullName, phone } : null;
}

function toDelivery(value: unknown): CheckoutDelivery | null {
  if (typeof value !== "object" || value === null) return null;
  const delivery = value as Record<string, unknown>;
  const street = toText(delivery.street);
  const city = toText(delivery.city);
  if (!street) return null;

  const floor = toText(delivery.floor);
  const doorbell = toText(delivery.doorbell);
  const instructions = toText(delivery.instructions);

  return {
    street,
    city,
    ...(floor ? { floor } : {}),
    ...(doorbell ? { doorbell } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { toDate?: unknown };
  if (typeof candidate.toDate !== "function") return null;
  try {
    const date = (candidate.toDate as () => unknown).call(value);
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

export function mapAdminOrder(id: string, data: Record<string, unknown>): AdminOrder {
  const customer = toCustomer(data.customer);
  const delivery = toDelivery(data.delivery);
  const address =
    toText(data.address) ||
    (delivery ? [delivery.street, delivery.city].filter(Boolean).join(", ") : "");
  const notes = toText(data.notes);

  return {
    id,
    code: `BK-${id.slice(0, 6).toUpperCase()}`,
    shopId: typeof data.shopId === "string" ? data.shopId : "",
    shopName: toText(data.shopName),
    address,
    lines: toLines(data.lines),
    subtotal: toNumber(data.subtotal),
    deliveryFee: toNumber(data.deliveryFee),
    total: toNumber(data.total),
    status: toStatus(data.status),
    userId: typeof data.userId === "string" ? data.userId : "",
    ...(notes ? { notes } : {}),
    createdAt: toDate(data.createdAt),
    customer,
    delivery,
    paymentMethod: isPaymentMethod(data.paymentMethod) ? data.paymentMethod : null,
    isLegacy: customer === null && delivery === null,
  };
}

/**
 * Milestone 2: ο λόγος ακύρωσης που γράφει το ταμπλό μαζί με "cancelled".
 * Ακύρωση ΠΡΙΝ την αποδοχή = απόρριψη. Το ίδιο ελέγχουν και τα rules.
 */
export function cancelReasonForStatus(currentStatus: OrderStatus): OrderCancelReason {
  return currentStatus === "pending" ? "rejected_by_shop" : "cancelled_by_shop";
}
