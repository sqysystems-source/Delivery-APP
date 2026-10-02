"use client";

/* ==========================================================================
 *  Buka Delivery — app/(admin)/admin/settings/page.tsx
 *
 *  Ρυθμίσεις καταστήματος.
 *
 *  ── ΠΑΥΣΗ ΠΑΡΑΓΓΕΛΙΩΝ (υπάρχον πεδίο `active`) ──────────────────────────
 *  Ο διακόπτης γράφει `active` απευθείας (όπως πριν· τα Rules ελέγχουν ότι
 *  είναι boolean). Milestone 4: `active === false` σημαίνει «Προσωρινά δεν
 *  δεχόμαστε παραγγελίες» και ΥΠΕΡΙΣΧΥΕΙ του ωραρίου. Ένα κατάστημα που ήταν
 *  κλειστό πριν την αναβάθμιση παραμένει σε παύση.
 *
 *  ── ΩΡΑΡΙΟ ΚΑΙ ΖΩΝΕΣ (milestone 4) ──────────────────────────────────────
 *  Αποθηκεύονται ΜΟΝΟ μέσω POST /api/admin/shop-settings (πλήρης επικύρωση,
 *  έλεγχος ΤΡΕΧΟΝΤΟΣ ιδιοκτήτη μέσα στη συναλλαγή). Ο browser δεν μπορεί να
 *  γράψει απευθείας `openingHours`/`deliveryZones` — το απαγορεύουν τα Rules.
 *
 *  ── ΓΕΝΙΚΟΙ ΟΙΚΟΝΟΜΙΚΟΙ ΟΡΟΙ ────────────────────────────────────────────
 *  Ελάχιστη/μεταφορικά/δωρεάν του ΚΑΤΑΣΤΗΜΑΤΟΣ μένουν μόνο για ανάγνωση (τα
 *  αλλάζει το Buka). Ισχύουν όταν δεν υπάρχουν ζώνες και είναι οι αρχικές
 *  τιμές κάθε νέας ζώνης. Σε ενδεχόμενη αλλαγή ποσού στη μέση μιας
 *  παραγγελίας, ο πελάτης ΠΑΝΤΑ επιβεβαιώνει ξανά ρητά (price_changed).
 * ========================================================================== */

import { useState } from "react";
import {
  AlertTriangle,
  Bike,
  Clock,
  Info,
  Loader2,
  Lock,
  MapPin,
  PauseCircle,
  PlayCircle,
  ShoppingBag,
  Star,
} from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useOwnerShop } from "@/context/OwnerShopContext";
import DeliveryZonesEditor from "@/components/admin/DeliveryZonesEditor";
import OpeningHoursEditor from "@/components/admin/OpeningHoursEditor";
import AvailabilityBadge from "@/components/shop/AvailabilityBadge";
import { useLiveShop } from "@/hooks/useLiveShop";
import { useShopAvailability } from "@/hooks/useShopAvailability";
import { describeAvailability, readManualPause } from "@/lib/shop/availability";
import { parseDeliveryZones } from "@/lib/shop/delivery-zones";
import { parseOpeningHours } from "@/lib/shop/opening-hours";
import { cn, formatDeliveryFee, formatEta, formatPrice, formatRating } from "@/lib/format";

export default function AdminSettingsPage() {
  const { shop, shopId, loading, error } = useOwnerShop();

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Milestone 4: ζωντανή ρύθμιση + διαθεσιμότητα όπως τη βλέπουν οι πελάτες */
  const live = useLiveShop(shopId);
  const liveData = live.status === "ready" ? live.data : null;
  const { availability, now } = useShopAvailability(liveData, live.receivedAt);

  /* Παύση = `active === false` (το ίδιο πεδίο που έγραφε ο παλιός διακόπτης) */
  const pause = readManualPause((liveData ?? (shop as unknown as Record<string, unknown> | null))?.active);
  const paused = pause === true;

  const togglePause = async () => {
    if (!shopId) return;

    setSaving(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, "shops", shopId), {
        active: paused, // σε παύση → active: true (συνέχεια)· αλλιώς → active: false (παύση)
        updatedAt: serverTimestamp(),
      });
    } catch (caught) {
      console.error("[settings] Αποτυχία αλλαγής κατάστασης:", caught);
      setActionError("Δεν ήταν δυνατή η αλλαγή. Δοκίμασε ξανά.");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ Φόρτωση ------------------------------- */
  if (loading || (shopId && live.status === "loading")) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error || !shop || !shopId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <p className="mt-3 text-sm leading-relaxed text-amber-900">
            {error ?? "Δεν βρέθηκε κατάστημα."}
          </p>
        </div>
      </div>
    );
  }

  const settingsSource = liveData ?? (shop as unknown as Record<string, unknown>);
  const hours = parseOpeningHours(settingsSource.openingHours);
  const zones = parseDeliveryZones(settingsSource.deliveryZones);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
          Ρυθμίσεις
        </h1>
        <p className="mt-1 text-sm text-gray-600">{shop.name}</p>
      </header>

      {actionError && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}

      <div className="mt-6 grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ------------------ Παύση παραγγελιών / τρέχουσα κατάσταση ---------- */}
        <section
          className={cn(
            "rounded-3xl border p-6 transition-colors lg:col-span-2",
            paused ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl",
                  paused ? "bg-amber-500" : "bg-emerald-500",
                )}
              >
                {paused ? (
                  <PauseCircle className="h-7 w-7 text-white" />
                ) : (
                  <PlayCircle className="h-7 w-7 text-white" />
                )}
              </span>

              <div>
                <h2 className="text-xl font-black tracking-tight text-gray-900">
                  {paused ? "Προσωρινά δεν δέχεσαι παραγγελίες" : "Δέχεσαι παραγγελίες"}
                </h2>
                <p className="mt-1 max-w-md text-sm leading-relaxed text-gray-700">
                  {paused
                    ? "Η παύση υπερισχύει του ωραρίου: καμία νέα παραγγελία μέχρι να τη σταματήσεις. Οι παραγγελίες που ήδη τρέχουν δεν επηρεάζονται."
                    : "Σύμφωνα με το ωράριό σου (αν έχεις ενεργό). Βάλε παύση όταν γεμίσει η κουζίνα ή τελειώσεις νωρίτερα."}
                </p>
                {availability && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-800" role="status">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      Οι πελάτες βλέπουν τώρα:
                    </span>
                    <AvailabilityBadge state={availability.state} />
                    <span>{describeAvailability(availability, now)}</span>
                  </p>
                )}
                {pause === "invalid" && (
                  <p className="mt-2 text-sm font-semibold text-red-700">
                    Το πεδίο κατάστασης του καταστήματος έχει μη έγκυρη τιμή. Πάτησε το κουμπί για να το
                    διορθώσεις.
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={saving}
              className={cn(
                "flex items-center gap-2 rounded-2xl px-6 py-4 text-sm font-black text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-60",
                paused
                  ? "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700"
                  : "bg-amber-600 shadow-amber-600/20 hover:bg-amber-700",
              )}
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : paused ? (
                <PlayCircle className="h-5 w-5" />
              ) : (
                <PauseCircle className="h-5 w-5" />
              )}
              {paused ? "Συνέχεια παραγγελιών" : "Προσωρινά δεν δεχόμαστε παραγγελίες"}
            </button>
          </div>
        </section>

        {/* -------------------------- Ωράριο -------------------------------- */}
        <OpeningHoursEditor
          key={`hours-${shopId}`}
          shopId={shopId}
          initial={hours.kind === "config" ? hours.config : null}
          storedInvalid={hours.kind === "invalid"}
        />

        {/* --------------------------- Ζώνες -------------------------------- */}
        <DeliveryZonesEditor
          key={`zones-${shopId}`}
          shopId={shopId}
          shop={shop}
          initial={zones.kind === "config" ? zones.config : null}
          storedInvalid={zones.kind === "invalid"}
        />

        {/* -------------------------- Στοιχεία --------------------------- */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-black tracking-tight text-gray-900">
            Στοιχεία καταστήματος
          </h2>

          <dl className="mt-4 space-y-4">
            {[
              { icon: MapPin, label: "Διεύθυνση", value: shop.address },
              { icon: Clock, label: "Χρόνος παράδοσης", value: formatEta(shop.etaMinutes) },
              {
                icon: Star,
                label: "Βαθμολογία",
                value: `${formatRating(shop.rating)} από ${shop.reviews.toLocaleString("el-GR")} κριτικές`,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50">
                  <row.icon className="h-4 w-4 text-orange-500" />
                </span>
                <div className="min-w-0">
                  <dt className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                    {row.value}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        {/* ---------------------- Κλειδωμένα οικονομικά ------------------ */}
        <section className="rounded-3xl border border-gray-200 bg-white p-6">
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-gray-900">
            <Lock className="h-4 w-4 text-gray-400" />
            Γενικοί οικονομικοί όροι
          </h2>

          <dl className="mt-4 space-y-4">
            {[
              {
                icon: ShoppingBag,
                label: "Ελάχιστη παραγγελία",
                value: formatPrice(shop.minOrder),
              },
              {
                icon: Bike,
                label: "Μεταφορικά",
                value: formatDeliveryFee(shop.deliveryFee),
              },
              {
                icon: Bike,
                label: "Δωρεάν μεταφορικά άνω των",
                value:
                  shop.freeDeliveryOver !== null
                    ? formatPrice(shop.freeDeliveryOver)
                    : "—",
              },
            ].map((row) => (
              <div key={row.label} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100">
                  <row.icon className="h-4 w-4 text-gray-500" />
                </span>
                <div className="min-w-0">
                  <dt className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                    {row.value}
                  </dd>
                </div>
              </div>
            ))}
          </dl>

          <p className="mt-5 flex items-start gap-2 rounded-2xl bg-gray-50 p-3.5 text-xs leading-relaxed text-gray-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
            Αυτά τα ποσά αλλάζουν μόνο από το Buka. Ισχύουν όταν δεν χρησιμοποιείς ζώνες ΤΚ και είναι
            οι αρχικές τιμές κάθε νέας ζώνης. Με ενεργές ζώνες ισχύουν τα ποσά της ζώνης του πελάτη.
          </p>
        </section>
      </div>
    </div>
  );
}
