"use client";

/* ==========================================================================
 *  Buka Delivery — components/CartDrawer.tsx
 *
 *  Όλο το UI του καλαθιού σε ένα σημείο:
 *
 *  1. <CartDrawer />        — global overlay. Μπαίνει ΜΙΑ φορά στο layout:
 *                             floating μπάρα σε κινητό, bottom sheet / modal
 *                             και το modal «Νέα παραγγελία;» για σύγκρουση
 *                             καταστημάτων.
 *  2. <CartPanel />         — inline sticky sidebar για desktop, μπαίνει στη
 *                             σελίδα του καταστήματος.
 *  3. <CartLines />, <CartSummary /> — τα κοινά κομμάτια που μοιράζονται.
 *
 *  Όλη η κατάσταση έρχεται από το useCart().
 *
 *  ── ΥΠΟΒΟΛΗ ─────────────────────────────────────────────────────────────
 *  Το καλάθι ΔΕΝ υποβάλλει πια παραγγελία. Και στο κινητό (bottom sheet) και
 *  στο desktop (CartPanel) το κουμπί οδηγεί στο /checkout, όπου ο πελάτης
 *  συμπληρώνει στοιχεία, βλέπει τη σύνοψη και επιβεβαιώνει ρητά.
 *
 *  ── ΕΠΙΛΟΓΕΣ (milestone 3) ──────────────────────────────────────────────
 *  Κάθε γραμμή αναγνωρίζεται από itemId + επιλογές (lineKeyOf). Κάτω από το
 *  όνομα φαίνονται μέγεθος/έξτρα/αφαιρέσεις, και οι γραμμές με επιλογές έχουν
 *  «Επεξεργασία» (EditCartLineDialog). Το «+» σέβεται το όριο ανά προϊόν για
 *  όλες τις παραλλαγές μαζί.
 * ========================================================================== */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  MapPin,
  Minus,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import EditCartLineDialog from "@/components/options/EditCartLineDialog";
import LineOptionsSummary from "@/components/options/LineOptionsSummary";
import { useCart } from "@/context/CartContext";
import { productQuantity } from "@/lib/checkout/cart";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { centsToEuros, toCents } from "@/lib/checkout/money";
import { lineKeyOf } from "@/lib/menu/options";
import type { CartLine } from "@/types";
import { cn, formatDeliveryFee, formatPrice } from "@/lib/format";

const CHECKOUT_PATH = "/checkout";

/* ==========================================================================
 *  1. GLOBAL OVERLAY
 * ========================================================================== */

export default function CartDrawer() {
  const {
    cart,
    totals,
    hydrated,
    isCartOpen,
    openCart,
    closeCart,
    clearCart,
    pendingItem,
    confirmPendingItem,
    cancelPendingItem,
  } = useCart();
  const pathname = usePathname();

  /* Στο /checkout η σελίδα έχει δικό της κουμπί επιβεβαίωσης — η floating
   * μπάρα θα το σκέπαζε και θα οδηγούσε στην ίδια σελίδα. */
  const showFloatingBar =
    hydrated && totals.itemCount > 0 && !isCartOpen && pathname !== CHECKOUT_PATH;

  return (
    <>
      {/* ------------------- Floating μπάρα (μόνο σε κινητό) -------------- */}
      {showFloatingBar && (
        <button
          type="button"
          onClick={openCart}
          className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between gap-3 rounded-2xl bg-orange-500 px-5 py-4 text-white shadow-2xl shadow-orange-500/40 transition-all duration-300 hover:bg-orange-600 active:scale-[0.98] lg:hidden"
        >
          <span className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <ShoppingBag className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-black text-orange-600">
                {totals.itemCount}
              </span>
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs font-medium text-orange-100">
                {cart.shop?.name}
              </span>
              <span className="text-sm font-bold">Δες το καλάθι</span>
            </span>
          </span>
          <span className="text-lg font-black">{formatPrice(totals.subtotal)}</span>
        </button>
      )}

      {/* ------------------- Bottom sheet (mobile) / modal --------------- */}
      {isCartOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Το καλάθι σου"
        >
          <div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            onClick={closeCart}
          />

          <div className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                  <ShoppingBag className="h-5 w-5 text-orange-500" />
                  Το καλάθι σου
                </h2>
                {cart.shop && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    από {cart.shop.name}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {cart.lines.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-xs font-semibold text-gray-400 transition-colors hover:text-red-500"
                  >
                    Άδειασμα
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeCart}
                  aria-label="Κλείσιμο καλαθιού"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <CartLines />
            </div>

            <CartSummary />
          </div>
        </div>
      )}

      {/* ----------- Modal σύγκρουσης: καλάθι από άλλο κατάστημα --------- */}
      {pendingItem && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Νέα παραγγελία"
        >
          <div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            onClick={cancelPendingItem}
          />

          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100">
              <AlertTriangle className="h-7 w-7 text-orange-600" />
            </span>

            <h3 className="mt-4 text-xl font-black tracking-tight text-gray-900">
              Νέα παραγγελία;
            </h3>

            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Το καλάθι σου έχει ήδη προϊόντα από{" "}
              <span className="font-bold text-gray-900">{cart.shop?.name}</span>. Αν
              συνεχίσεις, θα αδειάσει για να παραγγείλεις από{" "}
              <span className="font-bold text-gray-900">{pendingItem.shop.name}</span>.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmPendingItem}
                className="w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 active:scale-95"
              >
                Άδειασμα &amp; προσθήκη
              </button>
              <button
                type="button"
                onClick={cancelPendingItem}
                className="w-full rounded-full px-6 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
              >
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
 *  2. DESKTOP SIDEBAR
 * ========================================================================== */

export function CartPanel({ className }: { className?: string }) {
  const { cart, clearCart } = useCart();

  return (
    <div
      className={cn(
        "sticky top-24 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
            <ShoppingBag className="h-5 w-5 text-orange-500" />
            Το καλάθι σου
          </h2>
          {cart.shop && (
            <p className="mt-0.5 truncate text-xs text-gray-500">από {cart.shop.name}</p>
          )}
        </div>

        {cart.lines.length > 0 && (
          <button
            type="button"
            onClick={clearCart}
            className="shrink-0 text-xs font-semibold text-gray-400 transition-colors hover:text-red-500"
          >
            Άδειασμα
          </button>
        )}
      </div>

      <div className="max-h-[calc(100vh-24rem)] overflow-y-auto px-5 py-4">
        <CartLines />
      </div>

      <CartSummary />
    </div>
  );
}

/* ==========================================================================
 *  3. ΠΕΡΙΕΧΟΜΕΝΟ ΚΑΛΑΘΙΟΥ
 * ========================================================================== */

export function CartLines() {
  const { cart, hydrated, increase, decrease, removeLine } = useCart();
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /* ----------------------- Φόρτωση από storage ---------------------- */
  if (!hydrated) {
    return (
      <div className="space-y-3">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-2xl border border-gray-100 bg-gray-50"
          />
        ))}
      </div>
    );
  }

  /* --------------------------- Άδειο καλάθι ------------------------- */
  if (cart.lines.length === 0) {
    return (
      <div className="py-10 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100">
          <ShoppingBag className="h-8 w-8 text-gray-400" />
        </span>
        <p className="mt-5 text-base font-bold text-gray-900">
          Το καλάθι σου είναι άδειο
        </p>
        <p className="mt-1.5 text-sm text-gray-500">
          Πρόσθεσε προϊόντα από τον κατάλογο για να ξεκινήσεις.
        </p>
      </div>
    );
  }

  /* --------------------------- Γραμμές ------------------------------ */
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <ul className="space-y-3">
        {cart.lines.map((line) => {
          const key = lineKeyOf(line);
          const atProductLimit =
            productQuantity(cart.lines, line.itemId) >= CHECKOUT_LIMITS.maxQuantityPerLine;
          const hasOptions = Boolean(line.options && line.options.length > 0);

          return (
            <li
              key={key}
              className="flex items-start gap-3 rounded-2xl border border-gray-100 p-3 transition-colors duration-300 hover:border-orange-200 hover:bg-orange-50/40"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-900">{line.name}</p>
                <LineOptionsSummary options={line.options} />
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatPrice(line.unitPrice)} / τεμ.
                </p>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <div className="flex w-fit items-center gap-1 rounded-full border border-gray-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => decrease(key)}
                      aria-label={`Μείωση ποσότητας για ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-orange-600"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-5 text-center text-sm font-black text-gray-900">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => increase(key)}
                      disabled={atProductLimit}
                      aria-label={`Αύξηση ποσότητας για ${line.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {hasOptions && cart.shop && (
                    <button
                      type="button"
                      onClick={() => setEditing(line)}
                      aria-haspopup="dialog"
                      aria-label={`Επεξεργασία επιλογών για ${line.name}`}
                      className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold text-orange-600 transition-colors hover:bg-orange-50"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Επεξεργασία
                    </button>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-sm font-black text-gray-900">
                  {formatPrice(centsToEuros(toCents(line.unitPrice) * line.quantity))}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(key)}
                  aria-label={`Αφαίρεση ${line.name} από το καλάθι`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editing && cart.shop && (
        <EditCartLineDialog
          key={lineKeyOf(editing)}
          shopId={cart.shop.id}
          line={editing}
          onClose={() => setEditing(null)}
          onSaved={setAnnouncement}
        />
      )}
    </>
  );
}

/* ==========================================================================
 *  4. ΣΥΝΟΨΗ + ΣΥΝΕΧΕΙΑ ΣΤΟ ΤΑΜΕΙΟ
 * ========================================================================== */

export function CartSummary() {
  const { cart, totals, deliveryAddress, orderNotes, setOrderNotes, closeCart } = useCart();
  const [showNotes, setShowNotes] = useState(false);

  if (cart.lines.length === 0) return null;

  const notesOpen = showNotes || orderNotes.length > 0;

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
      {/* ------------------------- Σχόλια παραγγελίας ------------------- */}
      {notesOpen ? (
        <div className="mb-3">
          <label htmlFor="cart-order-notes" className="sr-only">
            Σχόλια παραγγελίας
          </label>
          <textarea
            id="cart-order-notes"
            value={orderNotes}
            onChange={(event) => setOrderNotes(event.target.value)}
            rows={2}
            maxLength={CHECKOUT_LIMITS.maxNotesLength}
            placeholder="π.χ. χρειαζόμαστε μαχαιροπίρουνα"
            className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-orange-400"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="mb-3 text-xs font-semibold text-orange-600 transition-colors hover:text-orange-700"
        >
          + Προσθήκη σχολίου στην παραγγελία
        </button>
      )}

      {/* ------------------------------ Σύνολα -------------------------- */}
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between text-gray-600">
          <span>Υποσύνολο</span>
          <span className="font-semibold text-gray-900">{formatPrice(totals.subtotal)}</span>
        </div>

        <div className="flex items-center justify-between text-gray-600">
          <span>Μεταφορικά</span>
          <span
            className={cn(
              "font-semibold",
              totals.deliveryFee === 0 ? "text-emerald-600" : "text-gray-900",
            )}
          >
            {formatDeliveryFee(totals.deliveryFee)}
          </span>
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-2.5 text-base">
          <span className="font-bold text-gray-900">Σύνολο</span>
          <span className="text-xl font-black text-gray-900">{formatPrice(totals.total)}</span>
        </div>
      </div>

      {/* --------------------------- Διεύθυνση -------------------------- */}
      <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
        {deliveryAddress ? (
          <span>
            Παράδοση σε:{" "}
            <span className="font-semibold text-gray-700">
              {deliveryAddress.street}
              {deliveryAddress.city ? `, ${deliveryAddress.city}` : ""}
            </span>
          </span>
        ) : (
          <span>Τη διεύθυνση παράδοσης τη συμπληρώνεις στο επόμενο βήμα.</span>
        )}
      </p>

      {/* ----------------------- Ελάχιστη παραγγελία -------------------- */}
      {totals.missingForMinOrderCents > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Πρόσθεσε ακόμη {formatPrice(totals.missingForMinOrder)} για να φτάσεις την ελάχιστη
          παραγγελία των {formatPrice(totals.minOrder)}.
        </p>
      )}

      {/* ----------------------- Συνέχεια στο ταμείο -------------------- */}
      <Link
        href={CHECKOUT_PATH}
        onClick={closeCart}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 active:scale-95"
      >
        Συνέχεια στο ταμείο
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
