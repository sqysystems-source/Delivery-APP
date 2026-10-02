"use client";

/* ==========================================================================
 *  Buka Delivery — components/options/EditCartLineDialog.tsx  (milestone 3)
 *
 *  «Επεξεργασία επιλογών» μιας γραμμής καλαθιού (από το καλάθι ή από το
 *  checkout, π.χ. μετά από option_unavailable / options_changed).
 *
 *  1. Φορτώνει το προϊόν ΟΠΩΣ ΕΙΝΑΙ ΤΩΡΑ (το καλάθι έχει μόνο στιγμιότυπο).
 *  2. Ανοίγει τον ProductOptionsDialog με τις τρέχουσες επιλογές — όσες δεν
 *     υπάρχουν/δεν είναι διαθέσιμες πια ΔΕΝ προεπιλέγονται και ο διάλογος
 *     το λέει ρητά.
 *  3. Αποθήκευση → updateLine(): αν οι νέες επιλογές συμπίπτουν με άλλη
 *     γραμμή, οι δύο ενώνονται (άθροισμα ποσοτήτων) και ανακοινώνεται.
 * ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import ProductOptionsDialog from "@/components/options/ProductOptionsDialog";
import { useCart } from "@/context/CartContext";
import { productQuantity } from "@/lib/checkout/cart";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { fetchMenuItem } from "@/lib/menu/fetch-menu-item";
import { lineKeyOf, selectionsFromOptions } from "@/lib/menu/options";
import { lockScroll } from "@/lib/scroll-lock";
import type { CartLine, MenuItem } from "@/types";

type EditCartLineDialogProps = {
  shopId: string;
  line: CartLine;
  notice?: string | null;
  onClose: () => void;
  /** Ενημέρωση για αναγνώστες οθόνης/οθόνη μετά την αποθήκευση */
  onSaved?: (message: string) => void;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; item: MenuItem }
  | { kind: "missing" }
  | { kind: "error" };

export default function EditCartLineDialog({ shopId, line, notice, onClose, onSaved }: EditCartLineDialogProps) {
  const { cart, updateLine, removeLine } = useCart();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const lineKey = lineKeyOf(line);

  useEffect(() => {
    let cancelled = false;
    fetchMenuItem(shopId, line.itemId)
      .then((item) => {
        if (!cancelled) setState(item ? { kind: "ready", item } : { kind: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, line.itemId, attempt]);

  if (state.kind === "ready") {
    const others = productQuantity(cart.lines, line.itemId, lineKey);
    return (
      <ProductOptionsDialog
        item={state.item}
        mode="edit"
        notice={notice}
        initialSelections={line.options ? selectionsFromOptions(line.options) : []}
        initialQuantity={line.quantity}
        maxQuantity={CHECKOUT_LIMITS.maxQuantityPerLine - others}
        onClose={onClose}
        onConfirm={(next) => {
          const result = updateLine(lineKey, next);
          if (!result.ok) {
            return result.reason === "product_limit"
              ? `Έως ${CHECKOUT_LIMITS.maxQuantityPerLine} τεμάχια ανά προϊόν, μαζί με τις άλλες παραλλαγές του στο καλάθι.`
              : "Η γραμμή δεν βρέθηκε πια στο καλάθι.";
          }
          onSaved?.(
            result.merged
              ? `Το «${next.name}» με αυτές τις επιλογές υπήρχε ήδη στο καλάθι — οι ποσότητες ενώθηκαν.`
              : `Οι επιλογές για «${next.name}» ενημερώθηκαν.`,
          );
          onClose();
          return null;
        }}
      />
    );
  }

  return (
    <StatusDialog
      title={line.name}
      onClose={onClose}
      busy={state.kind === "loading"}
      message={
        state.kind === "loading"
          ? "Φόρτωση επιλογών…"
          : state.kind === "missing"
            ? "Το προϊόν δεν υπάρχει πια στον κατάλογο του καταστήματος. Αφαίρεσέ το από το καλάθι."
            : "Δεν ήταν δυνατή η φόρτωση των επιλογών. Έλεγξε τη σύνδεσή σου."
      }
      action={
        state.kind === "missing"
          ? {
              label: "Αφαίρεση από το καλάθι",
              onClick: () => {
                removeLine(lineKey);
                onClose();
              },
            }
          : state.kind === "error"
            ? {
                label: "Δοκίμασε ξανά",
                onClick: () => {
                  setState({ kind: "loading" });
                  setAttempt((value) => value + 1);
                },
              }
            : null
      }
    />
  );
}

/* Μικρός προσβάσιμος διάλογος κατάστασης (φόρτωση / σφάλμα) */
function StatusDialog({
  title,
  message,
  busy,
  action,
  onClose,
}: {
  title: string;
  message: string;
  busy: boolean;
  action: { label: string; onClick: () => void } | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const release = lockScroll();
    return () => {
      release();
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            // Μόνο 1–2 στοιχεία: η εστίαση μένει μέσα στον διάλογο
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault();
            const next = event.shiftKey ? index - 1 : index + 1;
            buttons[(next + buttons.length) % buttons.length]?.focus();
          }
        }}
        className="relative w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-black text-gray-900">{title}</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-gray-700">
          {busy ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          {message}
        </p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 w-full rounded-full bg-orange-500 px-5 py-3 text-sm font-bold text-white hover:bg-orange-600"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
