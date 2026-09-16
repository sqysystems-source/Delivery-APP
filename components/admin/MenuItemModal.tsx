"use client";

/* ==========================================================================
 *  Buka Delivery — components/admin/MenuItemModal.tsx
 *
 *  Φόρμα προσθήκης και επεξεργασίας προϊόντος. Ένα component για τα δύο:
 *  όταν περάσεις `item`, γίνεται «Επεξεργασία»· χωρίς αυτό, «Νέο προϊόν».
 *
 *  ── ΤΙΜΕΣ ΜΕ ΚΟΜΜΑ ─────────────────────────────────────────────────────
 *  Ο Έλληνας καταστηματάρχης θα γράψει «3,90». Το parseFloat("3,90") δίνει
 *  3 — δηλαδή θα πουλούσε το σουβλάκι 3€ αντί για 3,90€, χωρίς κανένα
 *  μήνυμα λάθους. Γι' αυτό το κόμμα μετατρέπεται σε τελεία πριν το parse.
 * ========================================================================== */

import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Flame, Loader2, Package, X } from "lucide-react";
import type { MenuCategory, MenuItem } from "@/types";
import type { MenuItemInput } from "@/hooks/useMenuManager";
import { cn, formatPrice } from "@/lib/format";

type MenuItemModalProps = {
  open: boolean;
  /** Όταν δίνεται, η φόρμα είναι σε λειτουργία επεξεργασίας */
  item: MenuItem | null;
  categories: MenuCategory[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: MenuItemInput, itemId?: string) => Promise<void>;
};

type FieldErrors = {
  name?: string;
  categoryId?: string;
  price?: string;
  oldPrice?: string;
  description?: string;
  image?: string;
};

/** «3,90» και «3.90» δίνουν και τα δύο 3.9 — NaN όταν δεν είναι αριθμός */
function parsePrice(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

function priceToInput(value: number | undefined): string {
  if (typeof value !== "number") return "";
  return value.toFixed(2).replace(".", ",");
}

export default function MenuItemModal({
  open,
  item,
  categories,
  saving,
  onClose,
  onSave,
}: MenuItemModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [image, setImage] = useState("");
  const [popular, setPopular] = useState(false);
  const [available, setAvailable] = useState(true);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  /* Γέμισμα της φόρμας κάθε φορά που ανοίγει */
  useEffect(() => {
    if (!open) return;

    setName(item?.name ?? "");
    setDescription(item?.description ?? "");
    setCategoryId(item?.categoryId ?? categories[0]?.id ?? "");
    setPrice(priceToInput(item?.price));
    setOldPrice(priceToInput(item?.oldPrice));
    setImage(item?.image ?? "");
    setPopular(item?.popular === true);
    setAvailable(item?.available !== false);
    setErrors({});
    setFormError(null);
  }, [open, item, categories]);

  /* Κλείδωμα scroll + Escape */
  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const parsedPrice = parsePrice(price);
  const parsedOldPrice = oldPrice.trim() ? parsePrice(oldPrice) : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const nextErrors: FieldErrors = {};

    if (name.trim().length < 2) {
      nextErrors.name = "Το όνομα θέλει τουλάχιστον 2 χαρακτήρες.";
    } else if (name.trim().length > 80) {
      nextErrors.name = "Το όνομα είναι πολύ μεγάλο (έως 80 χαρακτήρες).";
    }

    if (!categoryId) {
      nextErrors.categoryId = "Διάλεξε κατηγορία.";
    }

    if (description.trim().length > 300) {
      nextErrors.description = "Η περιγραφή είναι πολύ μεγάλη (έως 300 χαρακτήρες).";
    }

    if (!Number.isFinite(parsedPrice)) {
      nextErrors.price = "Δώσε έγκυρη τιμή, π.χ. 3,90";
    } else if (parsedPrice < 0) {
      nextErrors.price = "Η τιμή δεν μπορεί να είναι αρνητική.";
    } else if (parsedPrice > 999) {
      nextErrors.price = "Η τιμή ξεπερνά το όριο των 999€.";
    }

    if (parsedOldPrice !== null) {
      if (!Number.isFinite(parsedOldPrice)) {
        nextErrors.oldPrice = "Δώσε έγκυρη τιμή ή άφησέ το κενό.";
      } else if (parsedOldPrice <= parsedPrice) {
        nextErrors.oldPrice = "Η παλιά τιμή πρέπει να είναι μεγαλύτερη από τη νέα.";
      }
    }

    if (image.trim() && !/^https?:\/\/.+/i.test(image.trim())) {
      nextErrors.image = "Το URL πρέπει να ξεκινά με http:// ή https://";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      await onSave(
        {
          name,
          description,
          categoryId,
          /* Στρογγυλοποίηση στα 2 δεκαδικά: το 3.9000000000000004 δεν
           * πρέπει ποτέ να φτάσει στη βάση — από εκεί το διαβάζει ο server
           * όταν υπολογίζει παραγγελίες. */
          price: Math.round(parsedPrice * 100) / 100,
          oldPrice:
            parsedOldPrice !== null ? Math.round(parsedOldPrice * 100) / 100 : null,
          image: image.trim() || null,
          popular,
          available,
        },
        item?.id,
      );
      onClose();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Η αποθήκευση απέτυχε.",
      );
    }
  };

  const inputClass = (hasError: boolean) =>
    cn(
      "w-full rounded-2xl border bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:bg-white",
      hasError
        ? "border-red-300 focus:border-red-400"
        : "border-gray-200 focus:border-orange-400",
    );

  const discount =
    parsedOldPrice !== null &&
    Number.isFinite(parsedOldPrice) &&
    Number.isFinite(parsedPrice) &&
    parsedOldPrice > parsedPrice
      ? Math.round((1 - parsedPrice / parsedOldPrice) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={item ? "Επεξεργασία προϊόντος" : "Νέο προϊόν"}
    >
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
      />

      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
        {/* ------------------------------ Header ------------------------- */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-100">
              <Package className="h-5 w-5 text-orange-600" />
            </span>
            <div>
              <h2 className="text-lg font-black tracking-tight text-gray-900">
                {item ? "Επεξεργασία προϊόντος" : "Νέο προϊόν"}
              </h2>
              <p className="text-xs text-gray-500">
                {item ? item.name : "Πρόσθεσε ένα πιάτο στον κατάλογό σου"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Κλείσιμο"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* ------------------------------- Φόρμα ------------------------- */}
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {formError && (
            <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm leading-relaxed text-red-800">{formError}</p>
            </div>
          )}

          <div className="space-y-4">
            {/* Όνομα */}
            <div>
              <label
                htmlFor="item-name"
                className="mb-1.5 block text-sm font-bold text-gray-900"
              >
                Όνομα προϊόντος
              </label>
              <input
                id="item-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="π.χ. Πίτα Γύρος Χοιρινός"
                className={inputClass(Boolean(errors.name))}
              />
              {errors.name && (
                <p className="mt-1.5 text-xs font-semibold text-red-600">
                  {errors.name}
                </p>
              )}
            </div>

            {/* Κατηγορία */}
            <div>
              <label
                htmlFor="item-category"
                className="mb-1.5 block text-sm font-bold text-gray-900"
              >
                Κατηγορία
              </label>
              <select
                id="item-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className={cn(inputClass(Boolean(errors.categoryId)), "cursor-pointer")}
              >
                {categories.length === 0 && <option value="">Καμία κατηγορία</option>}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.emoji} {category.label}
                  </option>
                ))}
              </select>
              {errors.categoryId && (
                <p className="mt-1.5 text-xs font-semibold text-red-600">
                  {errors.categoryId}
                </p>
              )}
            </div>

            {/* Περιγραφή */}
            <div>
              <label
                htmlFor="item-description"
                className="mb-1.5 flex items-center justify-between text-sm font-bold text-gray-900"
              >
                Περιγραφή
                <span className="text-xs font-medium text-gray-400">
                  {description.length}/300
                </span>
              </label>
              <textarea
                id="item-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Γύρος, τζατζίκι, ντομάτα, κρεμμύδι, πατάτες σε ζεστή πίτα."
                className={cn(inputClass(Boolean(errors.description)), "resize-none")}
              />
              {errors.description && (
                <p className="mt-1.5 text-xs font-semibold text-red-600">
                  {errors.description}
                </p>
              )}
            </div>

            {/* Τιμές */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="item-price"
                  className="mb-1.5 block text-sm font-bold text-gray-900"
                >
                  Τιμή (€)
                </label>
                <input
                  id="item-price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="3,90"
                  className={inputClass(Boolean(errors.price))}
                />
                {errors.price && (
                  <p className="mt-1.5 text-xs font-semibold text-red-600">
                    {errors.price}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="item-old-price"
                  className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-gray-900"
                >
                  Παλιά τιμή
                  <span className="text-xs font-medium text-gray-400">προαιρετικό</span>
                </label>
                <input
                  id="item-old-price"
                  type="text"
                  inputMode="decimal"
                  value={oldPrice}
                  onChange={(event) => setOldPrice(event.target.value)}
                  placeholder="—"
                  className={inputClass(Boolean(errors.oldPrice))}
                />
                {errors.oldPrice && (
                  <p className="mt-1.5 text-xs font-semibold text-red-600">
                    {errors.oldPrice}
                  </p>
                )}
              </div>
            </div>

            {discount !== null && (
              <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                Θα εμφανίζεται ως προσφορά −{discount}% (από{" "}
                {formatPrice(parsedOldPrice!)} σε {formatPrice(parsedPrice)}).
              </p>
            )}

            {/* Εικόνα */}
            <div>
              <label
                htmlFor="item-image"
                className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-gray-900"
              >
                URL εικόνας
                <span className="text-xs font-medium text-gray-400">προαιρετικό</span>
              </label>
              <input
                id="item-image"
                type="url"
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="https://…"
                className={inputClass(Boolean(errors.image))}
              />
              {errors.image ? (
                <p className="mt-1.5 text-xs font-semibold text-red-600">
                  {errors.image}
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-500">
                  Χωρίς εικόνα εμφανίζεται το emoji της κατηγορίας.
                </p>
              )}
            </div>

            {/* Διακόπτες */}
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:border-orange-200 hover:bg-orange-50/40">
                <input
                  type="checkbox"
                  checked={available}
                  onChange={(event) => setAvailable(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="text-sm">
                  <span className="block font-bold text-gray-900">Διαθέσιμο</span>
                  <span className="mt-0.5 block text-gray-600">
                    Όταν είναι κλειστό, το προϊόν φαίνεται στον κατάλογο ως
                    εξαντλημένο και δεν μπαίνει στο καλάθι.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:border-orange-200 hover:bg-orange-50/40">
                <input
                  type="checkbox"
                  checked={popular}
                  onChange={(event) => setPopular(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-bold text-gray-900">
                    <Flame className="h-3.5 w-3.5 text-orange-500" />
                    Δημοφιλές
                  </span>
                  <span className="mt-0.5 block text-gray-600">
                    Παίρνει σήμανση στον κατάλογο των πελατών.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* ------------------------------ Ενέργειες -------------------- */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Αποθήκευση…
                </>
              ) : item ? (
                "Αποθήκευση αλλαγών"
              ) : (
                "Προσθήκη στον κατάλογο"
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl px-6 py-4 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Άκυρο
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
