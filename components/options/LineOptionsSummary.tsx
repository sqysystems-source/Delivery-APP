/* ==========================================================================
 *  Buka Delivery — components/options/LineOptionsSummary.tsx  (milestone 3)
 *
 *  Οι επιλογές μιας γραμμής, κάτω από το όνομα του προϊόντος:
 *    Μέγεθος: Μεγάλη (+1,00€)
 *    Έξτρα: Τυρί (+0,50€)
 *    Χωρίς: κρεμμύδι
 *  Διαβάζει ΜΟΝΟ το στιγμιότυπο της γραμμής — ποτέ τον τρέχοντα κατάλογο.
 * ========================================================================== */

import type { OrderLineOption } from "@/types";
import { formatOptionLines } from "@/lib/menu/options";
import { cn } from "@/lib/format";

export default function LineOptionsSummary({
  options,
  className,
}: {
  options?: readonly OrderLineOption[] | null;
  className?: string;
}) {
  if (!options || options.length === 0) return null;
  /* <span> (όχι <ul>): μπαίνει και μέσα σε inline στοιχεία γραμμών */
  return (
    <span className={cn("mt-0.5 block space-y-0.5 text-xs leading-snug text-gray-600", className)}>
      {formatOptionLines(options).map((text, index) => (
        <span key={index} className="block">
          {text}
        </span>
      ))}
    </span>
  );
}
