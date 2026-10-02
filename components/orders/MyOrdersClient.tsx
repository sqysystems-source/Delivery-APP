"use client";

/* ==========================================================================
 *  Buka Delivery — components/orders/MyOrdersClient.tsx   (milestone 2)
 *
 *  /orders — «Οι παραγγελίες μου».
 *
 *   • Εγγεγραμμένος χρήστης: λίστα με σελίδες των 10, query με τον uid του
 *     Firebase Auth, ταξινόμηση με την ώρα δημιουργίας του SERVER.
 *   • Επισκέπτης (ανώνυμος Firebase χρήστης): η τελευταία επιτυχημένη
 *     παραγγελία σε αυτόν τον browser — μόνο αν ανήκει στον ΤΡΕΧΟΝΤΑ uid.
 *     Η αναφορά στο localStorage δεν είναι εξουσιοδότηση· η σελίδα
 *     παρακολούθησης ρωτά πάντα το Firestore με τα rules.
 *   • Κανένα session: εξήγηση + σύνδεση. Δεν δημιουργούμε anonymous χρήστη.
 * ========================================================================== */

import Link from "next/link";
import {
  ChevronRight,
  Info,
  Loader2,
  LogIn,
  Receipt,
  RefreshCw,
  ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useMyOrders } from "@/hooks/useMyOrders";
import { useLastOrder } from "@/lib/orders/last-order";
import {
  describeOrderStatus,
  formatOrderDate,
  orderCodeFromId,
  type CustomerOrder,
  type StatusTone,
} from "@/lib/orders/customer-order";
import { cn, formatPrice } from "@/lib/format";

const BADGE_STYLES: Record<StatusTone, string> = {
  waiting: "bg-amber-100 text-amber-800",
  progress: "bg-orange-100 text-orange-800",
  done: "bg-emerald-100 text-emerald-800",
  stopped: "bg-red-100 text-red-700",
  unknown: "bg-gray-200 text-gray-700",
};

export default function MyOrdersClient() {
  const { user, loading, isAuthenticated, openLogin } = useAuth();
  const registeredUid = isAuthenticated && user ? user.uid : null;
  const guestUid = user?.isAnonymous ? user.uid : null;

  return (
    <main className="bg-gray-50 pb-16">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
        <h1 className="text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
          Οι παραγγελίες μου
        </h1>

        {loading ? (
          <div className="mt-6 space-y-3" aria-busy="true" aria-label="Φόρτωση">
            <div className="h-24 animate-pulse rounded-3xl bg-gray-200" />
            <div className="h-24 animate-pulse rounded-3xl bg-gray-100" />
          </div>
        ) : registeredUid ? (
          <RegisteredOrders uid={registeredUid} />
        ) : guestUid ? (
          <GuestLastOrder uid={guestUid} onLogin={openLogin} />
        ) : (
          <section className="mt-6 rounded-3xl border border-gray-100 bg-white p-6 text-center shadow-sm">
            <p className="text-sm leading-relaxed text-gray-600">
              Συνδέσου για να δεις τις παραγγελίες του λογαριασμού σου. Οι παραγγελίες επισκέπτη
              είναι διαθέσιμες μόνο στον browser όπου έγιναν.
            </p>
            <button
              type="button"
              onClick={openLogin}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-500"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Σύνδεση
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

/* ============================== Εγγεγραμμένος ============================ */

function RegisteredOrders({ uid }: { uid: string }) {
  const { orders, loading, loadingMore, hasMore, error, loadMore, reload } = useMyOrders(uid);

  if (loading) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true" aria-label="Φόρτωση παραγγελιών">
        <div className="h-24 animate-pulse rounded-3xl bg-gray-200" />
        <div className="h-24 animate-pulse rounded-3xl bg-gray-100" />
        <div className="h-24 animate-pulse rounded-3xl bg-gray-100" />
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div role="alert" className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Δοκίμασε ξανά
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <section className="mt-6 rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gray-100">
          <ShoppingBag className="h-7 w-7 text-gray-400" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-black text-gray-900">Δεν έχεις παραγγελίες ακόμη</h2>
        <p className="mt-1 text-sm text-gray-600">Όταν παραγγείλεις, θα εμφανίζονται εδώ.</p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600"
        >
          Δες τα καταστήματα
        </Link>
      </section>
    );
  }

  return (
    <div className="mt-6">
      <ul className="space-y-3" aria-label="Παραγγελίες">
        {orders.map((order) => (
          <li key={order.id}>
            <OrderRow order={order} />
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-amber-800">
          {error}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mx-auto mt-5 flex items-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-60"
        >
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loadingMore ? "Φόρτωση…" : "Περισσότερες παραγγελίες"}
        </button>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: CustomerOrder }) {
  const copy = describeOrderStatus(order.status, order.cancelReason);
  return (
    <Link
      href={`/orders/${encodeURIComponent(order.id)}`}
      className="flex items-center gap-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-orange-200 hover:shadow-md sm:p-5"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50">
        <Receipt className="h-5 w-5 text-orange-500" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-base font-bold text-gray-900">{order.shopName}</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-black", BADGE_STYLES[copy.tone])}>
            {copy.label}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-gray-500">
          <span className="font-mono font-bold text-gray-700">{order.code}</span> ·{" "}
          {formatOrderDate(order.createdAt)} · {order.itemCount}{" "}
          {order.itemCount === 1 ? "προϊόν" : "προϊόντα"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-black text-gray-900">{formatPrice(order.total)}</span>
        <ChevronRight className="ml-auto mt-0.5 h-4 w-4 text-gray-400" aria-hidden="true" />
      </span>
    </Link>
  );
}

/* ================================ Επισκέπτης ============================== */

function GuestLastOrder({ uid, onLogin }: { uid: string; onLogin: () => void }) {
  const lastOrder = useLastOrder(uid);

  return (
    <div className="mt-6 space-y-4">
      {lastOrder ? (
        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
            Η τελευταία σου παραγγελία σε αυτόν τον browser
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-gray-900">
            {orderCodeFromId(lastOrder.orderId)}
          </p>
          <Link
            href={`/orders/${encodeURIComponent(lastOrder.orderId)}`}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600"
          >
            Παρακολούθηση παραγγελίας
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <section className="rounded-3xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-black text-gray-900">Δεν βρέθηκε πρόσφατη παραγγελία</h2>
          <p className="mt-1 text-sm text-gray-600">
            Δεν υπάρχει παραγγελία επισκέπτη αποθηκευμένη σε αυτόν τον browser.
          </p>
        </section>
      )}

      <p className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        <span>
          Ως επισκέπτης βλέπεις μόνο την τελευταία παραγγελία σου, και μόνο από αυτόν τον browser. Αν
          καθαρίσεις τα δεδομένα του ή αλλάξεις συσκευή, η πρόσβαση χάνεται — για την πορεία μιας
          παραγγελίας επικοινώνησε τότε με το κατάστημα. Έχεις λογαριασμό;{" "}
          <button type="button" onClick={onLogin} className="font-bold text-orange-600 hover:underline">
            Σύνδεση
          </button>
        </span>
      </p>
    </div>
  );
}
