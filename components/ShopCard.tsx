"use client";

/* ==========================================================================
 *  Buka Delivery — components/ShopCard.tsx
 *
 *  Κάρτα καταστήματος για το grid της αρχικής. Ολόκληρη η κάρτα είναι
 *  <Link> προς /shop/[id]. Το κουμπί «αγαπημένα» σταματά το propagation
 *  ώστε να μην ακολουθεί το link.
 *
 *  Περιλαμβάνει και το <ShopCardSkeleton /> για τα loading states.
 * ========================================================================== */

import Link from "next/link";
import { Clock, Heart, Star } from "lucide-react";
import type { Shop } from "@/types";
import {
  TAG_TONES,
  cn,
  formatCount,
  formatEta,
  formatPrice,
  formatRating,
} from "@/lib/format";

type ShopCardProps = {
  shop: Shop;
  /** Προαιρετικό: priority φόρτωση για τις πρώτες κάρτες του grid */
  eager?: boolean;
};

export default function ShopCard({ shop, eager = false }: ShopCardProps) {
  return (
    <Link
      href={`/shop/${shop.id}`}
      className="group block overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-orange-200 hover:shadow-2xl hover:shadow-gray-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
    >
      {/* ------------------------------ Εικόνα ------------------------------ */}
      <div
        className={cn(
          "relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br",
          shop.gradient,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shop.image}
          alt={shop.name}
          loading={eager ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {shop.tag && (
          <span
            className={cn(
              "absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-lg backdrop-blur-sm",
              TAG_TONES[shop.tag.tone],
            )}
          >
            {shop.tag.label}
          </span>
        )}

        <button
          type="button"
          aria-label={`Προσθήκη ${shop.name} στα αγαπημένα`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-md backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:bg-white hover:text-red-500"
        >
          <Heart className="h-4 w-4" />
        </button>

        <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-gray-900 shadow-md backdrop-blur-sm">
          <Clock className="h-3.5 w-3.5 text-orange-500" />
          {formatEta(shop.etaMinutes)}
        </span>
      </div>

      {/* --------------------------- Περιεχόμενο --------------------------- */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-extrabold leading-snug tracking-tight text-gray-900 transition-colors duration-300 group-hover:text-orange-600">
            {shop.name}
          </h3>
          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
            {formatRating(shop.rating)}
          </span>
        </div>

        <p className="mt-1 text-sm text-gray-500">{shop.cuisineLabel}</p>

        <div className="mt-4 flex items-center justify-between border-t border-dashed border-gray-100 pt-4">
          <span className="text-xs font-semibold text-gray-600">
            Ελάχιστη: {formatPrice(shop.minOrder)}
          </span>
          <span className="text-xs text-gray-400">
            {formatCount(shop.reviews)} κριτικές
          </span>
        </div>
      </div>
    </Link>
  );
}

/* --------------------------------------------------------------------------
 *  Skeleton — ίδιες διαστάσεις με την κάρτα, για μηδενικό layout shift
 * -------------------------------------------------------------------------- */

export function ShopCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
      <div className="aspect-[16/10] w-full animate-pulse bg-gray-200" />
      <div className="space-y-3 p-5">
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-gray-100" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-gray-100" />
      </div>
    </div>
  );
}
