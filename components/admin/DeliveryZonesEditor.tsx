"use client";

/* ==========================================================================
 *  Buka Delivery — components/admin/DeliveryZonesEditor.tsx   (milestone 4)
 *
 *  Ζώνες παράδοσης με ταχυδρομικούς κώδικες:
 *    • ενεργοποίηση/απενεργοποίηση του περιορισμού ΤΚ
 *    • ζώνες με όνομα, διαθεσιμότητα, ΤΚ, μεταφορικά, ελάχιστη, δωρεάν από
 *    • νέα ζώνη = τα ποσά ξεκινούν από τους γενικούς όρους του καταστήματος
 *
 *  Ένας ΤΚ μπαίνει σε μία μόνο ζώνη. Ελέγχεται μόνο ο ΤΚ — όχι οδός,
 *  θέση ή απόσταση. Αποθήκευση μέσω POST /api/admin/shop-settings.
 * ========================================================================== */

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPinned, Plus, Trash2 } from "lucide-react";
import type { DeliveryZonesConfig, Shop } from "@/types";
import { DELIVERY_ZONE_LIMITS } from "@/lib/shop/delivery-zones";
import {
  checkZonesDraft,
  mapServerZoneErrors,
  newZoneDraft,
  zoneToDraft,
  type ZoneDraft,
  type ZoneDraftField,
  type ZonesDraftCheck,
} from "@/lib/shop/settings-form";
import { ShopSettingsSaveError, saveShopSettings } from "@/lib/shop/save-shop-settings";
import { cn } from "@/lib/format";

type Props = {
  shopId: string;
  shop: Pick<Shop, "minOrder" | "deliveryFee" | "freeDeliveryOver">;
  initial: DeliveryZonesConfig | null;
  storedInvalid: boolean;
  save?: typeof saveShopSettings;
};

const inputClass =
  "w-full rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:bg-white focus-visible:ring-2 focus-visible:ring-orange-500/30 disabled:opacity-60";

function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-bold text-gray-700">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

export default function DeliveryZonesEditor({ shopId, shop, initial, storedInvalid, save = saveShopSettings }: Props) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [drafts, setDrafts] = useState<ZoneDraft[]>(() => initial?.zones.map(zoneToDraft) ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverCheck, setServerCheck] = useState<Pick<ZonesDraftCheck, "fieldErrors" | "generalErrors"> | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const check = useMemo(() => checkZonesDraft(enabled, drafts), [enabled, drafts]);
  const shown = serverCheck ?? (dirty ? check : { fieldErrors: {}, generalErrors: [] });

  const touch = () => {
    setDirty(true);
    setServerCheck(null);
    setFeedback(null);
  };

  const updateZone = (id: string, patch: Partial<ZoneDraft>) => {
    setDrafts((previous) => previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
    touch();
  };

  const handleSave = async () => {
    setDirty(true);
    if (!check.config) {
      setFeedback({ kind: "error", message: "Διόρθωσε τα σημειωμένα πεδία πριν την αποθήκευση." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await save(shopId, { deliveryZones: check.config });
      if (saved.deliveryZones) {
        setEnabled(saved.deliveryZones.enabled);
        setDrafts(saved.deliveryZones.zones.map(zoneToDraft));
      }
      setDirty(false);
      setServerCheck(null);
      setFeedback({ kind: "success", message: "Οι ζώνες παράδοσης αποθηκεύτηκαν." });
    } catch (caught) {
      const error =
        caught instanceof ShopSettingsSaveError
          ? caught
          : new ShopSettingsSaveError({ code: "internal_error", message: "Δεν ήταν δυνατή η αποθήκευση." });
      if (error.errors.length > 0) setServerCheck(mapServerZoneErrors(error.errors, drafts));
      setFeedback({ kind: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (id: string, field: ZoneDraftField) => shown.fieldErrors[id]?.[field];

  return (
    <section
      aria-labelledby="delivery-zones-editor-heading"
      className="rounded-3xl border border-gray-200 bg-white p-6 lg:col-span-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="delivery-zones-editor-heading"
            className="flex items-center gap-2 text-lg font-black tracking-tight text-gray-900"
          >
            <MapPinned className="h-5 w-5 text-orange-500" aria-hidden="true" />
            Περιοχές παράδοσης (ταχυδρομικοί κώδικες)
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Όταν είναι ενεργό, ο πελάτης δίνει ΤΚ στο ταμείο και παραγγέλνει μόνο αν ο ΤΚ ανήκει σε
            διαθέσιμη ζώνη, με τα μεταφορικά και την ελάχιστη της ζώνης. Ελέγχεται μόνο ο ΤΚ — όχι η
            οδός ή η απόσταση.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-gray-800">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(event) => {
              setEnabled(event.target.checked);
              touch();
            }}
            className="h-4 w-4 accent-orange-500"
          />
          Παράδοση μόνο σε συγκεκριμένους ΤΚ
        </label>
      </div>

      {storedInvalid && !dirty && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 p-3.5 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Οι αποθηκευμένες ζώνες έχουν πρόβλημα, γι&apos; αυτό το κατάστημα δεν δέχεται παραγγελίες.
          Έλεγξε τις ζώνες και αποθήκευσε ξανά.
        </p>
      )}

      {!enabled && (
        <p className="mt-4 rounded-2xl bg-gray-50 p-3.5 text-sm text-gray-600">
          Ο περιορισμός είναι ανενεργός: ισχύουν τα γενικά μεταφορικά και η ελάχιστη παραγγελία του
          καταστήματος, όπως μέχρι τώρα, χωρίς έλεγχο ΤΚ.
        </p>
      )}

      {shown.generalErrors.length > 0 && (
        <ul className="mt-4 space-y-1" role="alert">
          {shown.generalErrors.map((message, index) => (
            <li key={index} className="flex items-start gap-1.5 text-sm font-semibold text-red-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 space-y-4">
        {drafts.map((draft, index) => {
          const prefix = `zone-${draft.id}`;
          return (
            <fieldset
              key={draft.id}
              className={cn(
                "rounded-2xl border p-4",
                shown.fieldErrors[draft.id] ? "border-red-200 bg-red-50/40" : "border-gray-100",
                !draft.available && "opacity-80",
              )}
            >
              <legend className="sr-only">Ζώνη {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field id={`${prefix}-name`} label="Όνομα ζώνης" error={errorFor(draft.id, "name")} className="sm:col-span-2">
                  <input
                    id={`${prefix}-name`}
                    value={draft.name}
                    disabled={saving}
                    maxLength={DELIVERY_ZONE_LIMITS.nameMax}
                    onChange={(event) => updateZone(draft.id, { name: event.target.value })}
                    aria-invalid={errorFor(draft.id, "name") ? true : undefined}
                    className={cn(inputClass, errorFor(draft.id, "name") ? "border-red-300" : "border-gray-200")}
                  />
                </Field>
                <div className="flex items-end gap-2 sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800">
                    <input
                      type="checkbox"
                      checked={draft.available}
                      disabled={saving}
                      onChange={(event) => updateZone(draft.id, { available: event.target.checked })}
                      className="h-4 w-4 accent-orange-500"
                    />
                    Ενεργή ζώνη
                  </label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setDrafts((previous) => previous.filter((entry) => entry.id !== draft.id));
                      touch();
                    }}
                    aria-label={`Διαγραφή ζώνης «${draft.name || index + 1}»`}
                    className="ml-auto flex h-9 items-center gap-1 rounded-full px-3 text-xs font-bold text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Διαγραφή
                  </button>
                </div>

                <Field id={`${prefix}-fee`} label="Μεταφορικά (€)" error={errorFor(draft.id, "deliveryFee")}>
                  <input
                    id={`${prefix}-fee`}
                    inputMode="decimal"
                    value={draft.deliveryFee}
                    disabled={saving}
                    onChange={(event) => updateZone(draft.id, { deliveryFee: event.target.value })}
                    aria-invalid={errorFor(draft.id, "deliveryFee") ? true : undefined}
                    className={cn(inputClass, errorFor(draft.id, "deliveryFee") ? "border-red-300" : "border-gray-200")}
                  />
                </Field>
                <Field
                  id={`${prefix}-min`}
                  label="Ελάχιστη παραγγελία (€)"
                  error={errorFor(draft.id, "minOrder")}
                  hint="Στα προϊόντα (μαζί με τις επιλογές), χωρίς μεταφορικά."
                >
                  <input
                    id={`${prefix}-min`}
                    inputMode="decimal"
                    value={draft.minOrder}
                    disabled={saving}
                    onChange={(event) => updateZone(draft.id, { minOrder: event.target.value })}
                    aria-invalid={errorFor(draft.id, "minOrder") ? true : undefined}
                    className={cn(inputClass, errorFor(draft.id, "minOrder") ? "border-red-300" : "border-gray-200")}
                  />
                </Field>
                <Field
                  id={`${prefix}-free`}
                  label="Δωρεάν μεταφορικά από (€)"
                  error={errorFor(draft.id, "freeDeliveryOver")}
                  hint="Κενό = χωρίς δωρεάν μεταφορικά."
                  className="sm:col-span-2"
                >
                  <input
                    id={`${prefix}-free`}
                    inputMode="decimal"
                    value={draft.freeDeliveryOver}
                    disabled={saving}
                    onChange={(event) => updateZone(draft.id, { freeDeliveryOver: event.target.value })}
                    aria-invalid={errorFor(draft.id, "freeDeliveryOver") ? true : undefined}
                    className={cn(
                      inputClass,
                      errorFor(draft.id, "freeDeliveryOver") ? "border-red-300" : "border-gray-200",
                    )}
                  />
                </Field>

                <Field
                  id={`${prefix}-codes`}
                  label="Ταχυδρομικοί κώδικες"
                  error={errorFor(draft.id, "postalCodes")}
                  hint={`Χώρισέ τους με κόμμα ή νέα γραμμή, π.χ. 546 22, 546 23. Έως ${DELIVERY_ZONE_LIMITS.maxPostalCodesPerZone} ανά ζώνη.`}
                  className="sm:col-span-2 lg:col-span-4"
                >
                  <textarea
                    id={`${prefix}-codes`}
                    rows={2}
                    value={draft.postalCodesText}
                    disabled={saving}
                    onChange={(event) => updateZone(draft.id, { postalCodesText: event.target.value })}
                    aria-invalid={errorFor(draft.id, "postalCodes") ? true : undefined}
                    className={cn(
                      inputClass,
                      "resize-y",
                      errorFor(draft.id, "postalCodes") ? "border-red-300" : "border-gray-200",
                    )}
                  />
                </Field>
              </div>
            </fieldset>
          );
        })}
      </div>

      {drafts.length < DELIVERY_ZONE_LIMITS.maxZones && (
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDrafts((previous) => [...previous, newZoneDraft(shop, previous.length)]);
            touch();
          }}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 hover:text-orange-600 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Νέα ζώνη (με τα γενικά μεταφορικά/ελάχιστη του καταστήματος)
        </button>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Αποθήκευση ζωνών
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {feedback?.kind === "success" && (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {feedback.message}
            </span>
          )}
          {feedback?.kind === "error" && <span className="font-semibold text-red-700">{feedback.message}</span>}
          {!feedback && dirty && <span className="text-gray-500">Έχεις αλλαγές που δεν αποθηκεύτηκαν.</span>}
        </p>
      </div>
    </section>
  );
}
