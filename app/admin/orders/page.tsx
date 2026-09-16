"use client";

/* ==========================================================================
 *  Buka Delivery — app/admin/orders/page.tsx
 *
 *  Ταμπλό παραγγελιών για το tablet της ταμειακής. Kanban σε τρεις στήλες,
 *  ζωντανή ενημέρωση με onSnapshot, ηχητικός συναγερμός σε βρόχο.
 *
 *  ── ΣΧΕΔΙΑΣΤΙΚΕΣ ΑΠΟΦΑΣΕΙΣ ΓΙΑ ΧΡΗΣΗ ΣΕ ΚΟΥΖΙΝΑ ────────────────────────
 *  • Στόχοι αφής ≥ 56px: το προσωπικό αγγίζει την οθόνη βιαστικά, συχνά με
 *    λαδωμένα χέρια ή γάντια
 *  • Μεγάλα, χοντρά νούμερα: η οθόνη διαβάζεται από απόσταση ενός μέτρου
 *  • Οι νέες παραγγελίες πάλλονται με κόκκινο — φαίνεται και με την άκρη
 *    του ματιού, ακόμη κι αν ο ήχος είναι κλειστός
 *  • Η παλαιότερη εκκρεμής παραγγελία μπαίνει ΠΑΝΩ-ΠΑΝΩ: αυτή περιμένει
 *    περισσότερο, αυτή πρέπει να φύγει πρώτη
 *  • Wake Lock: η οθόνη του tablet δεν σβήνει όσο το ταμπλό είναι ανοιχτό
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bell,
  BellOff,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Play,
  Printer,
  Radio,
  RefreshCw,
  ShoppingBag,
  Volume2,
  X,
} from "lucide-react";
import { useAdminOrders, type AdminOrder } from "@/hooks/useAdminOrders";
import { useOrderAlert } from "@/hooks/useOrderAlert";
import { cn, formatPrice } from "@/lib/format";
import type { OrderStatus } from "@/types";

/* ==========================================================================
 *  Βοηθητικά
 * ========================================================================== */

/** «μόλις τώρα» · «πριν 4'» · «πριν 1ω 12'» */
function timeAgo(date: Date | null, now: number): string {
  if (!date) return "μόλις τώρα";

  const minutes = Math.floor((now - date.getTime()) / 60000);
  if (minutes < 1) return "μόλις τώρα";
  if (minutes < 60) return `πριν ${minutes}'`;

  const hours = Math.floor(minutes / 60);
  return `πριν ${hours}ω ${minutes % 60}'`;
}

function clockTime(date: Date | null): string {
  if (!date) return "--:--";
  return date.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
}

function countItems(order: AdminOrder): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

/* --------------------------------------------------------------------------
 *  Εκτύπωση απόδειξης — ΠΡΟΣΩΡΙΝΟ placeholder
 *
 *  Η πλήρης υλοποίηση θα στέλνει ESC/POS bytes σε θερμικό εκτυπωτή μέσω
 *  Web Bluetooth:
 *
 *    const device = await navigator.bluetooth.requestDevice({
 *      filters: [{ services: ["000018f0-0000-1000-8000-00805f9b34fb"] }],
 *    });
 *    const server = await device.gatt.connect();
 *    const service = await server.getPrimaryService("000018f0-...");
 *    const characteristic = await service.getCharacteristic("00002af1-...");
 *    await characteristic.writeValue(encodeEscPos(order));
 *
 *  Το encodeEscPos() θα χτίζει Uint8Array με τις εντολές:
 *    ESC @      (0x1B 0x40)  αρχικοποίηση
 *    ESC a 1    (0x1B 0x61 0x01)  κεντράρισμα
 *    GS ! 0x11  (0x1D 0x21 0x11)  διπλό ύψος/πλάτος για τον κωδικό
 *    GS V 0x00  (0x1D 0x56 0x00)  κόψιμο χαρτιού
 *
 *  ΠΡΟΣΟΧΗ στα ελληνικά: οι περισσότεροι θερμικοί εκτυπωτές θέλουν code page
 *  CP737 ή ISO-8859-7 (ESC t n) — σκέτο UTF-8 βγάζει κινέζικα.
 * -------------------------------------------------------------------------- */

function printReceipt(order: AdminOrder): void {
  const separator = "-".repeat(32);

  const receipt = [
    "      BUKA DELIVERY",
    order.shopName,
    separator,
    `Κωδικός: ${order.code}`,
    `Ώρα: ${clockTime(order.createdAt)}`,
    `Διεύθυνση: ${order.address}`,
    separator,
    ...order.lines.map(
      (line) =>
        `${String(line.quantity).padStart(2, " ")}x ${line.name}`.padEnd(24, " ") +
        formatPrice(line.lineTotal).padStart(8, " "),
    ),
    separator,
    `Υποσύνολο:`.padEnd(24, " ") + formatPrice(order.subtotal).padStart(8, " "),
    `Μεταφορικά:`.padEnd(24, " ") + formatPrice(order.deliveryFee).padStart(8, " "),
    `ΣΥΝΟΛΟ:`.padEnd(24, " ") + formatPrice(order.total).padStart(8, " "),
    separator,
    order.notes ? `Σχόλιο: ${order.notes}` : "",
    "",
    "   Ευχαριστούμε!",
  ]
    .filter(Boolean)
    .join("\n");

  console.log("🖨️ [ESC/POS placeholder] Απόδειξη προς εκτύπωση:\n\n" + receipt);
  console.log("🖨️ Πλήρες αντικείμενο παραγγελίας:", order);
}

/* --------------------------------------------------------------------------
 *  Χάρτες κατάστασης
 * -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Νέα",
  accepted: "Αποδεκτή",
  preparing: "Ετοιμάζεται",
  delivering: "Σε παράδοση",
  completed: "Ολοκληρώθηκε",
  cancelled: "Ακυρώθηκε",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-red-100 text-red-700",
  accepted: "bg-blue-100 text-blue-700",
  preparing: "bg-amber-100 text-amber-700",
  delivering: "bg-violet-100 text-violet-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-gray-200 text-gray-600",
};

const NEXT_STEP: Partial<Record<OrderStatus, { label: string; next: OrderStatus }>> = {
  pending: { label: "Αποδοχή", next: "accepted" },
  accepted: { label: "Ξεκίνησε προετοιμασία", next: "preparing" },
  preparing: { label: "Προς παράδοση", next: "delivering" },
  delivering: { label: "Ολοκληρώθηκε", next: "completed" },
};

/* Ελάχιστος τύπος για το Wake Lock API — δεν υπάρχει σε όλες τις εκδόσεις TS */
type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

/* ==========================================================================
 *  ΣΕΛΙΔΑ
 * ========================================================================== */

export default function AdminOrdersPage() {
  const {
    shopName,
    pendingOrders,
    activeOrders,
    completedOrders,
    loading,
    error,
    updateStatus,
    updatingId,
  } = useAdminOrders();

  const alert = useOrderAlert();

  const [armed, setArmed] = useState(false);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  /* ---------------------- Ρολόι για τα «πριν X'» ------------------------ */
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------------ Wake Lock ----------------------------- */
  const requestWakeLock = useCallback(async () => {
    const navigatorWithWakeLock = navigator as NavigatorWithWakeLock;
    if (!navigatorWithWakeLock.wakeLock) return;

    try {
      wakeLockRef.current = await navigatorWithWakeLock.wakeLock.request("screen");
    } catch {
      /* Το λειτουργικό μπορεί να αρνηθεί (π.χ. χαμηλή μπαταρία) — δεν πειράζει */
    }
  }, []);

  useEffect(() => {
    if (!armed) return;

    void requestWakeLock();

    /* Το wake lock χάνεται όταν η καρτέλα πάει στο παρασκήνιο — το ξαναζητάμε */
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [armed, requestWakeLock]);

  /* --------------------------- ΣΥΝΑΓΕΡΜΟΣ -------------------------------
   * Χτυπά όσο υπάρχει ΕΣΤΩ ΜΙΑ εκκρεμής παραγγελία. Αν το προσωπικό
   * αποδεχτεί τη μία και μείνει άλλη, ο ήχος συνεχίζει — σωστά.
   * -------------------------------------------------------------------- */
  const pendingCount = pendingOrders.length;
  const { ready: alertReady, start: startAlert, stop: stopAlert } = alert;

  useEffect(() => {
    if (!armed || !alertReady) return;

    if (pendingCount > 0) {
      startAlert();
    } else {
      stopAlert();
    }
  }, [armed, alertReady, pendingCount, startAlert, stopAlert]);

  /* --------------------------- Έναρξη βάρδιας --------------------------- */
  const handleStart = async () => {
    await alert.enable(); // ΠΡΕΠΕΙ να γίνει μέσα στο κλικ (autoplay policy)
    alert.test();
    setArmed(true);
  };

  /* ------------------------- Αλλαγή κατάστασης -------------------------- */
  const handleStatusChange = async (order: AdminOrder, status: OrderStatus) => {
    setActionError(null);
    try {
      await updateStatus(order.id, status);
      setSelected((current) =>
        current?.id === order.id ? { ...current, status } : current,
      );
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Η ενημέρωση απέτυχε.",
      );
    }
  };

  /* ====================== ΟΘΟΝΗ ΕΝΑΡΞΗΣ ΒΑΡΔΙΑΣ ====================== */
  if (!armed) {
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-gray-900 px-6 py-10">
        <div className="w-full max-w-lg rounded-3xl bg-white p-10 text-center shadow-2xl">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/30">
            <ChefHat className="h-10 w-10" />
          </span>

          <h1 className="mt-6 text-3xl font-black tracking-tight text-gray-900">
            Ταμπλό παραγγελιών
          </h1>
          {shopName && (
            <p className="mt-1 text-lg font-semibold text-orange-600">{shopName}</p>
          )}

          <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-gray-600">
            Πάτα έναρξη για να ενεργοποιηθεί ο ηχητικός συναγερμός. Οι browsers
            δεν επιτρέπουν αυτόματη αναπαραγωγή ήχου χωρίς ένα πάτημα — γι&apos; αυτό
            χρειάζεται αυτό το βήμα μία φορά σε κάθε βάρδια.
          </p>

          <button
            type="button"
            onClick={handleStart}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl bg-orange-500 px-8 py-6 text-lg font-black text-white shadow-xl shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95"
          >
            <Play className="h-6 w-6" />
            Έναρξη βάρδιας
          </button>

          {!alert.supported && (
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Αυτός ο browser δεν υποστηρίζει ήχο. Το ταμπλό θα δουλέψει κανονικά,
              αλλά οι νέες παραγγελίες θα ειδοποιούν μόνο οπτικά.
            </p>
          )}

          <p className="mt-4 text-xs text-gray-400">
            Άφησε την οθόνη ανοιχτή — δεν θα σβήσει όσο το ταμπλό είναι ενεργό.
          </p>
        </div>
      </div>
    );
  }

  /* ============================ ΤΑΜΠΛΟ ============================= */
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col bg-gray-900">
      {/* ------------------------------ Header ---------------------------- */}
      <header className="shrink-0 border-b border-gray-800 bg-gray-900 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white">
              <ChefHat className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white sm:text-xl">
                {shopName ?? "Ταμπλό παραγγελιών"}
              </h1>
              <p className="flex items-center gap-1.5 text-xs text-gray-400">
                <Radio
                  className={cn(
                    "h-3 w-3",
                    error ? "text-red-500" : "animate-pulse text-emerald-500",
                  )}
                />
                {error ? "Πρόβλημα σύνδεσης" : "Ζωντανή σύνδεση"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Μετρητής εκκρεμών */}
            {pendingCount > 0 && (
              <span className="flex items-center gap-2 rounded-full bg-red-500 px-4 py-2.5 text-sm font-black text-white">
                <Bell className="h-4 w-4 animate-bounce" />
                {pendingCount} νέες
              </span>
            )}

            {/* Σίγαση */}
            <button
              type="button"
              onClick={alert.toggleMute}
              aria-label={alert.muted ? "Ενεργοποίηση ήχου" : "Σίγαση"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors",
                alert.muted
                  ? "border-red-500/40 bg-red-500/10 text-red-400"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:text-white",
              )}
            >
              {alert.muted ? (
                <BellOff className="h-5 w-5" />
              ) : (
                <Bell className="h-5 w-5" />
              )}
            </button>

            {/* Δοκιμή ήχου */}
            <button
              type="button"
              onClick={alert.test}
              aria-label="Δοκιμή ήχου"
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-700 bg-gray-800 text-gray-300 transition-colors hover:text-white"
            >
              <Volume2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Σφάλματα */}
        {(error || actionError) && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-sm leading-relaxed text-red-200">
              {actionError ?? error}
            </p>
          </div>
        )}
      </header>

      {/* ------------------------------ Kanban ---------------------------- */}
      <main className="flex-1 overflow-hidden p-3 sm:p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <p className="text-sm font-semibold text-gray-400">
                Φόρτωση παραγγελιών…
              </p>
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            <KanbanColumn
              title="Νέες"
              tone="danger"
              count={pendingOrders.length}
              emptyLabel="Καμία νέα παραγγελία"
            >
              {pendingOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  now={now}
                  highlight
                  busy={updatingId === order.id}
                  onOpen={() => setSelected(order)}
                  onAdvance={() => handleStatusChange(order, "accepted")}
                />
              ))}
            </KanbanColumn>

            <KanbanColumn
              title="Σε εξέλιξη"
              tone="warning"
              count={activeOrders.length}
              emptyLabel="Τίποτα σε εξέλιξη"
            >
              {activeOrders.map((order) => {
                const step = NEXT_STEP[order.status];
                return (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    busy={updatingId === order.id}
                    onOpen={() => setSelected(order)}
                    onAdvance={
                      step ? () => handleStatusChange(order, step.next) : undefined
                    }
                  />
                );
              })}
            </KanbanColumn>

            <KanbanColumn
              title="Ολοκληρωμένες"
              tone="success"
              count={completedOrders.length}
              emptyLabel="Καμία ολοκληρωμένη ακόμη"
            >
              {completedOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  now={now}
                  muted
                  busy={updatingId === order.id}
                  onOpen={() => setSelected(order)}
                />
              ))}
            </KanbanColumn>
          </div>
        )}
      </main>

      {/* --------------------------- Λεπτομέρειες ------------------------- */}
      {selected && (
        <OrderDetail
          order={selected}
          now={now}
          busy={updatingId === selected.id}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => handleStatusChange(selected, status)}
        />
      )}
    </div>
  );
}

/* ==========================================================================
 *  ΣΤΗΛΗ KANBAN
 * ========================================================================== */

const COLUMN_TONES = {
  danger: "bg-red-500",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
} as const;

function KanbanColumn({
  title,
  tone,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  tone: keyof typeof COLUMN_TONES;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl bg-gray-800/60">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-700/60 px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-300">
          <span className={cn("h-2.5 w-2.5 rounded-full", COLUMN_TONES[tone])} />
          {title}
        </h2>
        <span className="rounded-full bg-gray-700 px-3 py-1 text-sm font-black text-white">
          {count}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {count === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">{emptyLabel}</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ==========================================================================
 *  ΚΑΡΤΑ ΠΑΡΑΓΓΕΛΙΑΣ
 * ========================================================================== */

function OrderCard({
  order,
  now,
  highlight = false,
  muted = false,
  busy = false,
  onOpen,
  onAdvance,
}: {
  order: AdminOrder;
  now: number;
  highlight?: boolean;
  muted?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onAdvance?: () => void;
}) {
  const step = NEXT_STEP[order.status];

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-white transition-all duration-300",
        highlight
          ? "animate-pulse border-red-400 shadow-lg shadow-red-500/30"
          : "border-transparent",
        muted && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-4 pb-3 pt-4 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-lg font-black tracking-tight text-gray-900">
              {order.code}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <Clock className="h-3.5 w-3.5" />
              {clockTime(order.createdAt)} · {timeAgo(order.createdAt, now)}
            </p>
          </div>

          <span className="shrink-0 text-2xl font-black text-gray-900">
            {formatPrice(order.total)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide",
              STATUS_STYLES[order.status],
            )}
          >
            {STATUS_LABELS[order.status]}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">
            <ShoppingBag className="h-3 w-3" />
            {countItems(order)} τεμ.
          </span>
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 text-sm text-gray-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
          <span className="line-clamp-1">{order.address}</span>
        </p>

        {order.notes && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            ✏️ {order.notes}
          </p>
        )}

        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-orange-600">
          Λεπτομέρειες
          <ChevronRight className="h-3 w-3" />
        </p>
      </button>

      {onAdvance && step && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={busy}
          className={cn(
            "flex w-full items-center justify-center gap-2 px-4 py-4 text-base font-black text-white transition-colors disabled:opacity-60",
            order.status === "pending"
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-gray-900 hover:bg-orange-500",
          )}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-5 w-5" />
          )}
          {step.label}
        </button>
      )}
    </article>
  );
}

/* ==========================================================================
 *  ΛΕΠΤΟΜΕΡΕΙΕΣ ΠΑΡΑΓΓΕΛΙΑΣ
 * ========================================================================== */

function OrderDetail({
  order,
  now,
  busy,
  onClose,
  onStatusChange,
}: {
  order: AdminOrder;
  now: number;
  busy: boolean;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
}) {
  const step = NEXT_STEP[order.status];
  const canCancel = !["completed", "cancelled"].includes(order.status);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Παραγγελία ${order.code}`}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <p className="font-mono text-2xl font-black tracking-tight text-gray-900">
              {order.code}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              {clockTime(order.createdAt)} · {timeAgo(order.createdAt, now)}
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase",
                  STATUS_STYLES[order.status],
                )}
              >
                {STATUS_LABELS[order.status]}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Περιεχόμενο */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-2 rounded-2xl bg-gray-50 p-4">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Διεύθυνση παράδοσης
              </p>
              <p className="mt-0.5 text-base font-bold text-gray-900">
                {order.address}
              </p>
            </div>
          </div>

          {order.notes && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
                Σχόλιο πελάτη
              </p>
              <p className="mt-1 text-base font-semibold text-amber-900">
                {order.notes}
              </p>
            </div>
          )}

          <ul className="mt-5 divide-y divide-gray-100">
            {order.lines.map((line) => (
              <li key={line.itemId} className="flex items-start gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-sm font-black text-orange-700">
                  {line.quantity}×
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-gray-900">
                    {line.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatPrice(line.unitPrice)} / τεμ.
                  </span>
                </span>
                <span className="shrink-0 text-base font-black text-gray-900">
                  {formatPrice(line.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1.5 border-t border-dashed border-gray-200 pt-4 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Υποσύνολο</span>
              <span className="font-semibold text-gray-900">
                {formatPrice(order.subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Μεταφορικά</span>
              <span className="font-semibold text-gray-900">
                {formatPrice(order.deliveryFee)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 text-lg">
              <span className="font-black text-gray-900">Σύνολο</span>
              <span className="text-2xl font-black text-gray-900">
                {formatPrice(order.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Ενέργειες */}
        <footer className="shrink-0 space-y-3 border-t border-gray-100 bg-gray-50 px-6 py-5">
          <button
            type="button"
            onClick={() => printReceipt(order)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-gray-900 bg-white px-6 py-4 text-base font-black text-gray-900 transition-all duration-300 hover:bg-gray-900 hover:text-white active:scale-95"
          >
            <Printer className="h-5 w-5" />
            Εκτύπωση απόδειξης
          </button>

          <div className="flex flex-col gap-2 sm:flex-row">
            {step && (
              <button
                type="button"
                onClick={() => onStatusChange(step.next)}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-black text-white transition-all duration-300 hover:bg-emerald-700 active:scale-95 disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                {step.label}
              </button>
            )}

            {canCancel && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Σίγουρα ακύρωση της παραγγελίας;")) {
                    onStatusChange("cancelled");
                  }
                }}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-6 py-4 text-base font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                <Ban className="h-5 w-5" />
                Ακύρωση
              </button>
            )}

            {!step && !canCancel && (
              <button
                type="button"
                onClick={onClose}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 px-6 py-4 text-base font-bold text-white transition-colors hover:bg-gray-800"
              >
                <RefreshCw className="h-5 w-5" />
                Κλείσιμο
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
