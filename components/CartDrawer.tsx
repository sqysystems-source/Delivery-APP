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
 *  Όλη η κατάσταση έρχεται από το useCart(): τα components εδώ δεν κρατούν
 *  δικό τους state πέρα από το πεδίο σχολίων.
 * ========================================================================== */

import { useState } from "react";
import {
  ChevronRight,
  Loader2,
  MapPin,
  Minus,
  PartyPopper,
  Plus,
  ShoppingBag,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";
import { useCart } from "@/context/CartContext";
import { cn, formatDeliveryFee, formatPrice } from "@/lib/format";

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
    orderState,
    pendingItem,
    confirmPendingItem,
    cancelPendingItem,
  } = useCart();

  const showFloatingBar = hydrated && totals.itemCount > 0 && !isCartOpen;

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
                {cart.lines.length > 0 && orderState !== "done" && (
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
  const { cart, clearCart, orderState } = useCart();

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

        {cart.lines.length > 0 && orderState !== "done" && (
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
  const {
    cart,
    hydrated,
    increase,
    decrease,
    removeLine,
    orderState,
    orderCode,
    resetOrder,
    closeCart,
  } = useCart();

  /* --------------------------- Επιτυχία ----------------------------- */
  if (orderState === "done") {
    return (
      <div className="py-8 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
          <PartyPopper className="h-8 w-8 text-emerald-600" />
        </span>

        <h3 className="mt-5 text-xl font-black tracking-tight text-gray-900">
          Η παραγγελία καταχωρήθηκε!
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Το κατάστημα ενημερώθηκε και ετοιμάζει ήδη το φαγητό σου.
        </p>

        {orderCode && (
          <p className="mt-4 inline-block rounded-full bg-gray-100 px-4 py-2 text-sm font-bold tracking-wider text-gray-700">
            Κωδικός: {orderCode}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            resetOrder();
            closeCart();
          }}
          className="mt-6 w-full rounded-full bg-gray-900 px-6 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-500"
        >
          Νέα παραγγελία
        </button>
      </div>
    );
  }

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
    <ul className="space-y-3">
      {cart.lines.map((line) => (
        <li
          key={line.itemId}
          className="flex items-start gap-3 rounded-2xl border border-gray-100 p-3 transition-colors duration-300 hover:border-orange-200 hover:bg-orange-50/40"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900">{line.name}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatPrice(line.unitPrice)} / τεμ.
            </p>

            <div className="mt-2.5 flex w-fit items-center gap-1 rounded-full border border-gray-200 bg-white p-1">
              <button
                type="button"
                onClick={() => decrease(line.itemId)}
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
                onClick={() => increase(line.itemId)}
                aria-label={`Αύξηση ποσότητας για ${line.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-sm font-black text-gray-900">
              {formatPrice(line.unitPrice * line.quantity)}
            </span>
            <button
              type="button"
              onClick={() => removeLine(line.itemId)}
              aria-label={`Αφαίρεση ${line.name} από το καλάθι`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ==========================================================================
 *  4. ΣΥΝΟΨΗ + CHECKOUT
 * ========================================================================== */

export function CartSummary() {
  const { cart, totals, address, orderState, placeOrder } = useCart();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  /* Δεν εμφανίζεται σε άδειο καλάθι ή μετά την επιτυχή παραγγελία */
  if (cart.lines.length === 0 || orderState === "done") return null;

  const sending = orderState === "sending";

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
      {/* ------------------------- Σχόλια παραγγελίας ------------------- */}
      {showNotes ? (
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={200}
          placeholder="π.χ. χωρίς κρεμμύδι, κουδούνι 2ος όροφος…"
          className="mb-3 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-orange-400"
        />
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
          <span className="font-semibold text-gray-900">
            {formatPrice(totals.subtotal)}
          </span>
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
          <span className="text-xl font-black text-gray-900">
            {formatPrice(totals.total)}
          </span>
        </div>
      </div>

      {/* --------------------------- Διεύθυνση -------------------------- */}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-orange-500" />
        Παράδοση σε: <span className="font-semibold text-gray-700">{address}</span>
      </p>

      {/* ----------------------- Ελάχιστη παραγγελία -------------------- */}
      {totals.missingForMinOrder > 0 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Πρόσθεσε ακόμη {formatPrice(totals.missingForMinOrder)} για να φτάσεις την
          ελάχιστη παραγγελία των {formatPrice(totals.minOrder)}.
        </p>
      )}

      {/* ------------------------------ Σφάλμα -------------------------- */}
      {orderState === "error" && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Κάτι πήγε στραβά με την αποστολή. Δοκίμασε ξανά σε λίγο.
        </p>
      )}

      {/* ----------------------------- Checkout ------------------------- */}
      <button
        type="button"
        onClick={() => placeOrder(notes.trim() || undefined)}
        disabled={!totals.canCheckout || sending}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Αποστολή…
          </>
        ) : (
          <>
            Ολοκλήρωση παραγγελίας
            <ChevronRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
