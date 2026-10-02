/* ==========================================================================
 *  Buka Delivery — lib/admin/receipt.ts
 *
 *  Κείμενο απόδειξης για θερμικό εκτυπωτή 58mm (32 χαρακτήρες ανά γραμμή).
 *
 *  Περιλαμβάνει στοιχεία πελάτη, παράδοσης και τρόπο πληρωμής. Για
 *  παλαιότερες παραγγελίες χωρίς αυτά τα πεδία, τυπώνει τη συμβατή διεύθυνση
 *  και σημειώνει ότι τα υπόλοιπα δεν καταγράφηκαν.
 *
 *  Εδώ ΜΟΝΟ φτιάχνεται το κείμενο. Η αποστολή σε εκτυπωτή (ESC/POS) δεν
 *  ανήκει σε αυτό το milestone.
 * ========================================================================== */

import type { AdminOrder } from "@/lib/admin/order-mapper";
import { PAYMENT_METHOD_LABELS } from "@/lib/checkout/constants";
import { formatPhoneForDisplay } from "@/lib/checkout/phone";
import { formatPrice } from "@/lib/format";
import { formatOptionLines } from "@/lib/menu/options";

export const RECEIPT_WIDTH = 32;
const PRICE_COLUMN = 8;
const SEPARATOR = "-".repeat(RECEIPT_WIDTH);

/** Σπάει κείμενο σε γραμμές έως `width` χαρακτήρων (και πολύ μεγάλες λέξεις) */
export function wrapText(text: string, width: number = RECEIPT_WIDTH): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (let word of words) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;

    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function labelled(label: string, value: string): string[] {
  return wrapText(`${label}: ${value}`);
}

function amountRow(label: string, amount: number): string {
  return label.padEnd(RECEIPT_WIDTH - PRICE_COLUMN, " ") + formatPrice(amount).padStart(PRICE_COLUMN, " ");
}

export function formatClockTime(date: Date | null): string {
  if (!date) return "--:--";
  return date.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
}

export function buildReceiptText(order: AdminOrder): string {
  const out: string[] = [];

  out.push("BUKA DELIVERY".padStart(Math.floor((RECEIPT_WIDTH + 13) / 2), " "));
  if (order.shopName) out.push(...wrapText(order.shopName));
  out.push(SEPARATOR);
  out.push(`Κωδικός: ${order.code}`);
  out.push(`Ώρα: ${formatClockTime(order.createdAt)}`);
  out.push(SEPARATOR);

  /* ------------------------------- Πελάτης ------------------------------ */
  out.push("ΠΕΛΑΤΗΣ");
  if (order.customer) {
    if (order.customer.fullName) out.push(...wrapText(order.customer.fullName));
    if (order.customer.phone) out.push(`Τηλ.: ${formatPhoneForDisplay(order.customer.phone)}`);
  } else {
    out.push("Δεν καταγράφηκαν στοιχεία");
  }
  out.push(SEPARATOR);

  /* ------------------------------ Παράδοση ------------------------------ */
  out.push("ΠΑΡΑΔΟΣΗ");
  if (order.delivery) {
    out.push(...wrapText(order.delivery.street));
    if (order.delivery.city) out.push(...wrapText(order.delivery.city));
    if (order.delivery.floor) out.push(...labelled("Όροφος", order.delivery.floor));
    if (order.delivery.doorbell) out.push(...labelled("Κουδούνι", order.delivery.doorbell));
    if (order.delivery.instructions) {
      out.push(...labelled("Οδηγίες", order.delivery.instructions));
    }
  } else {
    out.push(...wrapText(order.address || "—"));
  }
  out.push(SEPARATOR);

  /* ------------------------------- Γραμμές ------------------------------ */
  for (const line of order.lines) {
    const nameWidth = RECEIPT_WIDTH - PRICE_COLUMN;
    const wrapped = wrapText(`${line.quantity}x ${line.name}`, nameWidth);
    wrapped.forEach((text, index) => {
      out.push(
        index === 0
          ? text.padEnd(nameWidth, " ") + formatPrice(line.lineTotal).padStart(PRICE_COLUMN, " ")
          : `   ${text}`,
      );
    });
    /* Milestone 3: επιλογές από το ΣΤΙΓΜΙΟΤΥΠΟ της παραγγελίας, με εσοχή */
    for (const optionLine of formatOptionLines(line.options ?? [])) {
      for (const text of wrapText(optionLine, RECEIPT_WIDTH - 3)) out.push(`   ${text}`);
    }
  }
  out.push(SEPARATOR);

  out.push(amountRow("Υποσύνολο:", order.subtotal));
  out.push(amountRow("Μεταφορικά:", order.deliveryFee));
  out.push(amountRow("ΣΥΝΟΛΟ:", order.total));
  out.push(SEPARATOR);

  /* ------------------------------- Πληρωμή ------------------------------ */
  if (order.paymentMethod) {
    out.push(...labelled("Πληρωμή", PAYMENT_METHOD_LABELS[order.paymentMethod]));
    if (order.paymentMethod === "cash_on_delivery") out.push(amountRow("Είσπραξη:", order.total));
  } else {
    out.push("Πληρωμή: δεν καταγράφηκε");
  }

  if (order.notes) {
    out.push(SEPARATOR);
    out.push(...labelled("Σχόλιο", order.notes));
  }

  out.push("");
  out.push("Ευχαριστούμε!".padStart(Math.floor((RECEIPT_WIDTH + 13) / 2), " "));

  return out.join("\n");
}
