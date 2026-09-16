"use client";

/* ==========================================================================
 *  Buka Delivery — app/page.tsx
 *
 *  Η αρχική σελίδα (storefront):
 *    1. Hero με αναζήτηση
 *    2. Κατηγορίες κουζίνας (CategoryPills)
 *    3. Grid καταστημάτων (ShopCard) με φιλτράρισμα
 *    4. Γιατί Buka / CTA συνεργατών / Footer
 *    5. Bottom nav για κινητά
 *
 *  Client Component, γιατί κρατά state αναζήτησης και φίλτρων.
 *  Τα δεδομένα έρχονται από το `lib/data.ts` — καμία απευθείας επαφή με mock.
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  Home as HomeIcon,
  Percent,
  Search as SearchIcon,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Store as StoreIcon,
  Timer,
  User,
} from "lucide-react";
import CategoryPills from "@/components/CategoryPills";
import ShopCard, { ShopCardSkeleton } from "@/components/ShopCard";
import { useCart } from "@/context/CartContext";
import { fetchCuisines, fetchShops } from "@/lib/data";
import type { Cuisine, Shop } from "@/types";

export default function HomePage() {
  const { totals, openCart, hydrated } = useCart();

  const [shops, setShops] = useState<Shop[]>([]);
  const [cuisines, setCuisines] = useState<Cuisine[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [activeCuisine, setActiveCuisine] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  /* -------------------------- Φόρτωση δεδομένων -------------------------- */
  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchShops(), fetchCuisines()])
      .then(([shopData, cuisineData]) => {
        if (cancelled) return;
        setShops(shopData);
        setCuisines(cuisineData);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* ----------------------------- Φιλτράρισμα ----------------------------- */
  const visibleShops = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return shops.filter((shop) => {
      const matchesCuisine =
        activeCuisine === "all" || shop.cuisineIds.includes(activeCuisine);
      const matchesTerm =
        term.length === 0 ||
        shop.name.toLowerCase().includes(term) ||
        shop.cuisineLabel.toLowerCase().includes(term);

      return matchesCuisine && matchesTerm;
    });
  }, [shops, activeCuisine, searchTerm]);

  /* Το bottom nav κρύβεται όταν εμφανίζεται η μπάρα του καλαθιού */
  const showBottomNav = !hydrated || totals.itemCount === 0;

  return (
    <>
      <main className="bg-white">
        {/* ============================== HERO ============================= */}
        <section className="relative overflow-hidden bg-gray-50">
          <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" />

          <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
            {/* ------------------------ Κείμενο ------------------------- */}
            <div className="flex flex-col items-start">
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-orange-600">
                <Sparkles className="h-3.5 w-3.5" />
                Τοπικά μαγαζιά, τοπικές τιμές
              </span>

              <h1 className="text-[2.5rem] font-black leading-[1.05] tracking-tight text-gray-900 sm:text-6xl lg:text-7xl">
                Το αγαπημένο σου
                <br />
                φαγητό,{" "}
                <span className="relative inline-block">
                  <span className="relative z-10 bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
                    στην πόρτα σου
                  </span>
                  <span className="absolute -bottom-1 left-0 z-0 h-3 w-full rounded-full bg-orange-200/70 sm:h-4" />
                </span>{" "}
                σε 1&apos;
              </h1>

              <p className="mt-6 max-w-lg text-base leading-relaxed text-gray-600 sm:text-lg">
                Παράγγειλε από τα καλύτερα μαγαζιά της πόλης σου. Ζεστό φαγητό,
                δίκαιες τιμές και παράδοση που δεν σε αφήνει να περιμένεις.
              </p>

              {/* --------------------- Αναζήτηση --------------------- */}
              <div className="mt-8 w-full max-w-xl">
                <div className="flex flex-col gap-2 rounded-3xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/5 transition-all duration-300 focus-within:border-orange-300 focus-within:shadow-2xl focus-within:shadow-orange-500/10 sm:flex-row sm:rounded-full">
                  <div className="flex flex-1 items-center gap-3 px-4 py-2">
                    <SearchIcon className="h-5 w-5 shrink-0 text-orange-500" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Ψάξε μαγαζί ή κουζίνα…"
                      aria-label="Αναζήτηση καταστήματος"
                      className="w-full bg-transparent text-base font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      document
                        .getElementById("shops")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 hover:shadow-xl hover:shadow-orange-500/40 active:scale-95 sm:rounded-full"
                  >
                    <SearchIcon className="h-5 w-5" />
                    Αναζήτηση
                  </button>
                </div>

                <p className="mt-3 pl-2 text-xs text-gray-500">
                  Δημοφιλή:{" "}
                  {["Σουβλάκι", "Πίτσα", "Καφές"].map((term, index) => (
                    <span key={term}>
                      {index > 0 && " · "}
                      <button
                        type="button"
                        onClick={() => setSearchTerm(term)}
                        className="font-semibold text-gray-700 transition-colors hover:text-orange-600"
                      >
                        {term}
                      </button>
                    </span>
                  ))}
                </p>
              </div>

              {/* ----------------------- Στατιστικά ------------------- */}
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
                {[
                  { icon: StoreIcon, value: "180+", label: "τοπικά μαγαζιά" },
                  { icon: Timer, value: "28'", label: "μέσος χρόνος" },
                  { icon: Star, value: "4,8", label: "μέση βαθμολογία" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-md shadow-gray-900/5">
                      <stat.icon className="h-5 w-5 text-orange-500" />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-lg font-extrabold text-gray-900">
                        {stat.value}
                      </span>
                      <span className="text-xs text-gray-500">{stat.label}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ------------------------- Εικόνα ------------------------- */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-orange-400 via-amber-300 to-red-400 opacity-20 blur-2xl" />

              <div className="group relative aspect-[4/5] w-full rotate-3 overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-200 to-amber-300 shadow-2xl shadow-orange-900/20 transition-all duration-500 hover:rotate-0 hover:scale-[1.03] sm:aspect-[4/4.5]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80"
                  alt="Πιάτο με φρέσκο φαγητό"
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

                <div className="absolute bottom-5 left-5 right-5 text-white">
                  <p className="text-xs font-semibold uppercase tracking-widest text-orange-200">
                    Σήμερα στην πόλη σου
                  </p>
                  <p className="mt-1 text-2xl font-black leading-tight">
                    Φρέσκο. Τοπικό. Στην ώρα του.
                  </p>
                </div>
              </div>

              <div className="absolute -left-2 top-8 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10 transition-transform duration-300 hover:-translate-y-1 sm:-left-8">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100">
                  <Bike className="h-5 w-5 text-orange-600" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-bold text-gray-900">
                    Παράδοση σε 22&apos;
                  </span>
                  <span className="text-xs text-gray-500">Ο διανομέας ξεκίνησε</span>
                </span>
              </div>

              <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10 transition-transform duration-300 hover:-translate-y-1 sm:-right-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
                  <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-bold text-gray-900">4,8 / 5</span>
                  <span className="text-xs text-gray-500">από 12.400 πελάτες</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =========================== ΚΑΤΗΓΟΡΙΕΣ ========================== */}
        <section className="border-b border-gray-100 bg-white py-8 sm:py-12">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="mb-5 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
              Τι σου άνοιξε η όρεξη;
            </h2>

            <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
              <CategoryPills
                options={cuisines}
                activeId={activeCuisine}
                onSelect={setActiveCuisine}
                size="lg"
                autoScrollToActive={false}
              />
            </div>
          </div>
        </section>

        {/* ========================= ΚΑΤΑΣΤΗΜΑΤΑ =========================== */}
        <section id="shops" className="scroll-mt-24 bg-gray-50 py-14 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 sm:mb-10">
              <span className="text-sm font-bold uppercase tracking-wider text-orange-500">
                Επιλεγμένα για σένα
              </span>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
                Τα αγαπημένα της πόλης
              </h2>
              <p className="mt-2 text-sm text-gray-600 sm:text-base">
                Διάλεξε μαγαζί για να δεις τον κατάλογο και να παραγγείλεις.
              </p>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <ShopCardSkeleton key={index} />
                ))}
              </div>
            ) : visibleShops.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white py-16 text-center">
                <p className="text-lg font-bold text-gray-900">
                  Δεν βρέθηκαν καταστήματα
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Δοκίμασε άλλη κατηγορία ή καθάρισε την αναζήτηση.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCuisine("all");
                    setSearchTerm("");
                  }}
                  className="mt-6 rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-600"
                >
                  Καθαρισμός φίλτρων
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {visibleShops.map((shop, index) => (
                  <ShopCard key={shop.id} shop={shop} eager={index < 3} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* =========================== ΓΙΑΤΙ BUKA ========================== */}
        <section className="bg-white py-14 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[
                {
                  icon: Timer,
                  title: "Γρήγορη παράδοση",
                  text: "Μέσος χρόνος 28 λεπτά, με ζωντανή παρακολούθηση της παραγγελίας σου.",
                },
                {
                  icon: Percent,
                  title: "Καθημερινές προσφορές",
                  text: "Αποκλειστικές εκπτώσεις από τα τοπικά μαγαζιά, κάθε μέρα.",
                },
                {
                  icon: ShieldCheck,
                  title: "Ασφαλείς πληρωμές",
                  text: "Κάρτα, μετρητά ή digital wallet — όπως σε βολεύει, με πλήρη ασφάλεια.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="group rounded-3xl border border-gray-100 bg-gray-50 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-orange-200 hover:bg-white hover:shadow-xl"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                    <item.icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-5 text-lg font-extrabold tracking-tight text-gray-900">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* =============================== CTA ============================= */}
        <section className="bg-white px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
          <div className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 px-6 py-14 text-center shadow-2xl shadow-orange-500/30 sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" />

            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                Έχεις μαγαζί; Φέρ&apos; το στο Buka.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-orange-50 sm:text-lg">
                Δώσε στην επιχείρησή σου μια premium ψηφιακή παρουσία και βρες νέους
                πελάτες στην περιοχή σου — χωρίς κρυφές χρεώσεις.
              </p>

              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button
                  type="button"
                  className="w-full rounded-full bg-white px-8 py-4 text-base font-bold text-orange-600 shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 sm:w-auto"
                >
                  Γίνε συνεργάτης
                </button>
                <button
                  type="button"
                  className="w-full rounded-full border-2 border-white/40 px-8 py-4 text-base font-bold text-white transition-all duration-300 hover:scale-105 hover:border-white hover:bg-white/10 active:scale-95 sm:w-auto"
                >
                  Μάθε περισσότερα
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ============================== FOOTER ============================= */}
      <footer className="border-t border-gray-100 bg-gray-50 pb-24 pt-14 md:pb-14">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-lg font-black text-white">
                  B
                </span>
                <span className="text-xl font-extrabold tracking-tight text-gray-900">
                  Buka<span className="text-orange-500">.</span>
                </span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-gray-600">
                Το τοπικό delivery της επαρχίας, φτιαγμένο με μεράκι για τα μαγαζιά
                της γειτονιάς σου.
              </p>
            </div>

            {[
              {
                title: "Buka Delivery",
                links: ["Σχετικά με εμάς", "Καριέρα", "Blog", "Τύπος"],
              },
              {
                title: "Βοήθεια",
                links: ["Συχνές ερωτήσεις", "Επικοινωνία", "Όροι χρήσης", "Απόρρητο"],
              },
              {
                title: "Συνεργάτες",
                links: [
                  "Εγγραφή καταστήματος",
                  "Γίνε διανομέας",
                  "Buka για εταιρείες",
                ],
              },
            ].map((column) => (
              <div key={column.title}>
                <h4 className="text-sm font-extrabold uppercase tracking-wider text-gray-900">
                  {column.title}
                </h4>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link}>
                      <a
                        href="#"
                        className="text-sm text-gray-600 transition-colors duration-200 hover:text-orange-600"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-200 pt-6 sm:flex-row">
            <p className="text-xs text-gray-500">
              © {new Date().getFullYear()} Buka Delivery. Με επιφύλαξη παντός
              δικαιώματος.
            </p>
            <p className="text-xs text-gray-500">Φτιαγμένο με ❤️ στην Ελλάδα</p>
          </div>
        </div>
      </footer>

      {/* ====================== BOTTOM NAV (μόνο κινητό) =================== */}
      {showBottomNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-100 bg-white/90 backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-2">
            {[
              { icon: HomeIcon, label: "Αρχική", active: true },
              { icon: SearchIcon, label: "Αναζήτηση", active: false },
              { icon: ShoppingBag, label: "Καλάθι", active: false },
              { icon: User, label: "Προφίλ", active: false },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (item.label === "Καλάθι") openCart();
                  if (item.label === "Αναζήτηση") {
                    document
                      .getElementById("shops")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className={`flex flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition-colors duration-200 ${
                  item.active ? "text-orange-600" : "text-gray-400 hover:text-gray-700"
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
