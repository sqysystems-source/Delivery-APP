"use client";

/* ==========================================================================
 *  Buka Delivery — app/(admin)/admin/settings/page.tsx
 *
 *  Ρυθμίσεις καταστήματος. Προς το παρόν μία λειτουργία, αλλά η πιο
 *  σημαντική: ο διακόπτης «ανοιχτά / κλειστά».
 *
 *  Όταν κλείνει, το /api/orders απορρίπτει κάθε νέα παραγγελία με μήνυμα
 *  «Το κατάστημα είναι προσωρινά κλειστό» (ο έλεγχος shop.active === false
 *  υπάρχει ήδη εκεί). Δεν βασιζόμαστε στο UI για να το κρύψει.
 *
 *  Τα οικονομικά πεδία (ελάχιστη παραγγελία, μεταφορικά) εμφανίζονται μόνο
 *  για ανάγνωση: τα Security Rules απαγορεύουν στον καταστηματάρχη να τα
 *  αλλάξει, γιατί ο server τα διαβάζει τη στιγμή που υπολογίζει το ποσό
 *  μιας παραγγελίας που βρίσκεται ήδη σε εξέλιξη.
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
  Power,
  ShoppingBag,
  Star,
} from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useOwnerShop } from "@/context/OwnerShopContext";
import { cn, formatDeliveryFee, formatEta, formatPrice, formatRating } from "@/lib/format";

export default function AdminSettingsPage() {
  const { shop, shopId, loading, error } = useOwnerShop();

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* Το πεδίο `active` δεν είναι στον τύπο Shop — το γράφει το seed/API */
  const isOpen = (shop as unknown as { active?: boolean } | null)?.active !== false;

  const toggleOpen = async () => {
    if (!shopId) return;

    setSaving(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, "shops", shopId), {
        active: !isOpen,
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
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error || !shop) {
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

      <div className="mt-6 grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ----------------------- Ανοιχτά / κλειστά --------------------- */}
        <section
          className={cn(
            "rounded-3xl border p-6 transition-colors lg:col-span-2",
            isOpen
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl",
                  isOpen ? "bg-emerald-500" : "bg-red-500",
                )}
              >
                <Power className="h-7 w-7 text-white" />
              </span>

              <div>
                <h2 className="text-xl font-black tracking-tight text-gray-900">
                  {isOpen ? "Το κατάστημα δέχεται παραγγελίες" : "Κατάστημα κλειστό"}
                </h2>
                <p className="mt-1 max-w-md text-sm leading-relaxed text-gray-700">
                  {isOpen
                    ? "Οι πελάτες μπορούν να παραγγείλουν κανονικά. Κλείσε το όταν γεμίσει η κουζίνα ή τελειώσεις για σήμερα."
                    : "Καμία νέα παραγγελία δεν γίνεται δεκτή. Οι παραγγελίες που ήδη τρέχουν δεν επηρεάζονται."}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void toggleOpen()}
              disabled={saving}
              className={cn(
                "flex items-center gap-2 rounded-2xl px-6 py-4 text-sm font-black text-white shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-60",
                isOpen
                  ? "bg-red-600 shadow-red-600/20 hover:bg-red-700"
                  : "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700",
              )}
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Power className="h-5 w-5" />
              )}
              {isOpen ? "Κλείσιμο καταστήματος" : "Άνοιγμα καταστήματος"}
            </button>
          </div>
        </section>

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
            Οικονομικοί όροι
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
            Αυτά τα πεδία αλλάζουν μόνο από το Buka. Ο λόγος είναι τεχνικός: ο
            server τα διαβάζει τη στιγμή που υπολογίζει το ποσό κάθε παραγγελίας,
            οπότε μια αλλαγή στη μέση μιας παραγγελίας θα άλλαζε το ποσό που
            χρεώνεται ο πελάτης. Ζήτα μας την αλλαγή και την περνάμε εμείς.
          </p>
        </section>
      </div>
    </div>
  );
}
