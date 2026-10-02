/* ==========================================================================
 *  Buka Delivery — lib/orders/customer-order.ts   (milestone 2)
 *
 *  Μετατροπή εγγράφου `orders/{id}` σε ό,τι βλέπει ο ΠΕΛΑΤΗΣ στη σελίδα
 *  παρακολούθησης και στο ιστορικό, μαζί με τα ελληνικά κείμενα κατάστασης.
 *
 *  Αρχές:
 *    • Χρησιμοποιούνται ΜΟΝΟ οι υπάρχουσες τιμές status του ταμπλό:
 *        pending → accepted → preparing → delivering → completed
 *        (και cancelled από οποιοδήποτε μη τελικό σημείο)
 *    • Ποτέ «έγινε δεκτή» πριν το accepted. Ποτέ «πληρώθηκε»: η πληρωμή
 *      είναι μετρητά στην παράδοση και το σύστημα δεν την καταγράφει.
 *    • Καμία εκτίμηση χρόνου ή θέση διανομέα — το `etaMinutes` της
 *      παραγγελίας είναι το γενικό εύρος του καταστήματος, όχι εκτίμηση.
 *    • Ανθεκτικό σε παλαιότερες παραγγελίες (χωρίς customer/delivery/
 *      paymentMethod/*Cents) και σε άγνωστες τιμές status.
 *    • Τα στοιχεία επικοινωνίας (όνομα/τηλέφωνο) ΔΕΝ περνούν στο view model:
 *      η σελίδα δεν τα χρειάζεται.
 *
 *  Καθαρό module (χωρίς Firebase/React), ώστε να δοκιμάζεται απομονωμένα.
 * ========================================================================== */

import type {
  OrderLineOption,
  CheckoutDelivery,
  DeliveryTermsSnapshot,
  OrderCancelReason,
  OrderStatus,
  PaymentMethod,
} from "@/types";
import { isPaymentMethod } from "@/lib/checkout/constants";
import { centsToEuros } from "@/lib/checkout/money";
import { readOptionSnapshotForDisplay } from "@/lib/menu/options";
import { readDeliveryTermsSnapshot } from "@/lib/shop/delivery-zones";
import { normalizePostalCode } from "@/lib/shop/postal-code";

/* --------------------------------------------------------------------------
 *  Τύποι
 * -------------------------------------------------------------------------- */

/** `unknown` = τιμή που δεν αναγνωρίζουμε — ΔΕΝ μαντεύουμε κατάσταση */
export type CustomerOrderStatus = OrderStatus | "unknown";

export type CustomerOrderLine = {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Milestone 3: στιγμιότυπο επιλογών (κενό σε γραμμές χωρίς επιλογές / παλιές παραγγελίες) */
  options: OrderLineOption[];
};

export type CustomerOrder = {
  id: string;
  code: string;
  userId: string;
  shopId: string;
  shopName: string;
  status: CustomerOrderStatus;
  cancelReason: OrderCancelReason | null;
  lines: CustomerOrderLine[];
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** null σε παλαιότερες παραγγελίες χωρίς καταγεγραμμένο τρόπο πληρωμής */
  paymentMethod: PaymentMethod | null;
  /** null σε παλαιότερες παραγγελίες — τότε χρησιμοποιείται το `address` */
  delivery: CheckoutDelivery | null;
  /** Milestone 4: ζώνη/ΤΚ/όροι παράδοσης της ΠΑΡΑΓΓΕΛΙΑΣ — null σε παλαιότερες */
  deliveryTerms: DeliveryTermsSnapshot | null;
  address: string;
  notes: string | null;
  /** Ώρα του SERVER (serverTimestamp του Admin SDK) */
  createdAt: Date | null;
  updatedAt: Date | null;
};

/* --------------------------------------------------------------------------
 *  Κατάσταση → κείμενα για τον πελάτη
 * -------------------------------------------------------------------------- */

export const ORDER_PROGRESS_STEPS: readonly OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "delivering",
  "completed",
];

/** Σύντομη ετικέτα κάθε βήματος της μπάρας προόδου */
export const PROGRESS_STEP_LABELS: Record<OrderStatus, string> = {
  pending: "Στάλθηκε",
  accepted: "Αποδεκτή",
  preparing: "Ετοιμάζεται",
  delivering: "Σε παράδοση",
  completed: "Ολοκληρώθηκε",
  cancelled: "Ακυρώθηκε",
};

export type StatusTone = "waiting" | "progress" | "done" | "stopped" | "unknown";

export type StatusCopy = {
  /** Η κατάσταση με μία φράση, π.χ. «Σε αναμονή αποδοχής» */
  label: string;
  /** Τι σημαίνει για τον πελάτη — χωρίς υποσχέσεις χρόνου */
  description: string;
  tone: StatusTone;
};

const STATUS_COPY: Record<CustomerOrderStatus, StatusCopy> = {
  pending: {
    label: "Σε αναμονή αποδοχής",
    description:
      "Η παραγγελία στάλθηκε στο κατάστημα. Δεν την έχει αποδεχτεί ακόμη — θα ενημερωθείς εδώ μόλις το κάνει.",
    tone: "waiting",
  },
  accepted: {
    label: "Έγινε δεκτή",
    description: "Το κατάστημα αποδέχτηκε την παραγγελία σου.",
    tone: "progress",
  },
  preparing: {
    label: "Ετοιμάζεται",
    description: "Το κατάστημα ετοιμάζει την παραγγελία σου.",
    tone: "progress",
  },
  delivering: {
    label: "Σε παράδοση",
    description: "Το κατάστημα σημείωσε ότι η παραγγελία ξεκίνησε για παράδοση.",
    tone: "progress",
  },
  completed: {
    label: "Ολοκληρώθηκε",
    description: "Το κατάστημα σημείωσε την παραγγελία ως ολοκληρωμένη.",
    tone: "done",
  },
  cancelled: {
    label: "Ακυρώθηκε",
    description: "Η παραγγελία ακυρώθηκε από το κατάστημα και δεν θα εκτελεστεί.",
    tone: "stopped",
  },
  unknown: {
    label: "Άγνωστη κατάσταση",
    description:
      "Δεν μπορούμε να εμφανίσουμε την κατάσταση αυτής της παραγγελίας. Για λεπτομέρειες επικοινώνησε με το κατάστημα.",
    tone: "unknown",
  },
};

export function describeOrderStatus(
  status: CustomerOrderStatus,
  cancelReason: OrderCancelReason | null = null,
): StatusCopy {
  if (status === "cancelled") {
    if (cancelReason === "rejected_by_shop") {
      return {
        label: "Δεν έγινε δεκτή",
        description: "Το κατάστημα δεν αποδέχτηκε την παραγγελία σου και δεν θα εκτελεστεί.",
        tone: "stopped",
      };
    }
    if (cancelReason === "cancelled_by_shop") {
      return {
        label: "Ακυρώθηκε",
        description:
          "Το κατάστημα ακύρωσε την παραγγελία αφού την είχε αποδεχτεί. Δεν θα εκτελεστεί.",
        tone: "stopped",
      };
    }
  }
  return STATUS_COPY[status];
}

/** Θέση στη μπάρα προόδου· -1 όταν η πρόοδος δεν εφαρμόζεται (ακύρωση/άγνωστο) */
export function progressIndex(status: CustomerOrderStatus): number {
  return status === "cancelled" || status === "unknown"
    ? -1
    : ORDER_PROGRESS_STEPS.indexOf(status);
}

export function isTerminalStatus(status: CustomerOrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/* --------------------------------------------------------------------------
 *  Μετατροπή εγγράφου
 * -------------------------------------------------------------------------- */

const KNOWN_STATUSES: readonly OrderStatus[] = [...ORDER_PROGRESS_STEPS, "cancelled"];

export function orderCodeFromId(orderId: string): string {
  return `BK-${orderId.slice(0, 6).toUpperCase()}`;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Προτιμά τα ακριβή λεπτά (schemaVersion 2+), αλλιώς τα ευρώ */
function money(cents: unknown, euros: unknown): number {
  return typeof cents === "number" && Number.isSafeInteger(cents) && cents >= 0
    ? centsToEuros(cents)
    : toNumber(euros);
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

function toLines(value: unknown): CustomerOrderLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const line = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const quantity = toNumber(line.quantity);
    const unitPrice = money(line.unitPriceCents, line.unitPrice);
    const lineTotal =
      line.lineTotalCents !== undefined || line.lineTotal !== undefined
        ? money(line.lineTotalCents, line.lineTotal)
        : unitPrice * quantity;
    return {
      itemId: typeof line.itemId === "string" && line.itemId ? line.itemId : `line-${index}`,
      name: toText(line.name) || "Προϊόν",
      quantity,
      unitPrice,
      lineTotal,
      options: readOptionSnapshotForDisplay(line.options),
    };
  });
}

function toDelivery(value: unknown): CheckoutDelivery | null {
  if (typeof value !== "object" || value === null) return null;
  const delivery = value as Record<string, unknown>;
  const street = toText(delivery.street);
  if (!street) return null;
  const city = toText(delivery.city);
  const floor = toText(delivery.floor);
  const doorbell = toText(delivery.doorbell);
  const instructions = toText(delivery.instructions);
  const postalCode = normalizePostalCode(delivery.postalCode);
  return {
    street,
    city,
    ...(postalCode ? { postalCode } : {}),
    ...(floor ? { floor } : {}),
    ...(doorbell ? { doorbell } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function toCancelReason(value: unknown): OrderCancelReason | null {
  return value === "rejected_by_shop" || value === "cancelled_by_shop" ? value : null;
}

export function mapCustomerOrder(id: string, data: Record<string, unknown>): CustomerOrder {
  const status: CustomerOrderStatus = KNOWN_STATUSES.includes(data.status as OrderStatus)
    ? (data.status as OrderStatus)
    : "unknown";
  const delivery = toDelivery(data.delivery);
  const lines = toLines(data.lines);
  const notes = toText(data.notes);

  return {
    id,
    code: orderCodeFromId(id),
    userId: typeof data.userId === "string" ? data.userId : "",
    shopId: typeof data.shopId === "string" ? data.shopId : "",
    shopName: toText(data.shopName) || "Κατάστημα",
    status,
    cancelReason: status === "cancelled" ? toCancelReason(data.cancelReason) : null,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: money(data.subtotalCents, data.subtotal),
    deliveryFee: money(data.deliveryFeeCents, data.deliveryFee),
    total: money(data.totalCents, data.total),
    paymentMethod: isPaymentMethod(data.paymentMethod) ? data.paymentMethod : null,
    delivery,
    deliveryTerms: readDeliveryTermsSnapshot(data.deliveryTerms),
    address:
      toText(data.address) ||
      (delivery ? [delivery.street, delivery.city].filter(Boolean).join(", ") : ""),
    notes: notes || null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

/** «2 Οκτ 2026, 14:05» — ώρα Ελλάδας */
export function formatOrderDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("el-GR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });
}
