"use client";
/* ==========================================================================
 *  Buka Delivery — app/shop/[id]/page.tsx
 *
 *  Δυναμικό route για τον κατάλογο ενός καταστήματος.
 *
 *  Client Component: χρειάζεται state για την ενεργή κατηγορία, scroll-spy
 *  με IntersectionObserver και πρόσβαση στο καλάθι. Το `id` διαβάζεται με
 *  useParams(), οπότε δεν χρειάζεται await στο `params` (Next 15/16 friendly).
 *
 *  Layout:
 *    • Banner με εικόνα και κουμπί «Πίσω»
 *    • Strip πληροφοριών (βαθμολογία / χρόνος / μεταφορικά / ελάχιστη)
 *    • Sticky CategoryPills + sections προϊόντων (MenuItemRow)
 *    • CartPanel ως sticky sidebar από lg και πάνω
 * ========================================================================== */

import { useEffect, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  Bike,
  ChevronLeft,
  Clock,
  Info,
  ShoppingBag,
  Star,
} from "lucide-react";
import CategoryPills, {
  CategoryPillsSkeleton,
} from "@/components/CategoryPills";
import MenuItemRow, { MenuItemRowSkeleton } from "@/components/MenuItemRow";
import { CartPanel } from "@/components/CartDrawer";
import { fetchMenu, fetchShopById } from "@/lib/data";
import {
  TAG_TONES,
  cn,
  formatCount,
  formatDeliveryFee,
  formatEta,
  formatPrice,
  formatRating,
} from "@/lib/format";
import type { Menu, Shop } from "@/types";

export default function ShopPage() {
  const params = useParams();
  const shopId = typeof params?.id === "string" ? params.id : "";

  const [shop, setShop] = useState<Shop | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");

  /* -------------------------- Φόρτωση δεδομένων -------------------------- */
  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;

    setIsLoading(true);
    setMissing(false);

    Promise.all([fetchShopById(shopId), fetchMenu(shopId)])
      .then(([shopData, menuData]) => {
        if (cancelled) return;

        if (!shopData) {
          setMissing(true);
          return;
        }

        setShop(shopData);
        setMenu(menuData);
        setActiveCategory(menuData.categories[0]?.id ?? "");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shopId]);

  /* ------------ Scroll-spy: ενημέρωση ενεργής κατηγορίας ----------------- */
  useEffect(() => {
    if (!menu || menu.categories.length === 0) return;

    const sections = menu.categories
      .map((category) => document.getElementById(`menu-cat-${category.id}`))
      .filter((element): element is HTMLElement => element !== null);

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );

        const first = visible[0];
        if (first) {
          setActiveCategory(first.target.id.replace("menu-cat-", ""));
        }
      },
      { rootMargin: "-170px 0px -65% 0px", threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [menu]);

  /* --------------------- Κλικ σε pill → smooth scroll -------------------- */
  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);

    const element = document.getElementById(`menu-cat-${categoryId}`);
    if (!element) return;

    const top = element.getBoundingClientRect().top + window.scrollY - 160;
    window.scrollTo({ top, behavior: "smooth" });
  };

  /* --------------------------- 404 καταστήματος -------------------------- */
  if (missing) {
    notFound();
  }

  /* ------------------------------ Loading -------------------------------- */
  if (isLoading || !shop || !menu) {
    return <ShopPageSkeleton />;
  }

  return (
    <main className="bg-gray-50 pb-32 lg:pb-16">
      {/* ============================= BANNER ============================= */}
      <section className="relative h-56 w-full overflow-hidden bg-gray-900 sm:h-72 lg:h-80">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shop.image}
          alt={shop.name}
          className="h-full w-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />

        <Link
          href="/"
          className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2.5 text-sm font-bold text-gray-900 shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:bg-white sm:left-6 sm:top-6"
        >
          <ChevronLeft className="h-4 w-4" />
          Πίσω
        </Link>

        <div className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-7xl px-4 pb-5 sm:px-6 lg:px-8">
          {shop.tag && (
            <span
              className={cn(
                "mb-3 inline-block rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-lg",
                TAG_TONES[shop.tag.tone],
              )}
            >
              {shop.tag.label}
            </span>
          )}

          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
            {shop.name}
          </h1>
          <p className="mt-1 text-sm text-gray-200 sm:text-base">
            {shop.cuisineLabel} · {shop.address}
          </p>
        </div>
      </section>

      {/* ========================== ΠΛΗΡΟΦΟΡΙΕΣ =========================== */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="-mt-6 grid grid-cols-2 gap-3 rounded-3xl border border-gray-100 bg-white p-4 shadow-xl shadow-gray-900/5 sm:grid-cols-4 sm:p-5">
          {[
            {
              icon: Star,
              label: "Βαθμολογία",
              value: `${formatRating(shop.rating)} (${formatCount(shop.reviews)})`,
            },
            {
              icon: Clock,
              label: "Παράδοση",
              value: formatEta(shop.etaMinutes),
            },
            {
              icon: Bike,
              label: "Μεταφορικά",
              value: formatDeliveryFee(shop.deliveryFee),
            },
            {
              icon: ShoppingBag,
              label: "Ελάχιστη",
              value: formatPrice(shop.minOrder),
            },
          ].map((info) => (
            <div key={info.label} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-50">
                <info.icon className="h-5 w-5 text-orange-500" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="text-[11px] uppercase tracking-wider text-gray-400">
                  {info.label}
                </span>
                <span className="truncate text-sm font-bold text-gray-900">
                  {info.value}
                </span>
              </span>
            </div>
          ))}
        </div>

        {shop.freeDeliveryOver !== null && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p>
              Δωρεάν μεταφορικά για παραγγελίες άνω των{" "}
              <span className="font-bold">
                {formatPrice(shop.freeDeliveryOver)}
              </span>
              .
            </p>
          </div>
        )}
      </section>

      {/* ====================== ΜΕΝΟΥ + SIDEBAR ΚΑΛΑΘΙΟΥ ================== */}
      <div className="mx-auto mt-8 grid w-full max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        {/* ------------------------------ ΜΕΝΟΥ ------------------------- */}
        <div>
          {/* Sticky μπάρα κατηγοριών */}
          <div className="sticky top-[104px] z-30 -mx-4 border-b border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-20 lg:mx-0 lg:rounded-2xl lg:border lg:border-gray-100 lg:px-3">
            <CategoryPills
              options={menu.categories}
              activeId={activeCategory}
              onSelect={scrollToCategory}
              size="sm"
            />
          </div>

          {/* Ενότητες προϊόντων */}
          <div className="mt-6 space-y-10">
            {menu.categories.map((category) => {
              const items = menu.items.filter(
                (item) => item.categoryId === category.id,
              );
              if (items.length === 0) return null;

              return (
                <section
                  key={category.id}
                  id={`menu-cat-${category.id}`}
                  className="scroll-mt-44"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <span className="text-2xl leading-none">{category.emoji}</span>
                    <h2 className="text-2xl font-black tracking-tight text-gray-900">
                      {category.label}
                    </h2>
                    <span className="ml-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">
                      {items.length}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {items.map((item) => (
                      <MenuItemRow
                        key={item.id}
                        item={item}
                        shop={shop}
                        fallbackEmoji={category.emoji}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {menu.items.length === 0 && (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white py-16 text-center">
                <p className="text-lg font-bold text-gray-900">
                  Ο κατάλογος ετοιμάζεται
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Το κατάστημα δεν έχει ανεβάσει ακόμη προϊόντα.
                </p>
                <Link
                  href="/"
                  className="mt-6 inline-block rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-600"
                >
                  Δες άλλα μαγαζιά
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* -------------------- ΚΑΛΑΘΙ (desktop sidebar) ----------------- */}
        <aside className="hidden lg:block">
          <CartPanel />
        </aside>
      </div>
    </main>
  );
}

/* ==========================================================================
 *  Skeleton ολόκληρης της σελίδας
 * ========================================================================== */

function ShopPageSkeleton() {
  return (
    <main className="bg-gray-50 pb-32 lg:pb-16">
      <div className="h-56 w-full animate-pulse bg-gray-300 sm:h-72 lg:h-80" />

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="-mt-6 grid grid-cols-2 gap-3 rounded-3xl border border-gray-100 bg-white p-4 shadow-xl shadow-gray-900/5 sm:grid-cols-4 sm:p-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-2xl bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-gray-100" />
                <div className="h-3 w-1/2 animate-pulse rounded-full bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto mt-8 grid w-full max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div>
          <CategoryPillsSkeleton count={4} />

          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <MenuItemRowSkeleton key={index} />
            ))}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24 h-80 animate-pulse rounded-3xl border border-gray-100 bg-white" />
        </aside>
      </div>
    </main>
  );
}
