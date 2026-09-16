/* ==========================================================================
 *  Buka Delivery — lib/format.ts
 *
 *  Μικρά helpers μορφοποίησης, κοινά για όλα τα components.
 *  Ελληνική σύμβαση: κόμμα ως υποδιαστολή, σύμβολο ευρώ στο τέλος.
 * ========================================================================== */

import type { TagTone } from "@/types";

/** 3.9 → «3,90€» */
export function formatPrice(value: number): string {
  return `${value.toFixed(2).replace(".", ",")}€`;
}

/** 4.8 → «4,8» */
export function formatRating(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/** [25, 35] → «25-35'» */
export function formatEta(eta: [number, number]): string {
  return `${eta[0]}-${eta[1]}'`;
}

/** 1240 → «1.240» */
export function formatCount(value: number): string {
  return value.toLocaleString("el-GR");
}

/** Μεταφορικά: 0 → «Δωρεάν», αλλιώς η τιμή */
export function formatDeliveryFee(fee: number): string {
  return fee === 0 ? "Δωρεάν" : formatPrice(fee);
}

/** Tailwind classes για τα badges των καταστημάτων */
export const TAG_TONES: Record<TagTone, string> = {
  green: "bg-emerald-500/95 text-white",
  orange: "bg-orange-500/95 text-white",
  purple: "bg-violet-600/95 text-white",
};

/**
 * Συνένωση Tailwind classes με παράλειψη των κενών/ψευδών τιμών.
 * Παράδειγμα: cn("p-4", isActive && "bg-orange-500")
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
