"use client";

/* ==========================================================================
 *  Buka Delivery — components/checkout/CheckoutSummary.tsx
 *
 *  Σύνοψη παραγγελίας στο checkout: κατάστημα, επεξεργάσιμες γραμμές,
 *  σύνολα, οδηγίες για ελάχιστη παραγγελία / δωρεάν μεταφορικά και —όταν ο
 *  server βρει άλλες τιμές— η ειδοποίηση αλλαγής που ζητά νέα επιβεβαίωση.
 * ========================================================================== */

import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import { AlertTriangle, Info, Minus, Plus, Store, Trash2 } from "lucide-react";
import type { CartState, CartTotals } from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { centsToEuros, toCents } from "@/lib/checkout/money";
import { cn, formatDeliveryFee, formatPrice } from "@/lib/format";

export type PriceChangeNotice = {
  previousTotalCents: number;
  newTotalCents: number;
  changes: Array<{ itemId: string; name: string; before: number; after: number }>;
  delivery: { before: number; after: number } | null;
};

type CheckoutSummaryProps = {
  cart: CartState;
  totals: CartTotals;
  /** Κλειδωμένο όσο στέλνεται η παραγγελία */
  locked: boolean;
  onIncrease: (itemId: string) => void;
  onDecrease: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  linesError?: string;
  priceNotice: PriceChangeNotice | null;
  priceNoticeRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

export default function CheckoutSummary({
  cart,
  totals,
  locked,
  onIncrease,
  onDecrease,
  onRemove,
  linesError,
  priceNotice,
  priceNoticeRef,
  children,
}: CheckoutSummaryProps) {
  const shop = cart.shop;

  const freeOver = shop?.freeDeliveryOver ?? null;
  const missingForFreeDelivery =
    freeOver !== null && totals.deliveryFeeCents > 0
      ? centsToEuros(toCents(freeOver) - totals.subtotalCents)
      : null;

  return (
    <section
      id="checkout-summary"
      aria-labelledby="checkout-summary-heading"
      className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5"
    >
      {/* ------------------------------ Κατάστημα ---------------------------- */}
      <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h2
            id="checkout-summary-heading"
            className="text-lg font-extrabold tracking-tight text-gray-900"
          >
            Η παραγγελία σου
          </h2>
          {shop && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-gray-600">
              <Store className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
              {shop.name}
            </p>
          )}
        </div>
        {shop && (
          <Link
            href={`/shop/${shop.id}`}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-50"
          >
            Προσθήκη προϊόντων
          </Link>
        )}
      </header>

      {/* ------------------------------- Γραμμές ----------------------------- */}
      <ul className="divide-y divide-gray-100 px-5" aria-label="Προϊόντα παραγγελίας">
        {cart.lines.map((line) => (
          <li key={line.itemId} className="flex items-start gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900">{line.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">{formatPrice(line.unitPrice)} / τεμ.</p>

              <div className="mt-2 flex w-fit items-center gap-1 rounded-full border border-gray-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => onDecrease(line.itemId)}
                  disabled={locked}
                  aria-label={`Μείωση ποσότητας για ${line.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span
                  className="min-w-6 text-center text-sm font-black text-gray-900"
                  aria-label={`Ποσότητα: ${line.quantity}`}
                >
                  {line.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onIncrease(line.itemId)}
                  disabled={locked || line.quantity >= CHECKOUT_LIMITS.maxQuantityPerLine}
                  aria-label={`Αύξηση ποσότητας για ${line.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className="text-sm font-black text-gray-900">
                {formatPrice(centsToEuros(toCents(line.unitPrice) * line.quantity))}
              </span>
              <button
                type="button"
                onClick={() => onRemove(line.itemId)}
                disabled={locked}
                aria-label={`Αφαίρεση ${line.name} από την παραγγελία`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {linesError && (
        <p
          id="checkout-lines-error"
          className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {linesError}
        </p>
      )}

      <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-5 py-4">
        {/* ----------------------- Αλλαγή τιμών από τον server ---------------- */}
        {priceNotice && (
          <div
            ref={priceNoticeRef}
            tabIndex={-1}
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <p className="flex items-center gap-2 font-black">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              Οι τιμές άλλαξαν
            </p>
            <p className="mt-1.5 leading-relaxed">
              Το κατάστημα ενημέρωσε τιμές ή μεταφορικά. Νέο σύνολο:{" "}
              <strong>{formatPrice(centsToEuros(priceNotice.newTotalCents))}</strong> (αντί για{" "}
              {formatPrice(centsToEuros(priceNotice.previousTotalCents))}). Δεν στάλθηκε καμία
              παραγγελία — έλεγξε τη σύνοψη και επιβεβαίωσε ξανά.
            </p>
            {(priceNotice.changes.length > 0 || priceNotice.delivery) && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {priceNotice.changes.map((change) => (
                  <li key={change.itemId}>
                    {change.name}: {formatPrice(change.before)} → {formatPrice(change.after)}
                  </li>
                ))}
                {priceNotice.delivery && (
                  <li>
                    Μεταφορικά: {formatDeliveryFee(priceNotice.delivery.before)} →{" "}
                    {formatDeliveryFee(priceNotice.delivery.after)}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* --------------------------------- Σύνολα --------------------------- */}
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between text-gray-600">
            <dt>Υποσύνολο</dt>
            <dd className="font-semibold text-gray-900">{formatPrice(totals.subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between text-gray-600">
            <dt>Μεταφορικά</dt>
            <dd
              className={cn(
                "font-semibold",
                totals.deliveryFee === 0 ? "text-emerald-600" : "text-gray-900",
              )}
            >
              {formatDeliveryFee(totals.deliveryFee)}
            </dd>
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-2.5 text-base">
            <dt className="font-bold text-gray-900">Σύνολο</dt>
            <dd className="text-xl font-black text-gray-900">{formatPrice(totals.total)}</dd>
          </div>
        </dl>

        {missingForFreeDelivery !== null && missingForFreeDelivery > 0 && (
          <p className="flex items-start gap-2 text-xs text-gray-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            Πρόσθεσε ακόμη {formatPrice(missingForFreeDelivery)} για δωρεάν μεταφορικά.
          </p>
        )}

        {totals.missingForMinOrderCents > 0 && shop && (
          <div
            id="checkout-min-order"
            className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Η ελάχιστη παραγγελία είναι {formatPrice(totals.minOrder)}. Πρόσθεσε ακόμη{" "}
                {formatPrice(totals.missingForMinOrder)} για να συνεχίσεις.
              </span>
            </p>
            <Link
              href={`/shop/${shop.id}`}
              className="mt-2 inline-block font-bold text-orange-700 underline-offset-2 hover:underline"
            >
              Πίσω στον κατάλογο
            </Link>
          </div>
        )}

        {totals.exceedsMaxOrder && (
          <p
            id="checkout-max-order"
            className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Το ανώτατο ποσό online παραγγελίας είναι{" "}
              {formatPrice(centsToEuros(CHECKOUT_LIMITS.maxOrderTotalCents))}. Μείωσε τις ποσότητες για
              να συνεχίσεις.
            </span>
          </p>
        )}

        {children}
      </div>
    </section>
  );
}
