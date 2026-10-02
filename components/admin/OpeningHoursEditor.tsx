"use client";

/* ==========================================================================
 *  Buka Delivery — components/admin/OpeningHoursEditor.tsx   (milestone 4)
 *
 *  Ωράριο λειτουργίας στις ρυθμίσεις καταστήματος:
 *    • εβδομαδιαίο πρόγραμμα: κάθε μέρα κλειστή ή με έως 4 διαστήματα
 *    • βραδινές βάρδιες (π.χ. 18:00–02:00 → κλείνει την επόμενη μέρα)
 *    • εξαιρέσεις ημερομηνιών: κλειστό όλη μέρα ή ειδικό ωράριο
 *
 *  Inline έλεγχος με τον ΙΔΙΟ validator που τρέχει ο server. Η αποθήκευση
 *  περνά από το POST /api/admin/shop-settings (ο browser δεν γράφει ποτέ
 *  απευθείας το `openingHours` — το απαγορεύουν τα Rules).
 * ========================================================================== */

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import type { OpeningHoursConfig, OpeningHoursException, OpeningInterval, WeekdayKey } from "@/types";
import {
  OPENING_HOURS_LIMITS,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  isOvernight,
  type ShopSettingsError,
} from "@/lib/shop/opening-hours";
import { checkOpeningHoursDraft, defaultOpeningHours, errorsByPrefix, isAlwaysClosed } from "@/lib/shop/settings-form";
import { ShopSettingsSaveError, saveShopSettings } from "@/lib/shop/save-shop-settings";
import { addDays, wallClockAt } from "@/lib/shop/timezone";
import { cn } from "@/lib/format";

type Props = {
  shopId: string;
  /** Η αποθηκευμένη ρύθμιση (null = το κατάστημα δεν έχει ωράριο ακόμη) */
  initial: OpeningHoursConfig | null;
  /** Η αποθηκευμένη ρύθμιση είναι κακόμορφη (το κατάστημα φαίνεται μη διαθέσιμο) */
  storedInvalid: boolean;
  /** Για tests */
  save?: typeof saveShopSettings;
};

const inputClass =
  "rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm text-gray-900 outline-none focus:border-orange-400 focus:bg-white focus-visible:ring-2 focus-visible:ring-orange-500/30 disabled:opacity-60";

function IntervalsEditor({
  intervals,
  onChange,
  disabled,
  labelPrefix,
}: {
  intervals: OpeningInterval[];
  onChange: (next: OpeningInterval[]) => void;
  disabled: boolean;
  labelPrefix: string;
}) {
  return (
    <div className="space-y-2">
      {intervals.map((interval, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            type="time"
            step={60}
            value={interval.open}
            disabled={disabled}
            aria-label={`${labelPrefix}: άνοιγμα διαστήματος ${index + 1}`}
            onChange={(event) =>
              onChange(intervals.map((entry, i) => (i === index ? { ...entry, open: event.target.value } : entry)))
            }
            className={inputClass}
          />
          <span className="text-gray-400" aria-hidden="true">
            –
          </span>
          <input
            type="time"
            step={60}
            value={interval.close === "24:00" ? "00:00" : interval.close}
            disabled={disabled}
            aria-label={`${labelPrefix}: κλείσιμο διαστήματος ${index + 1}`}
            onChange={(event) =>
              onChange(intervals.map((entry, i) => (i === index ? { ...entry, close: event.target.value } : entry)))
            }
            className={inputClass}
          />
          {isOvernight(interval) && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
              κλείνει την επόμενη μέρα
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(intervals.filter((_, i) => i !== index))}
            aria-label={`${labelPrefix}: αφαίρεση διαστήματος ${index + 1}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {intervals.length < OPENING_HOURS_LIMITS.maxIntervalsPerDay && (
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...intervals,
              intervals.length === 0 ? { open: "12:00", close: "23:00" } : { open: "18:00", close: "23:00" },
            ])
          }
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-50 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {intervals.length === 0 ? "Προσθήκη ωραρίου" : "Ακόμη ένα διάστημα"}
        </button>
      )}
    </div>
  );
}

function ErrorList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {messages.map((message, index) => (
        <li key={index} className="flex items-start gap-1.5 text-xs font-semibold text-red-600">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {message}
        </li>
      ))}
    </ul>
  );
}

export default function OpeningHoursEditor({ shopId, initial, storedInvalid, save = saveShopSettings }: Props) {
  const [draft, setDraft] = useState<OpeningHoursConfig>(() => initial ?? defaultOpeningHours());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<ShopSettingsError[]>([]);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const localErrors = useMemo(() => checkOpeningHoursDraft(draft), [draft]);
  const errors = serverErrors.length > 0 ? serverErrors : localErrors;
  const showErrors = dirty || serverErrors.length > 0;

  const update = (next: OpeningHoursConfig) => {
    setDraft(next);
    setDirty(true);
    setServerErrors([]);
    setFeedback(null);
  };

  const setDay = (key: WeekdayKey, intervals: OpeningInterval[]) =>
    update({ ...draft, weekly: { ...draft.weekly, [key]: intervals } });

  const setException = (index: number, next: OpeningHoursException) =>
    update({ ...draft, exceptions: draft.exceptions.map((entry, i) => (i === index ? next : entry)) });

  const addException = () => {
    const taken = new Set(draft.exceptions.map((exception) => exception.date));
    let date = wallClockAt(Date.now()).date;
    while (taken.has(date)) date = addDays(date, 1);
    update({ ...draft, exceptions: [...draft.exceptions, { date, closed: true, intervals: [] }] });
  };

  const copyMondayToAll = () => {
    const monday = draft.weekly.mon;
    update({
      ...draft,
      weekly: Object.fromEntries(
        WEEKDAY_KEYS.map((key) => [key, monday.map((interval) => ({ ...interval }))]),
      ) as OpeningHoursConfig["weekly"],
    });
  };

  const handleSave = async () => {
    setDirty(true);
    if (localErrors.length > 0) {
      setFeedback({ kind: "error", message: "Διόρθωσε τα σημειωμένα σημεία πριν την αποθήκευση." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await save(shopId, { openingHours: draft });
      if (saved.openingHours) setDraft(saved.openingHours);
      setDirty(false);
      setServerErrors([]);
      setFeedback({ kind: "success", message: "Το ωράριο αποθηκεύτηκε." });
    } catch (caught) {
      const error =
        caught instanceof ShopSettingsSaveError
          ? caught
          : new ShopSettingsSaveError({ code: "internal_error", message: "Δεν ήταν δυνατή η αποθήκευση." });
      setServerErrors(error.errors);
      setFeedback({ kind: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const generalErrors = showErrors
    ? errors
        .filter((error) => error.path === "openingHours" || error.path === "openingHours.weekly" || error.path === "openingHours.exceptions" || error.path === "openingHours.enabled")
        .map((error) => error.message)
    : [];

  return (
    <section
      aria-labelledby="opening-hours-heading"
      className="rounded-3xl border border-gray-200 bg-white p-6 lg:col-span-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="opening-hours-heading" className="flex items-center gap-2 text-lg font-black tracking-tight text-gray-900">
            <Clock className="h-5 w-5 text-orange-500" aria-hidden="true" />
            Ωράριο λειτουργίας
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Ώρα Ελλάδας. Δεχόμαστε παραγγελίες από την ώρα ανοίγματος έως ΠΡΙΝ την ώρα κλεισίματος.
            Κλείσιμο πριν το άνοιγμα (π.χ. 18:00–02:00) σημαίνει ότι κλείνεις την επόμενη μέρα. Κλείσιμο
            00:00 = μεσάνυχτα.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-bold text-gray-800">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={saving}
            onChange={(event) => update({ ...draft, enabled: event.target.checked })}
            className="h-4 w-4 accent-orange-500"
          />
          Εφαρμογή ωραρίου
        </label>
      </div>

      {storedInvalid && !dirty && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 p-3.5 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Το αποθηκευμένο ωράριο έχει πρόβλημα, γι&apos; αυτό το κατάστημα εμφανίζεται «Προσωρινά μη
          διαθέσιμο». Έλεγξε το ωράριο παρακάτω και αποθήκευσε ξανά.
        </p>
      )}

      {!draft.enabled && (
        <p className="mt-4 rounded-2xl bg-gray-50 p-3.5 text-sm text-gray-600">
          Το ωράριο δεν εφαρμόζεται: το κατάστημα δέχεται παραγγελίες όποτε δεν έχεις ενεργή παύση
          (όπως μέχρι τώρα). Μπορείς να το ετοιμάσεις και να το ενεργοποιήσεις όταν θέλεις.
        </p>
      )}

      {isAlwaysClosed(draft) && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-3.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Με αυτό το ωράριο το κατάστημα δεν θα δέχεται ποτέ παραγγελίες.
        </p>
      )}

      <ErrorList messages={generalErrors} />

      {/* ------------------------------ Εβδομάδα ------------------------------ */}
      <div className="mt-5 divide-y divide-gray-100 rounded-2xl border border-gray-100">
        {WEEKDAY_KEYS.map((key) => {
          const intervals = draft.weekly[key];
          const dayErrors = showErrors ? errorsByPrefix(errors, `openingHours.weekly.${key}`) : [];
          return (
            <div key={key} className={cn("grid gap-3 p-3.5 sm:grid-cols-[140px_minmax(0,1fr)]", dayErrors.length > 0 && "bg-red-50/50")}>
              <div>
                <p className="text-sm font-bold text-gray-900">{WEEKDAY_LABELS[key]}</p>
                {intervals.length === 0 && <p className="text-xs font-semibold text-gray-400">Κλειστό</p>}
              </div>
              <div>
                <IntervalsEditor
                  intervals={intervals}
                  onChange={(next) => setDay(key, next)}
                  disabled={saving}
                  labelPrefix={WEEKDAY_LABELS[key]}
                />
                <ErrorList messages={dayErrors} />
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={copyMondayToAll}
        disabled={saving}
        className="mt-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-40"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Το ωράριο της Δευτέρας σε όλες τις μέρες
      </button>

      {/* ----------------------------- Εξαιρέσεις ----------------------------- */}
      <h3 className="mt-6 text-sm font-black uppercase tracking-wider text-gray-500">
        Εξαιρέσεις (αργίες, ειδικό ωράριο)
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Μια εξαίρεση ορίζει ΟΛΗ τη μέρα (00:00–24:00) και αντικαθιστά και τη συνέχεια βραδινής βάρδιας
        της προηγούμενης μέρας. Για να μείνεις ανοιχτός π.χ. ως τις 02:00, πρόσθεσε 00:00–02:00.
      </p>

      <div className="mt-3 space-y-3">
        {draft.exceptions.map((exception, index) => {
          const exceptionErrors = showErrors ? errorsByPrefix(errors, `openingHours.exceptions.${index}`) : [];
          return (
            <div
              key={index}
              className={cn(
                "rounded-2xl border p-3.5",
                exceptionErrors.length > 0 ? "border-red-200 bg-red-50/50" : "border-gray-100",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={exception.date}
                  disabled={saving}
                  aria-label={`Ημερομηνία εξαίρεσης ${index + 1}`}
                  onChange={(event) => setException(index, { ...exception, date: event.target.value })}
                  className={inputClass}
                />
                <select
                  value={exception.closed ? "closed" : "custom"}
                  disabled={saving}
                  aria-label={`Είδος εξαίρεσης ${index + 1}`}
                  onChange={(event) =>
                    setException(
                      index,
                      event.target.value === "closed"
                        ? { ...exception, closed: true, intervals: [] }
                        : { ...exception, closed: false, intervals: exception.intervals.length > 0 ? exception.intervals : [{ open: "12:00", close: "18:00" }] },
                    )
                  }
                  className={inputClass}
                >
                  <option value="closed">Κλειστό όλη μέρα</option>
                  <option value="custom">Ειδικό ωράριο</option>
                </select>
                <input
                  type="text"
                  value={exception.label ?? ""}
                  disabled={saving}
                  maxLength={OPENING_HOURS_LIMITS.exceptionLabelMax}
                  placeholder="Σημείωση (π.χ. Χριστούγεννα)"
                  aria-label={`Σημείωση εξαίρεσης ${index + 1}`}
                  onChange={(event) => {
                    const label = event.target.value;
                    const next: OpeningHoursException = { date: exception.date, closed: exception.closed, intervals: exception.intervals };
                    setException(index, label ? { ...next, label } : next);
                  }}
                  className={cn(inputClass, "min-w-0 flex-1")}
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => update({ ...draft, exceptions: draft.exceptions.filter((_, i) => i !== index) })}
                  aria-label={`Διαγραφή εξαίρεσης ${index + 1}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {!exception.closed && (
                <div className="mt-3">
                  <IntervalsEditor
                    intervals={exception.intervals}
                    onChange={(intervals) => setException(index, { ...exception, intervals })}
                    disabled={saving}
                    labelPrefix={`Εξαίρεση ${index + 1}`}
                  />
                </div>
              )}
              <ErrorList messages={exceptionErrors} />
            </div>
          );
        })}
      </div>

      {draft.exceptions.length < OPENING_HOURS_LIMITS.maxExceptions && (
        <button
          type="button"
          onClick={addException}
          disabled={saving}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 hover:text-orange-600 disabled:opacity-40"
        >
          <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Νέα εξαίρεση
        </button>
      )}

      {/* ----------------------------- Αποθήκευση ----------------------------- */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/20 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Αποθήκευση ωραρίου
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
