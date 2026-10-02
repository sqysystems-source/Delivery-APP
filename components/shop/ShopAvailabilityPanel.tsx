"use client";

/* ==========================================================================
 *  Buka Delivery — components/shop/ShopAvailabilityPanel.tsx   (milestone 4)
 *
 *  Στη σελίδα καταστήματος: κατάσταση (ανοιχτό/κλειστό/μη διαθέσιμο), πότε
 *  ανοίγει ή κλείνει, εβδομαδιαίο ωράριο και επερχόμενες εξαιρέσεις.
 *
 *  Ο πελάτης ΜΠΟΡΕΙ να δει τον κατάλογο και να γεμίσει καλάθι όταν το
 *  κατάστημα είναι κλειστό· η νέα παραγγελία μπλοκάρεται στο checkout (και,
 *  οριστικά, στον server).
 * ========================================================================== */

import { CalendarClock, Clock } from "lucide-react";
import AvailabilityBadge from "@/components/shop/AvailabilityBadge";
import { describeAvailability, type ShopAvailability } from "@/lib/shop/availability";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  formatExceptionDate,
  formatIntervals,
  upcomingExceptions,
} from "@/lib/shop/opening-hours";
import { wallClockAt } from "@/lib/shop/timezone";
import { cn } from "@/lib/format";

export default function ShopAvailabilityPanel({
  availability,
  now,
}: {
  availability: ShopAvailability;
  now: number;
}) {
  const schedule = availability.schedule;
  const todayIndex = wallClockAt(now).weekday;
  const exceptions = schedule ? upcomingExceptions(schedule, now) : [];
  const blocked = availability.state !== "open";

  return (
    <section
      aria-labelledby="shop-availability-heading"
      className={cn(
        "mt-4 rounded-2xl border p-4 text-sm",
        blocked ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-100 bg-white text-gray-700",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="shop-availability-heading" className="sr-only">
          Διαθεσιμότητα και ωράριο
        </h2>
        <AvailabilityBadge state={availability.state} />
        <p className="font-semibold" role="status" aria-live="polite">
          {describeAvailability(availability, now)}
        </p>
      </div>

      {blocked && (
        <p className="mt-2 leading-relaxed">
          Μπορείς να δεις τον κατάλογο και να ετοιμάσεις το καλάθι σου, αλλά η παραγγελία
          ολοκληρώνεται μόνο όταν το κατάστημα δέχεται παραγγελίες. Δεν υπάρχουν
          προγραμματισμένες παραγγελίες.
        </p>
      )}

      {schedule && (
        <details className="mt-3 group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-orange-600 hover:text-orange-700">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Ωράριο λειτουργίας (ώρα Ελλάδας)
          </summary>
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {WEEKDAY_KEYS.map((key, index) => (
              <div
                key={key}
                className={cn(
                  "flex justify-between gap-3 rounded-lg px-2 py-1",
                  index === todayIndex && "bg-orange-50 font-bold text-gray-900",
                )}
              >
                <dt>{WEEKDAY_LABELS[key]}</dt>
                <dd className="text-right">{formatIntervals(schedule.weekly[key])}</dd>
              </div>
            ))}
          </dl>

          {exceptions.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                <CalendarClock className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
                Ειδικό ωράριο τις επόμενες μέρες
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {exceptions.map((exception) => (
                  <li key={exception.date}>
                    {formatExceptionDate(exception.date)}
                    {exception.label ? ` (${exception.label})` : ""}:{" "}
                    <span className="font-semibold">
                      {exception.closed ? "Κλειστό" : formatIntervals(exception.intervals)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
