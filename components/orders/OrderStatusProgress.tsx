/* ==========================================================================
 *  Buka Delivery — components/orders/OrderStatusProgress.tsx   (milestone 2)
 *
 *  Προσβάσιμη μπάρα προόδου: <ol> με τα βήματα του ταμπλό, aria-current="step"
 *  στο τρέχον και κρυφό κείμενο «ολοκληρώθηκε / τρέχον / επόμενο» για
 *  αναγνώστες οθόνης. Το χρώμα δεν είναι ποτέ η μόνη ένδειξη (✓, αριθμός,
 *  έντονο κείμενο). Δεν εμφανίζεται σε ακύρωση ή άγνωστη κατάσταση.
 *  Κινητό: κάθετη λίστα (οι ελληνικές ετικέτες δεν χωρούν σε 5 στήλες).
 *  Από sm και πάνω: οριζόντια μπάρα.
 * ========================================================================== */

import { Check } from "lucide-react";
import {
  ORDER_PROGRESS_STEPS,
  PROGRESS_STEP_LABELS,
  progressIndex,
  type CustomerOrderStatus,
} from "@/lib/orders/customer-order";
import { cn } from "@/lib/format";

export default function OrderStatusProgress({ status }: { status: CustomerOrderStatus }) {
  const current = progressIndex(status);
  if (current < 0) return null;

  return (
    <ol
      aria-label="Πρόοδος παραγγελίας"
      className="flex flex-col gap-2.5 sm:grid sm:grid-cols-5 sm:gap-1"
    >
      {ORDER_PROGRESS_STEPS.map((step, index) => {
        const done = index < current || (index === current && step === "completed");
        const isCurrent = index === current;
        const state = done ? "ολοκληρώθηκε" : isCurrent ? "τρέχον βήμα" : "επόμενο βήμα";

        return (
          <li
            key={step}
            aria-current={isCurrent ? "step" : undefined}
            className="relative flex min-w-0 items-center gap-3 sm:flex-col sm:gap-0 sm:text-center"
          >
            {/* Γραμμή σύνδεσης προς το προηγούμενο βήμα */}
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-1/2 top-4 hidden h-1 w-full -translate-y-1/2 rounded-full sm:block",
                  index <= current ? "bg-orange-500" : "bg-gray-200",
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black transition-colors duration-500",
                done
                  ? "bg-orange-500 text-white"
                  : isCurrent
                    ? "bg-white text-orange-600 ring-4 ring-orange-500"
                    : "bg-gray-100 text-gray-400",
              )}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm leading-tight sm:mt-2 sm:text-xs",
                isCurrent ? "font-black text-gray-900" : done ? "font-semibold text-gray-700" : "text-gray-400",
              )}
            >
              {PROGRESS_STEP_LABELS[step]}
              <span className="sr-only"> — {state}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
