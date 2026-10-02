"use client";

/* ==========================================================================
 *  Buka Delivery — components/admin/OptionGroupsEditor.tsx  (milestone 3)
 *
 *  Επεξεργαστής ομάδων επιλογών μέσα στη φόρμα προϊόντος του
 *  καταστηματάρχη: προσθήκη, επεξεργασία, αναδιάταξη (πάνω/κάτω) και
 *  αφαίρεση ομάδων και επιλογών, όρια επιλογής, υποχρεωτικό, προσαυξήσεις,
 *  διαθεσιμότητα, αφαιρέσεις υλικών — και προεπισκόπηση όπως θα το δει ο
 *  πελάτης.
 *
 *  Τα ids ομάδων/επιλογών δημιουργούνται ΜΙΑ φορά (generateOptionId) και δεν
 *  αλλάζουν ποτέ: μετονομασία ή μετακίνηση δεν «σπάει» καλάθια πελατών.
 *
 *  Οι τιμές γράφονται ως κείμενο («0,50») και μετατρέπονται με κόμμα ή
 *  τελεία. Η επικύρωση είναι η ΙΔΙΑ με του server (validateOptionGroups).
 * ========================================================================== */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import ProductOptionsFields, { type SelectionState } from "@/components/options/ProductOptionsFields";
import type { MenuOptionGroup, MenuOptionKind } from "@/types";
import {
  OPTION_KIND_LABELS,
  OPTION_LIMITS,
  generateOptionId,
  type OptionConfigError,
} from "@/lib/menu/options";
import { cn } from "@/lib/format";

/* ==========================================================================
 *  Πρόχειρο φόρμας ↔ ρύθμιση
 * ========================================================================== */

export type ChoiceDraft = { id: string; label: string; price: string; available: boolean };

export type GroupDraft = {
  id: string;
  label: string;
  kind: MenuOptionKind;
  required: boolean;
  minSelect: string;
  maxSelect: string;
  choices: ChoiceDraft[];
};

function priceToText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(2).replace(".", ",")
    : "";
}

/** «0,50» / «0.50» / «» → αριθμός· NaN όταν δεν είναι αριθμός */
function parsePriceText(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function parseIntText(value: string): number {
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/**
 * Αποθηκευμένη ρύθμιση → πρόχειρο. Ανεκτικό: ακόμη κι αν κάτι στη βάση είναι
 * κακόμορφο, ο καταστηματάρχης βλέπει ό,τι υπάρχει και το διορθώνει — δεν
 * χάνεται σιωπηλά στην επόμενη αποθήκευση.
 */
export function draftsFromStored(raw: unknown): GroupDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, OPTION_LIMITS.maxGroups).map((entry) => {
    const group = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const kind: MenuOptionKind =
      group.kind === "single" || group.kind === "multiple" || group.kind === "remove" ? group.kind : "single";
    const choices = Array.isArray(group.choices) ? group.choices : [];
    return {
      id: typeof group.id === "string" && group.id ? group.id : generateOptionId("g"),
      label: typeof group.label === "string" ? group.label : "",
      kind,
      required: group.required === true,
      minSelect: typeof group.minSelect === "number" ? String(group.minSelect) : "0",
      maxSelect: typeof group.maxSelect === "number" ? String(group.maxSelect) : "1",
      choices: choices.slice(0, OPTION_LIMITS.maxChoicesPerGroup).map((choiceEntry: unknown) => {
        const choice = (typeof choiceEntry === "object" && choiceEntry !== null ? choiceEntry : {}) as Record<
          string,
          unknown
        >;
        return {
          id: typeof choice.id === "string" && choice.id ? choice.id : generateOptionId("c"),
          label: typeof choice.label === "string" ? choice.label : "",
          price: priceToText(choice.priceDelta),
          available: choice.available !== false,
        };
      }),
    };
  });
}

/** Πρόχειρο → ρύθμιση για επικύρωση/αποστολή (τα όρια προκύπτουν από το είδος) */
export function groupsFromDrafts(drafts: readonly GroupDraft[]): MenuOptionGroup[] {
  return drafts.map((draft) => {
    const choices = draft.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      priceDelta: draft.kind === "remove" ? 0 : parsePriceText(choice.price),
      available: choice.available,
    }));
    switch (draft.kind) {
      case "single":
        return { id: draft.id, label: draft.label, kind: "single", required: draft.required, minSelect: draft.required ? 1 : 0, maxSelect: 1, choices };
      case "remove":
        return { id: draft.id, label: draft.label, kind: "remove", required: false, minSelect: 0, maxSelect: choices.length, choices };
      case "multiple":
        return {
          id: draft.id,
          label: draft.label,
          kind: "multiple",
          required: draft.required,
          minSelect: draft.required ? parseIntText(draft.minSelect) : 0,
          maxSelect: parseIntText(draft.maxSelect),
          choices,
        };
    }
  });
}

function newChoice(): ChoiceDraft {
  return { id: generateOptionId("c"), label: "", price: "", available: true };
}

function newGroup(kind: MenuOptionKind): GroupDraft {
  return {
    id: generateOptionId("g"),
    label: kind === "remove" ? "Αφαίρεση υλικών" : "",
    kind,
    required: kind === "single",
    minSelect: "1",
    maxSelect: kind === "multiple" ? "3" : "1",
    choices: [newChoice()],
  };
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

/* ==========================================================================
 *  Component
 * ========================================================================== */

type OptionGroupsEditorProps = {
  drafts: GroupDraft[];
  onChange: (drafts: GroupDraft[]) => void;
  /** Λάθη ανά διαδρομή (π.χ. "groups.0.choices.1.priceDelta") — από τοπικό ή server έλεγχο */
  errors: readonly OptionConfigError[];
  /** Ρύθμιση για προεπισκόπηση — null όταν υπάρχουν λάθη */
  previewGroups: MenuOptionGroup[] | null;
  disabled?: boolean;
};

export default function OptionGroupsEditor({
  drafts,
  onChange,
  errors,
  previewGroups,
  disabled = false,
}: OptionGroupsEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [previewState, setPreviewState] = useState<SelectionState>({});

  const errorAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of errors) if (!map.has(error.path)) map.set(error.path, error.message);
    return (path: string) => map.get(path);
  }, [errors]);

  const totalChoices = drafts.reduce((sum, group) => sum + group.choices.length, 0);
  const canAddGroup = drafts.length < OPTION_LIMITS.maxGroups;
  const hasRemoveGroup = drafts.some((group) => group.kind === "remove");

  const updateGroup = (index: number, patch: Partial<GroupDraft>) =>
    onChange(drafts.map((group, position) => (position === index ? { ...group, ...patch } : group)));

  const updateChoice = (groupIndex: number, choiceIndex: number, patch: Partial<ChoiceDraft>) =>
    updateGroup(groupIndex, {
      choices: drafts[groupIndex].choices.map((choice, position) =>
        position === choiceIndex ? { ...choice, ...patch } : choice,
      ),
    });

  const input = (hasError: boolean) =>
    cn(
      "w-full rounded-xl border bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400",
      hasError ? "border-red-300 focus:border-red-400" : "border-gray-200 focus:border-orange-400",
    );

  const iconButton =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-30";

  const fieldError = (path: string) => {
    const message = errorAt(path);
    return message ? <p className="mt-1 text-xs font-semibold text-red-600">{message}</p> : null;
  };

  return (
    <section aria-labelledby="option-groups-heading" className="space-y-3">
      <div>
        <h3 id="option-groups-heading" className="text-sm font-bold text-gray-900">
          Επιλογές προϊόντος <span className="text-xs font-medium text-gray-400">προαιρετικό</span>
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
          Μέγεθος, έξτρα υλικά με προσαύξηση και δωρεάν αφαιρέσεις (π.χ. «χωρίς κρεμμύδι»). Οι
          προσαυξήσεις χρεώνονται ανά τεμάχιο, πάνω στη βασική τιμή.
        </p>
        {fieldError("groups")}
      </div>

      {drafts.map((group, groupIndex) => {
        const at = (suffix: string) => `groups.${groupIndex}.${suffix}`;
        const groupTitle = group.label.trim() || `Ομάδα ${groupIndex + 1}`;
        return (
          <fieldset
            key={group.id}
            disabled={disabled}
            className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
          >
            <legend className="sr-only">{groupTitle}</legend>

            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-bold uppercase tracking-wider text-gray-500">
                {group.kind === "remove" ? "Αφαίρεση υλικών" : `Ομάδα ${groupIndex + 1}`}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onChange(move(drafts, groupIndex, groupIndex - 1))}
                  disabled={groupIndex === 0}
                  aria-label={`Μετακίνηση ομάδας «${groupTitle}» πάνω`}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  onClick={() => onChange(move(drafts, groupIndex, groupIndex + 1))}
                  disabled={groupIndex === drafts.length - 1}
                  aria-label={`Μετακίνηση ομάδας «${groupTitle}» κάτω`}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cn(iconButton, "hover:bg-red-50 hover:text-red-600")}
                  onClick={() => onChange(drafts.filter((_, position) => position !== groupIndex))}
                  aria-label={`Αφαίρεση ομάδας «${groupTitle}»`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${group.id}-label`} className="mb-1 block text-xs font-bold text-gray-700">
                  Τίτλος ομάδας
                </label>
                <input
                  id={`${group.id}-label`}
                  type="text"
                  value={group.label}
                  maxLength={OPTION_LIMITS.groupLabelMax}
                  onChange={(event) => updateGroup(groupIndex, { label: event.target.value })}
                  placeholder={group.kind === "remove" ? "π.χ. Αφαίρεση υλικών" : "π.χ. Μέγεθος"}
                  className={input(Boolean(errorAt(at("label"))))}
                />
                {fieldError(at("label"))}
              </div>

              <div>
                <label htmlFor={`${group.id}-kind`} className="mb-1 block text-xs font-bold text-gray-700">
                  Είδος
                </label>
                <select
                  id={`${group.id}-kind`}
                  value={group.kind}
                  onChange={(event) => {
                    const kind = event.target.value as MenuOptionKind;
                    updateGroup(groupIndex, {
                      kind,
                      required: kind === "remove" ? false : group.required,
                    });
                  }}
                  className={cn(input(false), "cursor-pointer")}
                >
                  {(Object.keys(OPTION_KIND_LABELS) as MenuOptionKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {OPTION_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {group.kind !== "remove" && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-800">
                  <input
                    type="checkbox"
                    checked={group.required}
                    onChange={(event) => updateGroup(groupIndex, { required: event.target.checked })}
                    className="h-4 w-4 accent-orange-500"
                  />
                  Υποχρεωτική επιλογή
                </label>

                {group.kind === "multiple" && (
                  <>
                    {group.required && (
                      <div className="w-24">
                        <label htmlFor={`${group.id}-min`} className="mb-1 block text-xs font-bold text-gray-700">
                          Ελάχιστο
                        </label>
                        <input
                          id={`${group.id}-min`}
                          type="text"
                          inputMode="numeric"
                          value={group.minSelect}
                          onChange={(event) => updateGroup(groupIndex, { minSelect: event.target.value })}
                          className={input(Boolean(errorAt(at("minSelect"))))}
                        />
                      </div>
                    )}
                    <div className="w-24">
                      <label htmlFor={`${group.id}-max`} className="mb-1 block text-xs font-bold text-gray-700">
                        Μέγιστο
                      </label>
                      <input
                        id={`${group.id}-max`}
                        type="text"
                        inputMode="numeric"
                        value={group.maxSelect}
                        onChange={(event) => updateGroup(groupIndex, { maxSelect: event.target.value })}
                        className={input(Boolean(errorAt(at("maxSelect"))))}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
            {fieldError(at("minSelect"))}
            {fieldError(at("maxSelect"))}
            {fieldError(at("required"))}
            {fieldError(at("kind"))}

            {/* ------------------------------ Επιλογές ------------------------------ */}
            <ul className="mt-3 space-y-2" aria-label={`Επιλογές της ομάδας «${groupTitle}»`}>
              {group.choices.map((choice, choiceIndex) => {
                const cat = (suffix: string) => at(`choices.${choiceIndex}.${suffix}`);
                const choiceTitle = choice.label.trim() || `Επιλογή ${choiceIndex + 1}`;
                return (
                  <li key={choice.id} className="rounded-xl border border-gray-200 bg-white p-2.5">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-[8rem] flex-1">
                        <label htmlFor={`${choice.id}-label`} className="sr-only">
                          {group.kind === "remove" ? "Υλικό" : "Όνομα επιλογής"}
                        </label>
                        <input
                          id={`${choice.id}-label`}
                          type="text"
                          value={choice.label}
                          maxLength={OPTION_LIMITS.choiceLabelMax}
                          onChange={(event) => updateChoice(groupIndex, choiceIndex, { label: event.target.value })}
                          placeholder={
                            group.kind === "remove" ? "π.χ. κρεμμύδι" : group.kind === "single" ? "π.χ. Μεγάλη" : "π.χ. Έξτρα τυρί"
                          }
                          className={input(Boolean(errorAt(cat("label"))))}
                        />
                      </div>

                      {group.kind !== "remove" && (
                        <div className="w-24">
                          <label htmlFor={`${choice.id}-price`} className="sr-only">
                            Προσαύξηση σε ευρώ
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                              +€
                            </span>
                            <input
                              id={`${choice.id}-price`}
                              type="text"
                              inputMode="decimal"
                              value={choice.price}
                              onChange={(event) => updateChoice(groupIndex, choiceIndex, { price: event.target.value })}
                              placeholder="0,00"
                              className={cn(input(Boolean(errorAt(cat("priceDelta")))), "pl-8")}
                            />
                          </div>
                        </div>
                      )}

                      <label className="flex h-9 cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          checked={choice.available}
                          onChange={(event) => updateChoice(groupIndex, choiceIndex, { available: event.target.checked })}
                          className="h-4 w-4 accent-orange-500"
                        />
                        Διαθέσιμο
                      </label>

                      <div className="flex items-center">
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() => updateGroup(groupIndex, { choices: move(group.choices, choiceIndex, choiceIndex - 1) })}
                          disabled={choiceIndex === 0}
                          aria-label={`Μετακίνηση «${choiceTitle}» πάνω`}
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={iconButton}
                          onClick={() => updateGroup(groupIndex, { choices: move(group.choices, choiceIndex, choiceIndex + 1) })}
                          disabled={choiceIndex === group.choices.length - 1}
                          aria-label={`Μετακίνηση «${choiceTitle}» κάτω`}
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={cn(iconButton, "hover:bg-red-50 hover:text-red-600")}
                          onClick={() =>
                            updateGroup(groupIndex, {
                              choices: group.choices.filter((_, position) => position !== choiceIndex),
                            })
                          }
                          aria-label={`Αφαίρεση «${choiceTitle}»`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {fieldError(cat("label"))}
                    {fieldError(cat("priceDelta"))}
                    {fieldError(cat("id"))}
                  </li>
                );
              })}
            </ul>
            {fieldError(at("choices"))}

            <button
              type="button"
              onClick={() => updateGroup(groupIndex, { choices: [...group.choices, newChoice()] })}
              disabled={
                group.choices.length >= OPTION_LIMITS.maxChoicesPerGroup ||
                totalChoices >= OPTION_LIMITS.maxChoicesTotal
              }
              className="mt-2 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {group.kind === "remove" ? "Προσθήκη υλικού" : "Προσθήκη επιλογής"}
            </button>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([...drafts, newGroup("single")])}
          disabled={disabled || !canAddGroup || totalChoices >= OPTION_LIMITS.maxChoicesTotal}
          className="flex items-center gap-1 rounded-full border border-orange-200 bg-white px-3.5 py-2 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Ομάδα επιλογών
        </button>
        {!hasRemoveGroup && (
          <button
            type="button"
            onClick={() => onChange([...drafts, newGroup("remove")])}
            disabled={disabled || !canAddGroup || totalChoices >= OPTION_LIMITS.maxChoicesTotal}
            className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Αφαίρεση υλικών
          </button>
        )}
        {drafts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPreview((value) => !value)}
            aria-expanded={showPreview}
            aria-controls="option-groups-preview"
            className="ml-auto flex items-center gap-1 rounded-full px-3.5 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-100"
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {showPreview ? "Κρύψε την προεπισκόπηση" : "Προεπισκόπηση πελάτη"}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Έως {OPTION_LIMITS.maxGroups} ομάδες, {OPTION_LIMITS.maxChoicesPerGroup} επιλογές ανά ομάδα και{" "}
        {OPTION_LIMITS.maxChoicesTotal} συνολικά ({totalChoices} τώρα).
      </p>

      {showPreview && drafts.length > 0 && (
        <div id="option-groups-preview" className="rounded-2xl border border-dashed border-orange-300 bg-white p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-orange-600">
            Έτσι θα το δει ο πελάτης
          </p>
          {previewGroups ? (
            <ProductOptionsFields
              groups={previewGroups}
              value={previewState}
              onChange={(groupId, choiceIds) => setPreviewState((state) => ({ ...state, [groupId]: choiceIds }))}
              idPrefix="admin-preview"
            />
          ) : (
            <p className="text-sm text-gray-600">Διόρθωσε τα επισημασμένα πεδία για να δεις την προεπισκόπηση.</p>
          )}
        </div>
      )}
    </section>
  );
}
