"use client";

/* ==========================================================================
 *  Buka Delivery — components/shop/DeliveryZonesInfo.tsx   (milestone 4)
 *
 *  Στη σελίδα καταστήματος με ενεργές ζώνες ΤΚ: γρήγορος έλεγχος «εξυπηρετεί
 *  τον ΤΚ μου;» και οι όροι κάθε διαθέσιμης ζώνης. Ο έλεγχος αφορά ΜΟΝΟ τον
 *  ταχυδρομικό κώδικα — όχι οδό, θέση ή απόσταση. Τελική απόφαση: server.
 * ========================================================================== */

import { useId, useState } from "react";
import { MapPinned } from "lucide-react";
import type { DeliveryZonesConfig } from "@/types";
import { describeDeliveryProblem, formatZoneTerms, resolveDeliveryTerms } from "@/lib/shop/delivery-zones";
import { POSTAL_CODE_INPUT_MAX, normalizePostalCode } from "@/lib/shop/postal-code";

export default function DeliveryZonesInfo({ config }: { config: DeliveryZonesConfig }) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const available = config.zones.filter((zone) => zone.available);

  const normalized = normalizePostalCode(input);
  const check = input.trim()
    ? normalized
      ? resolveDeliveryTerms({ deliveryZones: config }, normalized)
      : null
    : undefined;

  return (
    <section
      aria-labelledby="delivery-zones-heading"
      className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-900"
    >
      <h2 id="delivery-zones-heading" className="flex items-center gap-2 font-bold">
        <MapPinned className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
        Παράδοση σε συγκεκριμένους ταχυδρομικούς κώδικες
      </h2>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={inputId} className="text-xs font-semibold">
          Έλεγξε τον ΤΚ σου:
        </label>
        <input
          id={inputId}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={POSTAL_CODE_INPUT_MAX}
          placeholder="π.χ. 546 22"
          className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500/30 sm:w-40"
        />
      </div>

      <p className="mt-2 text-xs" role="status" aria-live="polite">
        {check === undefined
          ? ""
          : check === null
            ? "Ο ταχυδρομικός κώδικας έχει 5 ψηφία (π.χ. 546 22)."
            : check.ok
              ? check.snapshot.mode === "zone"
                ? `Εξυπηρετείται — ζώνη «${check.snapshot.zoneName}»: ${formatZoneTerms(check.snapshot)}.`
                : ""
              : describeDeliveryProblem(check.reason, normalized)}
      </p>

      {available.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {available.map((zone) => (
            <li key={zone.id}>
              <span className="font-bold">{zone.name}:</span> {formatZoneTerms(zone)}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-sky-800">
        Ελέγχουμε μόνο αν ο ΤΚ ανήκει στις περιοχές του καταστήματος — όχι την οδό ή την απόσταση.
      </p>
    </section>
  );
}
