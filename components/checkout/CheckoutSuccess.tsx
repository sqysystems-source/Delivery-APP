"use client";

/* ==========================================================================
 *  Buka Delivery — components/checkout/CheckoutSuccess.tsx
 *
 *  Οθόνη επιτυχίας. Όλα τα στοιχεία —γραμμές, ποσά, κωδικός, διεύθυνση—
 *  έρχονται από την ΕΠΑΛΗΘΕΥΜΕΝΗ απάντηση του server, όχι από το καλάθι (που
 *  στο μεταξύ έχει αδειάσει ή μπορεί να έχει νέα προϊόντα).
 *
 *  Το μήνυμα είναι σκόπιμα ακριβές: η παραγγελία ΣΤΑΛΘΗΚΕ και ΠΕΡΙΜΕΝΕΙ
 *  αποδοχή από το κατάστημα. Δεν λέμε ότι έγινε δεκτή, ούτε ότι πληρώθηκε.
 *
 *  Milestone 2:
 *   • «Παρακολούθηση παραγγελίας» → /orders/{orderId} με το orderId του
 *     SERVER. Η οθόνη μένει μέχρι ο πελάτης να επιλέξει πού θα πάει.
 *   • `recovered`: η παραγγελία βρέθηκε μέσω ανάκτησης (π.χ. μετά από
 *     ανανέωση). Η κατάσταση μπορεί να έχει ήδη αλλάξει, οπότε ΔΕΝ δείχνουμε
 *     το στατικό «Σε αναμονή αποδοχής» — παραπέμπουμε στην παρακολούθηση.
 * ========================================================================== */

import type { RefObject } from "react";
import Link from "next/link";
import { Banknote, Clock3, MapPin, PartyPopper, Radio, Receipt } from "lucide-react";
import type { CheckoutSuccess as CheckoutSuccessResult } from "@/types";
import { PAYMENT_METHOD_LABELS } from "@/lib/checkout/constants";
import { formatDeliveryFee, formatPrice } from "@/lib/format";

type CheckoutSuccessProps = {
  result: CheckoutSuccessResult;
  /** Βρέθηκε μέσω ανάκτησης προσπάθειας, όχι από την απάντηση αυτής της αποστολής */
  recovered?: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onContinue: () => void;
};

export default function CheckoutSuccess({
  result,
  recovered = false,
  headingRef,
  onContinue,
}: CheckoutSuccessProps) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5">
        <div className="bg-gradient-to-br from-orange-500 to-red-500 px-6 py-8 text-center text-white">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white/20">
            <PartyPopper className="h-8 w-8" aria-hidden="true" />
          </span>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 text-2xl font-black tracking-tight outline-none sm:text-3xl"
          >
            {recovered ? "Η παραγγελία σου είχε καταχωρηθεί" : "Η παραγγελία στάλθηκε!"}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-orange-50">
            {recovered
              ? `Η προηγούμενη αποστολή σου προς «${result.shopName}» είχε καταχωρηθεί κανονικά — δεν στάλθηκε δεύτερη παραγγελία. Δες την τρέχουσα κατάστασή της στην παρακολούθηση.`
              : `Το κατάστημα «${result.shopName}» θα την επιβεβαιώσει σύντομα. Μέχρι τότε η παραγγελία βρίσκεται σε αναμονή αποδοχής.`}
          </p>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full bg-gray-100 px-4 py-2 font-mono text-sm font-black tracking-wider text-gray-800">
              Κωδικός: {result.code}
            </span>
            {!recovered && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                Σε αναμονή αποδοχής
              </span>
            )}
          </div>

          <section aria-labelledby="success-items-heading">
            <h2
              id="success-items-heading"
              className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-500"
            >
              <Receipt className="h-4 w-4" aria-hidden="true" />
              Τι παρήγγειλες
            </h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {result.lines.map((line) => (
                <li key={line.itemId} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="text-sm text-gray-800">
                    <span className="font-bold">{line.quantity}×</span> {line.name}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-gray-900">
                    {formatPrice(line.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1.5 border-t border-dashed border-gray-200 pt-3 text-sm">
              <div className="flex justify-between text-gray-600">
                <dt>Υποσύνολο</dt>
                <dd className="font-semibold text-gray-900">{formatPrice(result.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-gray-600">
                <dt>Μεταφορικά</dt>
                <dd className="font-semibold text-gray-900">
                  {formatDeliveryFee(result.deliveryFee)}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-1 text-base">
                <dt className="font-black text-gray-900">Σύνολο</dt>
                <dd className="text-xl font-black text-gray-900">{formatPrice(result.total)}</dd>
              </div>
            </dl>
          </section>

          <div className="space-y-2 rounded-2xl bg-gray-50 p-4 text-sm">
            <p className="flex items-start gap-2 text-gray-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
              <span>
                Παράδοση σε: <span className="font-semibold text-gray-900">{result.address}</span>
              </span>
            </p>
            <p className="flex items-start gap-2 text-gray-700">
              <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {recovered ? (
                /* Η κατάσταση μπορεί να έχει αλλάξει (π.χ. ακύρωση) — όχι «θα πληρώσεις» */
                <span>
                  {PAYMENT_METHOD_LABELS[result.paymentMethod]} — σύνολο{" "}
                  <span className="font-semibold text-gray-900">{formatPrice(result.total)}</span>.
                </span>
              ) : (
                <span>
                  {PAYMENT_METHOD_LABELS[result.paymentMethod]} — θα πληρώσεις{" "}
                  <span className="font-semibold text-gray-900">{formatPrice(result.total)}</span>{" "}
                  όταν παραλάβεις την παραγγελία.
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/orders/${encodeURIComponent(result.orderId)}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
              Παρακολούθηση παραγγελίας
            </Link>
            <button
              type="button"
              onClick={onContinue}
              className="flex-1 rounded-full bg-gray-900 px-6 py-4 text-sm font-bold text-white transition-all duration-300 hover:scale-[1.02] hover:bg-orange-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
            >
              Συνέχεια
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
