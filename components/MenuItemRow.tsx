"use client";

/* ==========================================================================
 *  Buka Delivery — components/MenuItemRow.tsx
 *
 *  Γραμμή προϊόντος στον κατάλογο του καταστήματος.
 *  Το κουμπί «Προσθήκη» μετατρέπεται σε stepper −/+ μόλις το προϊόν μπει
 *  στο καλάθι. Όλη η λογική περνά από το useCart().
 * ========================================================================== */

import { Flame, Minus, Plus } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { cn, formatPrice } from "@/lib/format";
import type { MenuItem, Shop } from "@/types";

type MenuItemRowProps = {
  item: MenuItem;
  shop: Shop;
  /** Emoji της κατηγορίας, ως placeholder όταν λείπει εικόνα */
  fallbackEmoji?: string;
};

export default function MenuItemRow({
  item,
  shop,
  fallbackEmoji = "🍽️",
}: MenuItemRowProps) {
  const { addItem, decrease, getQuantity, hydrated } = useCart();

  const quantity = hydrated ? getQuantity(item.id) : 0;
  const isUnavailable = item.available === false;
  const hasDiscount = typeof item.oldPrice === "number" && item.oldPrice > item.price;

  return (
    <article
      className={cn(
        "group flex items-stretch gap-4 rounded-3xl border border-gray-100 bg-white p-4 transition-all duration-300",
        isUnavailable
          ? "opacity-60"
          : "hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-xl hover:shadow-gray-900/5",
      )}
    >
      {/* ---------------------------- Κείμενο ----------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={cn(
              "text-base font-extrabold tracking-tight text-gray-900 sm:text-lg",
              !isUnavailable && "transition-colors duration-300 group-hover:text-orange-600",
            )}
          >
            {item.name}
          </h3>

          {item.popular && !isUnavailable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
              <Flame className="h-3 w-3" />
              Δημοφιλές
            </span>
          )}

          {isUnavailable && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              Εξαντλήθηκε
            </span>
          )}
        </div>

        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">
          {item.description}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-3">
          <span className="text-lg font-black text-gray-900">
            {formatPrice(item.price)}
          </span>
          {hasDiscount && (
            <span className="text-sm font-medium text-gray-400 line-through">
              {formatPrice(item.oldPrice as number)}
            </span>
          )}
        </div>
      </div>

      {/* --------------------- Εικόνα + ενέργειες καλαθιού ----------------- */}
      <div className="relative flex shrink-0 flex-col items-end justify-between">
        <div
          className={cn(
            "h-24 w-24 overflow-hidden rounded-2xl bg-gradient-to-br sm:h-28 sm:w-28",
            shop.gradient,
          )}
        >
          {item.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.image}
              alt={item.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-3xl">
              {fallbackEmoji}
            </span>
          )}
        </div>

        {isUnavailable ? (
          <span className="absolute -bottom-1 right-0 rounded-full bg-gray-200 px-3 py-2 text-xs font-bold text-gray-500">
            Μη διαθέσιμο
          </span>
        ) : quantity > 0 ? (
          <div className="absolute -bottom-1 right-0 flex items-center gap-1 rounded-full border border-orange-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              onClick={() => decrease(item.id)}
              aria-label={`Μείωση ποσότητας για ${item.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-orange-600 transition-colors hover:bg-orange-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-5 text-center text-sm font-black text-gray-900">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => addItem(item, shop)}
              aria-label={`Αύξηση ποσότητας για ${item.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => addItem(item, shop)}
            aria-label={`Προσθήκη ${item.name} στο καλάθι`}
            className="absolute -bottom-1 right-0 flex h-9 items-center gap-1 rounded-full bg-orange-500 px-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-110 hover:bg-orange-600 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Προσθήκη
          </button>
        )}
      </div>
    </article>
  );
}

/* --------------------------------------------------------------------------
 *  Skeleton γραμμής μενού
 * -------------------------------------------------------------------------- */

export function MenuItemRowSkeleton() {
  return (
    <div className="flex gap-4 rounded-3xl border border-gray-100 bg-white p-4">
      <div className="flex-1 space-y-3">
        <div className="h-4 w-1/2 animate-pulse rounded-full bg-gray-200" />
        <div className="h-3 w-3/4 animate-pulse rounded-full bg-gray-100" />
        <div className="h-3 w-1/4 animate-pulse rounded-full bg-gray-100" />
      </div>
      <div className="h-24 w-24 animate-pulse rounded-2xl bg-gray-200 sm:h-28 sm:w-28" />
    </div>
  );
}
