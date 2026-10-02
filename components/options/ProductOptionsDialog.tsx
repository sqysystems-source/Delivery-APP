"use client";

/* ==========================================================================
 *  Buka Delivery — components/options/ProductOptionsDialog.tsx  (milestone 3)
 *
 *  Διάλογος διαμόρφωσης προϊόντος πριν μπει στο καλάθι (ή «Επεξεργασία
 *  επιλογών» μιας γραμμής που υπάρχει ήδη).
 *
 *  Δείχνει: όνομα, περιγραφή, βασική τιμή, ομάδες (υποχρεωτικές /
 *  προαιρετικές με οδηγία), αφαιρέσεις υλικών, ποσότητα, ζωντανή τιμή μονάδας
 *  και σύνολο γραμμής, και το κουμπί «Προσθήκη στο καλάθι».
 *
 *  Προσβασιμότητα:
 *    • role="dialog" + aria-modal + aria-labelledby/aria-describedby
 *    • εστίαση μπαίνει στον διάλογο, παγιδεύεται (Tab/Shift+Tab κυκλικά) και
 *      ΕΠΙΣΤΡΕΦΕΙ στο στοιχείο που τον άνοιξε όταν κλείσει
 *    • Escape κλείνει· το περιεχόμενο κυλά μέσα στον διάλογο σε μικρές οθόνες,
 *      με σταθερό κάτω μέρος (ποσότητα + κουμπί)
 *    • λάθη inline ανά ομάδα· η εστίαση πάει στην πρώτη λάθος ομάδα
 *
 *  Η τιμή εδώ είναι ΕΝΔΕΙΚΤΙΚΗ: ο server ξαναϋπολογίζει από τα ids.
 * ========================================================================== */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Minus, Plus, X } from "lucide-react";
import ProductOptionsFields, {
  groupFieldsetId,
  type SelectionState,
} from "@/components/options/ProductOptionsFields";
import { buildCartLine } from "@/lib/checkout/cart";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { centsToEuros, parseItemPriceCents } from "@/lib/checkout/money";
import {
  isConfigurationOrderable,
  previewUnitCents,
  selectionStateErrors,
  selectionsFromState,
  stateFromSelections,
  validateOptionGroups,
} from "@/lib/menu/options";
import { lockScroll } from "@/lib/scroll-lock";
import { formatPrice } from "@/lib/format";
import type { CartLine, MenuItem, OptionSelection } from "@/types";

export type ProductOptionsDialogProps = {
  item: MenuItem;
  mode: "add" | "edit";
  /** Επεξεργασία: οι τρέχουσες επιλογές της γραμμής */
  initialSelections?: readonly OptionSelection[];
  initialQuantity?: number;
  /** Πόσα τεμάχια επιτρέπονται ακόμη για ΑΥΤΟ το προϊόν (όλες οι παραλλαγές) */
  maxQuantity?: number;
  /** Μήνυμα στην κορυφή (π.χ. γιατί ζητήθηκε επεξεργασία από το checkout) */
  notice?: string | null;
  /** Επιστρέφει μήνυμα λάθους για να μείνει ανοιχτός, ή null για κλείσιμο */
  onConfirm: (line: CartLine) => string | null;
  onClose: () => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ProductOptionsDialog({
  item,
  mode,
  initialSelections = [],
  initialQuantity = 1,
  maxQuantity = CHECKOUT_LIMITS.maxQuantityPerLine,
  notice = null,
  onConfirm,
  onClose,
}: ProductOptionsDialogProps) {
  const reactId = useId();
  const idPrefix = `opt${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  const config = useMemo(() => validateOptionGroups(item.optionGroups, "read"), [item.optionGroups]);
  const groups = useMemo(() => (config.ok ? config.groups : []), [config]);
  const baseCents = parseItemPriceCents(item.price);
  const orderable = config.ok && baseCents !== null && item.available !== false && isConfigurationOrderable(groups);

  /* Αρχική κατάσταση ΜΙΑ φορά (το component ξαναστήνεται με νέο key όταν αλλάζει γραμμή) */
  const [initial] = useState(() => stateFromSelections(groups, initialSelections));
  const [selection, setSelection] = useState<SelectionState>(initial.state);
  const [quantity, setQuantity] = useState(() =>
    Math.max(1, Math.min(initialQuantity, Math.max(1, maxQuantity))),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  /* Εστίαση μέσα + επιστροφή στο στοιχείο που άνοιξε τον διάλογο */
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const release = lockScroll();
    return () => {
      release();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const unitCents = baseCents === null ? 0 : previewUnitCents(baseCents, groups, selection);
  const lineCents = unitCents * quantity;
  const canIncrease = quantity < Math.min(maxQuantity, CHECKOUT_LIMITS.maxQuantityPerLine);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const changeGroup = (groupId: string, choiceIds: string[]) => {
    const next = { ...selection, [groupId]: choiceIds };
    setSelection(next);
    setFormError(null);
    // Μετά την πρώτη απόπειρα, τα λάθη ενημερώνονται ζωντανά
    if (submitted) setErrors(selectionStateErrors(groups, next));
  };

  const handleConfirm = () => {
    setSubmitted(true);
    const nextErrors = selectionStateErrors(groups, selection);
    setErrors(nextErrors);

    const firstInvalid = groups.find((group) => nextErrors[group.id]);
    if (firstInvalid) {
      document.getElementById(groupFieldsetId(idPrefix, firstInvalid.id))?.focus();
      return;
    }

    const built = buildCartLine(item, selectionsFromState(groups, selection), quantity);
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    const error = onConfirm(built.line);
    if (error) setFormError(error);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
      >
        {/* ------------------------------ Κεφαλίδα ------------------------- */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-black tracking-tight text-gray-900">
              {item.name}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-gray-600">
              {item.description ? `${item.description} · ` : ""}
              Βασική τιμή {baseCents === null ? "—" : formatPrice(centsToEuros(baseCents))}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {/* ------------------------------ Επιλογές ------------------------- */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {notice && (
            <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {notice}
            </p>
          )}
          {initial.dropped > 0 && (
            <p className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {initial.dropped === 1
                ? "Μία από τις προηγούμενες επιλογές σου δεν υπάρχει πια ή δεν είναι διαθέσιμη. Έλεγξε τις επιλογές πριν αποθηκεύσεις."
                : `${initial.dropped} από τις προηγούμενες επιλογές σου δεν υπάρχουν πια ή δεν είναι διαθέσιμες. Έλεγξε τις επιλογές πριν αποθηκεύσεις.`}
            </p>
          )}

          {!orderable ? (
            <p className="rounded-2xl bg-gray-100 p-4 text-sm text-gray-700">
              Το προϊόν δεν μπορεί να παραγγελθεί αυτή τη στιγμή.
            </p>
          ) : (
            <ProductOptionsFields
              groups={groups}
              value={selection}
              onChange={changeGroup}
              errors={errors}
              idPrefix={idPrefix}
            />
          )}
        </div>

        {/* --------------------------- Ποσότητα + σύνολο ------------------- */}
        <footer className="shrink-0 space-y-3 border-t border-gray-100 bg-gray-50 px-5 py-4">
          <p className="sr-only" role="status" aria-live="polite">
            {`Τιμή μονάδας ${formatPrice(centsToEuros(unitCents))}, σύνολο ${formatPrice(centsToEuros(lineCents))}`}
            {errorCount > 0 ? `. Χρειάζονται διορθώσεις σε ${errorCount} ${errorCount === 1 ? "ομάδα" : "ομάδες"}.` : ""}
          </p>

          {formError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Ποσότητα"
              className="flex items-center gap-1 rounded-full border border-gray-200 bg-white p-1"
            >
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                disabled={quantity <= 1}
                aria-label="Μείωση ποσότητας"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="min-w-7 text-center text-base font-black text-gray-900">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((value) => value + 1)}
                disabled={!canIncrease}
                aria-label="Αύξηση ποσότητας"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="text-right text-xs text-gray-500">
              <p>
                {formatPrice(centsToEuros(unitCents))} / τεμ.
              </p>
              <p className="text-base font-black text-gray-900">{formatPrice(centsToEuros(lineCents))}</p>
            </div>
          </div>

          {!canIncrease && maxQuantity < CHECKOUT_LIMITS.maxQuantityPerLine && (
            <p className="text-xs text-gray-500">
              Έως {CHECKOUT_LIMITS.maxQuantityPerLine} τεμάχια ανά προϊόν, μαζί με όσα έχεις ήδη στο καλάθι.
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!orderable || maxQuantity < 1}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
          >
            {mode === "edit" ? "Αποθήκευση αλλαγών" : "Προσθήκη στο καλάθι"}
            <span aria-hidden="true">· {formatPrice(centsToEuros(lineCents))}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
