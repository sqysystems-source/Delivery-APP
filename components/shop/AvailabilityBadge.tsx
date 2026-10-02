"use client";

/* ==========================================================================
 *  Buka Delivery — components/shop/AvailabilityBadge.tsx   (milestone 4)
 *
 *  «Ανοιχτό» / «Κλειστό» / «Προσωρινά μη διαθέσιμο» — ίδια ετικέτα σε κάρτα
 *  καταστήματος, σελίδα καταστήματος και checkout.
 * ========================================================================== */

import { AVAILABILITY_LABELS, type AvailabilityState } from "@/lib/shop/availability";
import { cn } from "@/lib/format";

const TONES: Record<AvailabilityState, string> = {
  open: "bg-emerald-500/95 text-white",
  closed: "bg-gray-900/90 text-white",
  paused: "bg-amber-500/95 text-white",
  unavailable: "bg-amber-500/95 text-white",
};

const DOTS: Record<AvailabilityState, string> = {
  open: "bg-white",
  closed: "bg-red-400",
  paused: "bg-white",
  unavailable: "bg-white",
};

export default function AvailabilityBadge({
  state,
  className,
}: {
  state: AvailabilityState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-md backdrop-blur-sm",
        TONES[state],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[state])} aria-hidden="true" />
      {AVAILABILITY_LABELS[state]}
    </span>
  );
}
