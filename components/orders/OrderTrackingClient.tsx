"use client";

/* ==========================================================================
 *  Buka Delivery — components/orders/OrderTrackingClient.tsx   (milestone 2)
 *
 *  Σελίδα παρακολούθησης μίας παραγγελίας (/orders/[orderId]).
 *
 *  • Δεδομένα ΜΟΝΟ από το Firestore, ζωντανά (hooks/useOrderTracking.ts),
 *    με τα δικαιώματα του τρέχοντος Firebase χρήστη. Το id στο URL δεν είναι
 *    εξουσιοδότηση: για ξένο ή ανύπαρκτο id η σελίδα δείχνει το ΙΔΙΟ μήνυμα.
 *  • Δεν γίνεται ποτέ anonymous sign-in εδώ: αν ο επισκέπτης έχασε το session
 *    του (καθαρισμός browser, άλλη συσκευή), το εξηγούμε με ειλικρίνεια.
 *  • Κείμενα κατάστασης από lib/orders/customer-order.ts: ποτέ «δεκτή» πριν
 *    το accepted, ποτέ «πληρώθηκε», καμία εκτίμηση χρόνου ή θέση διανομέα.
 *  • Τηλέφωνο καταστήματος ΔΕΝ εμφανίζεται: το Shop δεν έχει πεδίο τηλεφώνου.
 * ========================================================================== */

import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  LogIn,
  MapPin,
  Receipt,
  RefreshCw,
  SearchX,
  Store,
  WifiOff,
} from "lucide-react";
import OrderStatusProgress from "@/components/orders/OrderStatusProgress";
import { useAuth } from "@/context/AuthContext";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import { PAYMENT_METHOD_LABELS } from "@/lib/checkout/constants";
import {
  describeOrderStatus,
  formatOrderDate,
  type CustomerOrder,
  type StatusTone,
} from "@/lib/orders/customer-order";
import { cn, formatDeliveryFee, formatPrice } from "@/lib/format";

const TONE_STYLES: Record<StatusTone, string> = {
  waiting: "border-amber-200 bg-amber-50 text-amber-900",
  progress: "border-orange-200 bg-orange-50 text-orange-900",
  done: "border-emerald-200 bg-emerald-50 text-emerald-900",
  stopped: "border-red-200 bg-red-50 text-red-900",
  unknown: "border-gray-200 bg-gray-50 text-gray-800",
};

const TONE_ICONS: Record<StatusTone, typeof Clock3> = {
  waiting: Clock3,
  progress: Clock3,
  done: CheckCircle2,
  stopped: Ban,
  unknown: AlertTriangle,
};

/* ========================================================================== */

export default function OrderTrackingClient({ orderId }: { orderId: string }) {
  const { state, retry, isAnonymous } = useOrderTracking(orderId);
  const { isAuthenticated } = useAuth();

  return (
    <main className="bg-gray-50 pb-16">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
        <Link
          href={isAuthenticated ? "/orders" : "/"}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-orange-600"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {isAuthenticated ? "Οι παραγγελίες μου" : "Αρχική"}
        </Link>

        {state.kind === "loading" && <LoadingView offline={state.offline} />}
        {state.kind === "signed_out" && <SignedOutView />}
        {(state.kind === "unavailable" || state.kind === "invalid_id") && (
          <UnavailableView isAnonymous={isAnonymous} isAuthenticated={isAuthenticated} />
        )}
        {state.kind === "error" && (
          <>
            <div
              role="alert"
              className="mt-4 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
            >
              <p className="flex items-start gap-2 font-semibold leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Διακόπηκε η ζωντανή ενημέρωση της παραγγελίας.
                  {state.order ? " Βλέπεις την τελευταία γνωστή κατάσταση." : ""}
                </span>
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Δοκίμασε ξανά
              </button>
            </div>
            {state.order && <OrderDetails order={state.order} isAnonymous={isAnonymous} stale />}
          </>
        )}
        {state.kind === "ready" && (
          <>
            {state.offline && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700"
              >
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                <span>
                  Χωρίς σύνδεση. Βλέπεις την τελευταία γνωστή κατάσταση — θα ενημερωθεί αυτόματα
                  μόλις επανέλθει η σύνδεση.
                </span>
              </div>
            )}
            <OrderDetails order={state.order} isAnonymous={isAnonymous} stale={state.offline} />
          </>
        )}
      </div>
    </main>
  );
}

/* ============================== Καταστάσεις ============================== */

function LoadingView({ offline }: { offline: boolean }) {
  return (
    <div className="mt-4 space-y-4" aria-busy="true" aria-label="Φόρτωση παραγγελίας">
      {offline && (
        <p role="status" className="flex items-center gap-2 text-sm text-gray-600">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          Χωρίς σύνδεση — η παραγγελία θα εμφανιστεί μόλις επανέλθει η σύνδεση.
        </p>
      )}
      <div className="h-24 animate-pulse rounded-3xl bg-gray-200" />
      <div className="h-40 animate-pulse rounded-3xl bg-gray-100" />
      <div className="h-56 animate-pulse rounded-3xl bg-gray-100" />
    </div>
  );
}

function MessageCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof SearchX;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-3xl border border-gray-100 bg-white p-6 text-center shadow-sm sm:p-8">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-gray-100">
        <Icon className="h-7 w-7 text-gray-400" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-2xl font-black tracking-tight text-gray-900">{title}</h1>
      <div className="mx-auto mt-2 max-w-md space-y-3 text-sm leading-relaxed text-gray-600">
        {children}
      </div>
    </section>
  );
}

function GuestAccessExplanation() {
  return (
    <p>
      Οι παραγγελίες επισκέπτη είναι διαθέσιμες μόνο στον browser και στη συσκευή όπου έγιναν. Αν
      καθάρισες τα δεδομένα του browser ή άνοιξες τη σελίδα από άλλη συσκευή, δεν μπορούμε να σου
      τη δείξουμε — για την πορεία της επικοινώνησε με το κατάστημα, αναφέροντας τον κωδικό
      παραγγελίας.
    </p>
  );
}

function SignedOutView() {
  const { openLogin } = useAuth();
  return (
    <MessageCard icon={LogIn} title="Δεν μπορούμε να δείξουμε την παραγγελία">
      <p>Για να δεις μια παραγγελία πρέπει να είσαι συνδεδεμένος/η στον λογαριασμό που την έκανε.</p>
      <GuestAccessExplanation />
      <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={openLogin}
          className="rounded-full bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-500"
        >
          Σύνδεση
        </button>
        <Link
          href="/"
          className="rounded-full border border-gray-200 px-5 py-3 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Δες τα καταστήματα
        </Link>
      </div>
    </MessageCard>
  );
}

function UnavailableView({
  isAnonymous,
  isAuthenticated,
}: {
  isAnonymous: boolean;
  isAuthenticated: boolean;
}) {
  const { openLogin } = useAuth();
  return (
    <MessageCard icon={SearchX} title="Η παραγγελία δεν βρέθηκε">
      <p>
        Δεν βρέθηκε παραγγελία με αυτόν τον σύνδεσμο που να ανήκει{" "}
        {isAuthenticated ? "στον λογαριασμό σου" : "σε αυτή τη σύνδεση"}.
      </p>
      {isAnonymous && <GuestAccessExplanation />}
      <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row sm:justify-center">
        {isAuthenticated ? (
          <Link
            href="/orders"
            className="rounded-full bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-500"
          >
            Οι παραγγελίες μου
          </Link>
        ) : (
          <button
            type="button"
            onClick={openLogin}
            className="rounded-full bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-500"
          >
            Σύνδεση με λογαριασμό
          </button>
        )}
        <Link
          href="/"
          className="rounded-full border border-gray-200 px-5 py-3 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Αρχική
        </Link>
      </div>
    </MessageCard>
  );
}

/* ============================== Λεπτομέρειες ============================= */

function paymentSentence(order: CustomerOrder): string {
  if (order.status === "cancelled") {
    return "Η παραγγελία ακυρώθηκε, οπότε δεν θα πληρώσεις τίποτα γι' αυτήν.";
  }
  if (order.paymentMethod === null) {
    return "Ο τρόπος πληρωμής δεν καταγράφηκε σε αυτή την παλαιότερη παραγγελία.";
  }
  if (order.status === "completed") {
    return `${PAYMENT_METHOD_LABELS[order.paymentMethod]} — σύνολο ${formatPrice(order.total)}.`;
  }
  return `${PAYMENT_METHOD_LABELS[order.paymentMethod]} — θα πληρώσεις ${formatPrice(order.total)} όταν παραλάβεις την παραγγελία.`;
}

function OrderDetails({
  order,
  isAnonymous,
  stale = false,
}: {
  order: CustomerOrder;
  isAnonymous: boolean;
  stale?: boolean;
}) {
  const copy = describeOrderStatus(order.status, order.cancelReason);
  const ToneIcon = TONE_ICONS[copy.tone];

  return (
    <div className="mt-4 space-y-4">
      {/* ------------------------------ Επικεφαλίδα ----------------------------- */}
      <header className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Παραγγελία</p>
        <h1 className="mt-1 font-mono text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
          {order.code}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900">
            <Store className="h-4 w-4 text-orange-500" aria-hidden="true" />
            {order.shopName}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatOrderDate(order.createdAt)}</span>
        </p>
      </header>

      {/* ------------------------------- Κατάσταση ------------------------------ */}
      <section
        aria-labelledby="order-status-heading"
        className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"
      >
        <h2 id="order-status-heading" className="sr-only">
          Κατάσταση παραγγελίας
        </h2>

        <div className={cn("rounded-2xl border p-4", TONE_STYLES[copy.tone])}>
          {/* Ζωντανή ανακοίνωση κάθε αλλαγής κατάστασης */}
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-lg font-black">
            <ToneIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
            {copy.label}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{copy.description}</p>
          {stale && (
            <p className="mt-2 text-xs font-semibold">Μπορεί να έχει αλλάξει από τότε.</p>
          )}
        </div>

        <div className="mt-5">
          <OrderStatusProgress status={order.status} />
        </div>

        {order.updatedAt && order.status !== "pending" && (
          <p className="mt-4 text-xs text-gray-500">
            Τελευταία ενημέρωση από το κατάστημα: {formatOrderDate(order.updatedAt)}
          </p>
        )}
      </section>

      {/* ------------------------------- Προϊόντα ------------------------------- */}
      <section
        aria-labelledby="order-items-heading"
        className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"
      >
        <h2
          id="order-items-heading"
          className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-500"
        >
          <Receipt className="h-4 w-4" aria-hidden="true" />
          Τι παρήγγειλες
        </h2>
        <ul className="mt-2 divide-y divide-gray-100">
          {order.lines.map((line) => (
            <li key={line.itemId} className="flex items-start justify-between gap-3 py-2.5">
              <span className="text-sm text-gray-800">
                <span className="font-bold">{line.quantity}×</span> {line.name}
              </span>
              <span className="shrink-0 text-sm font-bold text-gray-900">
                {formatPrice(line.lineTotal)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1.5 border-t border-dashed border-gray-200 pt-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <dt>Υποσύνολο</dt>
            <dd className="font-semibold text-gray-900">{formatPrice(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-gray-600">
            <dt>Μεταφορικά</dt>
            <dd className="font-semibold text-gray-900">{formatDeliveryFee(order.deliveryFee)}</dd>
          </div>
          <div className="flex items-center justify-between pt-1 text-base">
            <dt className="font-black text-gray-900">Σύνολο</dt>
            <dd className="text-xl font-black text-gray-900">{formatPrice(order.total)}</dd>
          </div>
        </dl>
      </section>

      {/* -------------------------- Παράδοση & πληρωμή -------------------------- */}
      <section
        aria-labelledby="order-delivery-heading"
        className="space-y-3 rounded-3xl border border-gray-100 bg-white p-5 text-sm shadow-sm sm:p-6"
      >
        <h2 id="order-delivery-heading" className="sr-only">
          Παράδοση και πληρωμή
        </h2>
        <p className="flex items-start gap-2 text-gray-700">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
          <span>
            Παράδοση σε:{" "}
            <span className="font-semibold text-gray-900">{order.address || "—"}</span>
            {order.delivery?.floor && <> · Όροφος {order.delivery.floor}</>}
            {order.delivery?.doorbell && <> · Κουδούνι «{order.delivery.doorbell}»</>}
          </span>
        </p>
        <p className="flex items-start gap-2 text-gray-700">
          <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>{paymentSentence(order)}</span>
        </p>
        <p className="flex items-start gap-2 text-gray-600">
          <Store className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span>
            Για αλλαγές ή ερωτήσεις επικοινώνησε απευθείας με το κατάστημα, αναφέροντας τον κωδικό{" "}
            <span className="font-mono font-bold text-gray-900">{order.code}</span>.
            {order.shopId && (
              <>
                {" "}
                <Link
                  href={`/shop/${encodeURIComponent(order.shopId)}`}
                  className="font-semibold text-orange-600 underline-offset-2 hover:underline"
                >
                  Σελίδα καταστήματος
                </Link>
              </>
            )}
          </span>
        </p>
      </section>

      {isAnonymous && (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-600">
          Παρήγγειλες ως επισκέπτης. Αυτή η σελίδα ανοίγει μόνο από αυτόν τον browser — αν καθαρίσεις
          τα δεδομένα του ή χρησιμοποιήσεις άλλη συσκευή, δεν θα μπορούμε να σου δείξουμε την
          παραγγελία. Κράτα τον κωδικό <span className="font-mono font-bold">{order.code}</span>.
        </p>
      )}
    </div>
  );
}
