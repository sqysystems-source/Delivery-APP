"use client";

/* ==========================================================================
 *  Buka Delivery — app/(admin)/admin/menu/page.tsx
 *
 *  Διαχείριση καταλόγου. Η οθόνη που ανοίγει ο καταστηματάρχης όταν
 *  τελειώσει ο γύρος στις 9 το βράδυ και θέλει να τον κλείσει σε δύο κλικ.
 *
 *  Γι' αυτό ο διακόπτης διαθεσιμότητας είναι ΠΑΝΩ στη γραμμή, όχι κρυμμένος
 *  μέσα σε modal επεξεργασίας: είναι η ενέργεια που γίνεται δέκα φορές τη
 *  μέρα, ενώ η αλλαγή τιμής μία φορά τον μήνα.
 * ========================================================================== */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Loader2,
  Package,
  PackageX,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import MenuItemModal from "@/components/admin/MenuItemModal";
import { useOwnerShop } from "@/context/OwnerShopContext";
import { useMenuManager, type MenuItemInput } from "@/hooks/useMenuManager";
import { cn, formatPrice } from "@/lib/format";
import type { MenuItem } from "@/types";

export default function AdminMenuPage() {
  const { shopId, shopName, error: shopError } = useOwnerShop();
  const {
    categories,
    items,
    loading,
    error,
    busyId,
    toggleAvailability,
    saveItem,
    deleteItem,
  } = useMenuManager(shopId);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /* ------------------------------ Φίλτρα -------------------------------- */
  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesCategory =
        categoryFilter === "all" || item.categoryId === categoryFilter;
      const matchesTerm =
        term.length === 0 ||
        item.name.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term);

      return matchesCategory && matchesTerm;
    });
  }, [items, search, categoryFilter]);

  const stats = useMemo(() => {
    const unavailable = items.filter((item) => item.available === false).length;
    return {
      total: items.length,
      available: items.length - unavailable,
      unavailable,
    };
  }, [items]);

  const categoryLabel = (categoryId: string) => {
    const category = categories.find((entry) => entry.id === categoryId);
    return category ? `${category.emoji} ${category.label}` : "—";
  };

  /* ----------------------------- Ενέργειες ------------------------------ */
  const handleToggle = async (item: MenuItem) => {
    setActionError(null);
    try {
      await toggleAvailability(item);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Η αλλαγή απέτυχε.");
    }
  };

  const handleSave = async (input: MenuItemInput, itemId?: string) => {
    setActionError(null);
    await saveItem(input, itemId);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await deleteItem(deleting.id);
      setDeleting(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Η διαγραφή απέτυχε.");
    }
  };

  /* --------------------------- Σφάλμα καταστήματος ---------------------- */
  if (shopError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <p className="mt-3 text-sm leading-relaxed text-amber-900">{shopError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* ------------------------------ Header ---------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
            Κατάλογος
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {shopName ? `${shopName} · ` : ""}
            {stats.total} προϊόντα, {stats.available} διαθέσιμα
            {stats.unavailable > 0 && (
              <span className="font-semibold text-red-600">
                {" "}
                · {stats.unavailable} εξαντλημένα
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          disabled={!shopId}
          className="flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
        >
          <Plus className="h-4 w-4" />
          Νέο προϊόν
        </button>
      </header>

      {/* ------------------------------ Σφάλματα -------------------------- */}
      {(error || actionError) && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm leading-relaxed text-red-800">{actionError ?? error}</p>
        </div>
      )}

      {/* ------------------------------- Φίλτρα --------------------------- */}
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Αναζήτηση προϊόντος…"
            className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-orange-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Καθαρισμός"
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ id: "all", label: "Όλες", emoji: "📋" }, ...categories].map((category) => {
            const active = categoryFilter === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryFilter(category.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                  active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-600",
                )}
              >
                <span>{category.emoji}</span>
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------- Λίστα ---------------------------- */}
      <div className="mt-5 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
              <p className="text-sm font-semibold text-gray-500">
                Φόρτωση καταλόγου…
              </p>
            </div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100">
              <Package className="h-8 w-8 text-gray-400" />
            </span>
            <p className="mt-5 text-lg font-bold text-gray-900">
              {items.length === 0 ? "Ο κατάλογος είναι άδειος" : "Κανένα αποτέλεσμα"}
            </p>
            <p className="mt-1.5 text-sm text-gray-500">
              {items.length === 0
                ? "Πρόσθεσε το πρώτο σου προϊόν για να αρχίσεις να δέχεσαι παραγγελίες."
                : "Δοκίμασε άλλη κατηγορία ή καθάρισε την αναζήτηση."}
            </p>
          </div>
        ) : (
          <>
            {/* Κεφαλίδα πίνακα — μόνο σε μεγάλες οθόνες */}
            <div className="hidden items-center gap-4 border-b border-gray-100 bg-gray-50 px-5 py-3 text-[11px] font-black uppercase tracking-wider text-gray-500 lg:flex">
              <span className="flex-1">Προϊόν</span>
              <span className="w-40">Κατηγορία</span>
              <span className="w-28 text-right">Τιμή</span>
              <span className="w-32 text-center">Διαθεσιμότητα</span>
              <span className="w-24 text-right">Ενέργειες</span>
            </div>

            <ul className="divide-y divide-gray-100">
              {visibleItems.map((item) => {
                const busy = busyId === item.id;
                const unavailable = item.available === false;

                return (
                  <li
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-3 px-5 py-4 transition-colors lg:flex-row lg:items-center lg:gap-4",
                      unavailable ? "bg-red-50/40" : "hover:bg-gray-50",
                    )}
                  >
                    {/* Προϊόν */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-base font-bold",
                            unavailable
                              ? "text-gray-500 line-through"
                              : "text-gray-900",
                          )}
                        >
                          {item.name}
                        </span>
                        {item.popular && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                            <Flame className="h-3 w-3" />
                            Δημοφιλές
                          </span>
                        )}
                        {item.oldPrice && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            Προσφορά
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">
                          {item.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-400 lg:hidden">
                        {categoryLabel(item.categoryId)}
                      </p>
                    </div>

                    {/* Κατηγορία */}
                    <span className="hidden w-40 truncate text-sm text-gray-600 lg:block">
                      {categoryLabel(item.categoryId)}
                    </span>

                    {/* Τιμή */}
                    <div className="flex items-center gap-2 lg:w-28 lg:justify-end">
                      <span className="text-lg font-black text-gray-900">
                        {formatPrice(item.price)}
                      </span>
                      {item.oldPrice && (
                        <span className="text-xs font-medium text-gray-400 line-through">
                          {formatPrice(item.oldPrice)}
                        </span>
                      )}
                    </div>

                    {/* Διακόπτης διαθεσιμότητας */}
                    <div className="flex items-center gap-3 lg:w-32 lg:justify-center">
                      <button
                        type="button"
                        onClick={() => void handleToggle(item)}
                        disabled={busy}
                        role="switch"
                        aria-checked={!unavailable}
                        aria-label={
                          unavailable
                            ? `Ενεργοποίηση ${item.name}`
                            : `Απενεργοποίηση ${item.name}`
                        }
                        className={cn(
                          "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 disabled:opacity-50",
                          unavailable ? "bg-gray-300" : "bg-emerald-500",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-all duration-300",
                            unavailable ? "left-1" : "left-7",
                          )}
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" />
                          ) : unavailable ? (
                            <PackageX className="h-3.5 w-3.5 text-gray-500" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          )}
                        </span>
                      </button>

                      <span
                        className={cn(
                          "text-xs font-bold lg:hidden",
                          unavailable ? "text-gray-500" : "text-emerald-600",
                        )}
                      >
                        {unavailable ? "Εξαντλήθηκε" : "Διαθέσιμο"}
                      </span>
                    </div>

                    {/* Ενέργειες */}
                    <div className="flex items-center gap-2 lg:w-24 lg:justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(item);
                          setModalOpen(true);
                        }}
                        aria-label={`Επεξεργασία ${item.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleting(item)}
                        aria-label={`Διαγραφή ${item.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* --------------------------- Modal προϊόντος ----------------------- */}
      <MenuItemModal
        open={modalOpen}
        item={editing}
        categories={categories}
        saving={busyId === (editing?.id ?? "new")}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      {/* ------------------------ Επιβεβαίωση διαγραφής -------------------- */}
      {deleting && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Διαγραφή προϊόντος"
        >
          <div
            className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            onClick={() => setDeleting(null)}
          />

          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100">
              <Trash2 className="h-7 w-7 text-red-600" />
            </span>

            <h3 className="mt-4 text-xl font-black tracking-tight text-gray-900">
              Διαγραφή προϊόντος;
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Το <span className="font-bold text-gray-900">{deleting.name}</span> θα
              αφαιρεθεί οριστικά από τον κατάλογο.
            </p>
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Αν απλώς εξαντλήθηκε, κλείσε τον διακόπτη διαθεσιμότητας — έτσι το
              ξαναανοίγεις αύριο με ένα κλικ.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busyId === deleting.id}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-red-600 px-6 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-red-700 active:scale-95 disabled:opacity-60"
              >
                {busyId === deleting.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Οριστική διαγραφή
              </button>

              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="w-full rounded-full px-6 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
              >
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
