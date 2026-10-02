"use client";

/* ==========================================================================
 *  Buka Delivery — components/options/ProductOptionsFields.tsx  (milestone 3)
 *
 *  Οι ομάδες επιλογών όπως τις βλέπει ο πελάτης. Κοινό για:
 *    • τον διάλογο «Προσθήκη στο καλάθι» / «Επεξεργασία επιλογών»
 *    • την προεπισκόπηση στη φόρμα προϊόντος του καταστηματάρχη
 *
 *  Προσβασιμότητα: κάθε ομάδα είναι <fieldset> με <legend> και οδηγία
 *  (aria-describedby). Μία επιλογή = radio (τα βέλη αλλάζουν επιλογή, όπως
 *  ορίζει ο browser)· πολλές/αφαιρέσεις = checkboxes. Οι μη διαθέσιμες
 *  επιλογές είναι disabled ΚΑΙ γράφουν «Μη διαθέσιμο» (όχι μόνο χρώμα).
 *  Τίποτα δεν επιλέγεται αυτόματα — ούτε η πρώτη επιλογή, ούτε δωρεάν.
 * ========================================================================== */

import { AlertCircle } from "lucide-react";
import type { MenuOptionGroup } from "@/types";
import { describeGroupRule } from "@/lib/menu/options";
import { cn, formatPrice } from "@/lib/format";

export type SelectionState = Record<string, string[]>;

type ProductOptionsFieldsProps = {
  groups: readonly MenuOptionGroup[];
  value: SelectionState;
  onChange: (groupId: string, choiceIds: string[]) => void;
  errors?: Partial<Record<string, string>>;
  /** Μοναδικό πρόθεμα ids (δύο διάλογοι δεν πρέπει να μοιράζονται ids) */
  idPrefix: string;
  disabled?: boolean;
};

export function groupFieldsetId(idPrefix: string, groupId: string): string {
  return `${idPrefix}-group-${groupId}`;
}

export default function ProductOptionsFields({
  groups,
  value,
  onChange,
  errors = {},
  idPrefix,
  disabled = false,
}: ProductOptionsFieldsProps) {
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const selected = value[group.id] ?? [];
        const fieldsetId = groupFieldsetId(idPrefix, group.id);
        const ruleId = `${fieldsetId}-rule`;
        const errorId = `${fieldsetId}-error`;
        const error = errors[group.id];
        const atMax = group.kind === "multiple" && selected.length >= group.maxSelect;
        const radioName = `${fieldsetId}-radio`;

        return (
          <fieldset
            key={group.id}
            id={fieldsetId}
            tabIndex={-1}
            aria-describedby={error ? `${ruleId} ${errorId}` : ruleId}
            aria-invalid={error ? true : undefined}
            className={cn(
              "rounded-2xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-orange-500",
              error ? "border-red-300 bg-red-50/40" : "border-gray-100 bg-gray-50/60",
            )}
          >
            <legend className="sr-only">{group.label}</legend>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p aria-hidden="true" className="text-sm font-extrabold text-gray-900">
                {group.label}
              </p>
              <p
                id={ruleId}
                className={cn(
                  "text-xs font-semibold",
                  group.required ? "text-orange-700" : "text-gray-500",
                )}
              >
                {describeGroupRule(group)}
              </p>
            </div>

            {error && (
              <p id={errorId} className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <ul className="mt-3 space-y-1.5">
              {/* Προαιρετική «μία επιλογή»: ρητό «Χωρίς επιλογή» για να ξεεπιλέγεται */}
              {group.kind === "single" && !group.required && (
                <li>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white">
                    <input
                      type="radio"
                      name={radioName}
                      checked={selected.length === 0}
                      onChange={() => onChange(group.id, [])}
                      disabled={disabled}
                      className="h-4 w-4 shrink-0 accent-orange-500"
                    />
                    <span className="flex-1 text-gray-700">Χωρίς επιλογή</span>
                  </label>
                </li>
              )}

              {group.choices.map((choice) => {
                const checked = selected.includes(choice.id);
                const unavailable = !choice.available;
                const blockedByMax = atMax && !checked;
                const inputDisabled = disabled || (unavailable && !checked) || blockedByMax;
                const priceText =
                  group.kind !== "remove" && choice.priceDelta > 0
                    ? `+${formatPrice(choice.priceDelta)}`
                    : group.kind === "remove"
                      ? null
                      : "Δωρεάν";
                const label = group.kind === "remove" ? `Χωρίς ${choice.label}` : choice.label;

                return (
                  <li key={choice.id}>
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-2 py-2 text-sm",
                        inputDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-white",
                      )}
                    >
                      <input
                        type={group.kind === "single" ? "radio" : "checkbox"}
                        name={group.kind === "single" ? radioName : undefined}
                        checked={checked}
                        disabled={inputDisabled}
                        onChange={(event) => {
                          if (group.kind === "single") {
                            onChange(group.id, [choice.id]);
                          } else if (event.target.checked) {
                            onChange(group.id, [...selected, choice.id]);
                          } else {
                            onChange(group.id, selected.filter((id) => id !== choice.id));
                          }
                        }}
                        className="h-4 w-4 shrink-0 accent-orange-500"
                      />
                      <span className={cn("flex-1", unavailable ? "text-gray-500 line-through" : "text-gray-800")}>
                        {label}
                      </span>
                      {unavailable ? (
                        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                          Μη διαθέσιμο
                        </span>
                      ) : (
                        priceText && (
                          <span
                            className={cn(
                              "shrink-0 text-xs font-bold",
                              choice.priceDelta > 0 ? "text-gray-900" : "text-emerald-700",
                            )}
                          >
                            {priceText}
                          </span>
                        )
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>

            {group.kind === "multiple" && atMax && (
              <p className="mt-2 text-xs text-gray-500">
                Έφτασες το μέγιστο ({group.maxSelect}). Ξετσέκαρε κάτι για να αλλάξεις επιλογή.
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
