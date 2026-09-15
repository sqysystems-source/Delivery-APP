"use client";

import { useState } from "react";
import {
  MapPin,
  Search,
  Star,
  Clock,
  ChevronDown,
  ChevronRight,
  Bike,
  ShieldCheck,
  Percent,
  Timer,
  Store,
  Heart,
  User,
  Home,
  ShoppingBag,
  Sparkles,
  Check,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*                                  ΔΕΔΟΜΕΝΑ                                   */
/* -------------------------------------------------------------------------- */

type Category = {
  id: string;
  label: string;
  emoji: string;
};

const CATEGORIES: Category[] = [
  { id: "all", label: "Όλα", emoji: "🍽️" },
  { id: "souvlaki", label: "Σουβλάκι", emoji: "🥙" },
  { id: "pizza", label: "Πίτσα", emoji: "🍕" },
  { id: "burger", label: "Burger", emoji: "🍔" },
  { id: "coffee", label: "Καφές", emoji: "☕" },
  { id: "sweets", label: "Γλυκά", emoji: "🍰" },
  { id: "greek", label: "Μαγειρευτά", emoji: "🍲" },
  { id: "sushi", label: "Sushi", emoji: "🍣" },
  { id: "crepes", label: "Κρέπες", emoji: "🥞" },
  { id: "healthy", label: "Υγιεινά", emoji: "🥗" },
];

type Shop = {
  id: number;
  name: string;
  cuisine: string;
  rating: number;
  reviews: number;
  time: string;
  minOrder: string;
  image: string;
  tag?: { label: string; tone: "green" | "orange" | "purple" };
  gradient: string;
};

const SHOPS: Shop[] = [
  {
    id: 1,
    name: "Οβελιστήριο ο Γιάννης",
    cuisine: "Σουβλάκι • Ψητά • Μεζέδες",
    rating: 4.8,
    reviews: 1240,
    time: "25-35'",
    minOrder: "Ελάχιστη: 5,00€",
    image:
      "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=900&q=80",
    tag: { label: "Δωρεάν Delivery", tone: "green" },
    gradient: "from-amber-200 to-orange-300",
  },
  {
    id: 2,
    name: "Pizza Roma",
    cuisine: "Πίτσα • Ιταλικά • Ζυμαρικά",
    rating: 4.6,
    reviews: 863,
    time: "30-40'",
    minOrder: "Ελάχιστη: 8,00€",
    image:
      "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80",
    tag: { label: "1+1 Δώρο", tone: "orange" },
    gradient: "from-red-200 to-orange-300",
  },
  {
    id: 3,
    name: "The Burger Project",
    cuisine: "Burger • Smash • Finger Food",
    rating: 4.9,
    reviews: 2105,
    time: "20-30'",
    minOrder: "Ελάχιστη: 7,50€",
    image:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80",
    tag: { label: "Προσφορά -20%", tone: "orange" },
    gradient: "from-yellow-200 to-amber-300",
  },
  {
    id: 4,
    name: "Καφεκοπτείο Ελλάς",
    cuisine: "Καφές • Ροφήματα • Σνακ",
    rating: 4.7,
    reviews: 517,
    time: "15-25'",
    minOrder: "Ελάχιστη: 4,00€",
    image:
      "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=900&q=80",
    tag: { label: "Δωρεάν Delivery", tone: "green" },
    gradient: "from-stone-200 to-amber-200",
  },
  {
    id: 5,
    name: "Ζαχαροπλαστείο Μελίνα",
    cuisine: "Γλυκά • Τούρτες • Σιροπιαστά",
    rating: 4.9,
    reviews: 944,
    time: "35-45'",
    minOrder: "Ελάχιστη: 6,00€",
    image:
      "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80",
    tag: { label: "Νέο στο Buka", tone: "purple" },
    gradient: "from-pink-200 to-rose-300",
  },
  {
    id: 6,
    name: "Ταβέρνα το Στέκι της Πλατείας",
    cuisine: "Μαγειρευτά • Παραδοσιακά",
    rating: 4.5,
    reviews: 388,
    time: "40-50'",
    minOrder: "Ελάχιστη: 10,00€",
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80",
    gradient: "from-emerald-200 to-teal-300",
  },
];

const ADDRESSES = [
  "Κεντρική Πλατεία",
  "Οδός Ερμού 45",
  "Πανεπιστημιούπολη",
  "Παραλιακή Λεωφόρος 12",
];

const TAG_STYLES: Record<Shop["tag"] extends undefined ? never : "green" | "orange" | "purple", string> =
  {
    green: "bg-emerald-500/95 text-white",
    orange: "bg-orange-500/95 text-white",
    purple: "bg-violet-600/95 text-white",
  };

/* -------------------------------------------------------------------------- */
/*                                  ΣΕΛΙΔΑ                                     */
/* -------------------------------------------------------------------------- */

export default function HomePage() {
  const [address, setAddress] = useState(ADDRESSES[0]);
  const [addressOpen, setAddressOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");

  return (
    <div className="min-h-screen w-full bg-white font-sans text-gray-900 antialiased">
      {/* ------------------------------ NAVBAR ------------------------------ */}
      <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
          {/* Logo */}
          <a href="#" className="group flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-lg font-black text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 lg:h-10 lg:w-10">
              B
            </span>
            <span className="text-xl font-extrabold tracking-tight lg:text-2xl">
              Buka
              <span className="text-orange-500">.</span>
              <span className="font-light text-gray-500">delivery</span>
            </span>
          </a>

          {/* Επιλογή διεύθυνσης */}
          <div className="relative hidden flex-1 justify-center md:flex">
            <button
              onClick={() => setAddressOpen((v) => !v)}
              className="group flex max-w-xs items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-left transition-all duration-300 hover:border-orange-300 hover:bg-orange-50 hover:shadow-md"
            >
              <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Παράδοση σε
                </span>
                <span className="truncate text-sm font-semibold text-gray-900">
                  {address}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300 ${
                  addressOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {addressOpen && (
              <div className="absolute top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-gray-900/10">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Οι διευθύνσεις μου
                </p>
                {ADDRESSES.map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setAddress(item);
                      setAddressOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-orange-50 hover:text-orange-600"
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      {item}
                    </span>
                    {address === item && (
                      <Check className="h-4 w-4 text-orange-500" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ενέργειες */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-300 hover:bg-gray-100 hover:text-gray-900 sm:block">
              Σύνδεση
            </button>
            <button className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gray-900/10 transition-all duration-300 hover:scale-105 hover:bg-orange-500 hover:shadow-xl hover:shadow-orange-500/30">
              Εγγραφή
            </button>
          </div>
        </nav>

        {/* Διεύθυνση σε mobile */}
        <div className="border-t border-gray-100 px-4 py-2 md:hidden">
          <button
            onClick={() => setAddressOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-left"
          >
            <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="text-xs text-gray-500">Παράδοση σε:</span>
            <span className="truncate text-xs font-bold text-gray-900">
              {address}
            </span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-400" />
          </button>
          {addressOpen && (
            <div className="mt-2 space-y-1 pb-1">
              {ADDRESSES.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setAddress(item);
                    setAddressOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-600"
                >
                  {item}
                  {address === item && (
                    <Check className="h-4 w-4 text-orange-500" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* -------------------------------- HERO ------------------------------- */}
      <section className="relative overflow-hidden bg-gray-50">
        {/* Διακοσμητικά φόντου */}
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" />

        <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-28">
          {/* Αριστερά: κείμενο + αναζήτηση */}
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

            {/* Μπάρα αναζήτησης */}
            <div className="mt-8 w-full max-w-xl">
              <div className="flex flex-col gap-2 rounded-3xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/5 transition-all duration-300 focus-within:border-orange-300 focus-within:shadow-2xl focus-within:shadow-orange-500/10 sm:flex-row sm:rounded-full sm:p-2">
                <div className="flex flex-1 items-center gap-3 px-4 py-2">
                  <MapPin className="h-5 w-5 shrink-0 text-orange-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Δώσε τη διεύθυνσή σου…"
                    className="w-full bg-transparent text-base font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
                  />
                </div>
                <button className="flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 hover:shadow-xl hover:shadow-orange-500/40 active:scale-95 sm:rounded-full">
                  <Search className="h-5 w-5" />
                  Αναζήτηση
                </button>
              </div>
              <p className="mt-3 pl-2 text-xs text-gray-500">
                Δημοφιλή:{" "}
                <span className="font-semibold text-gray-700">Σουβλάκι</span> ·{" "}
                <span className="font-semibold text-gray-700">Πίτσα</span> ·{" "}
                <span className="font-semibold text-gray-700">Καφές</span>
              </p>
            </div>

            {/* Trust badges */}
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              {[
                { icon: Store, value: "180+", label: "τοπικά μαγαζιά" },
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

          {/* Δεξιά: εικόνα */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-orange-400 via-amber-300 to-red-400 opacity-20 blur-2xl" />

            <div className="group relative aspect-[4/5] w-full rotate-3 overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-200 to-amber-300 shadow-2xl shadow-orange-900/20 transition-all duration-500 hover:rotate-0 hover:scale-[1.03] hover:shadow-orange-900/30 sm:aspect-[4/4.5]">
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

            {/* Κάρτα: παράδοση */}
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

            {/* Κάρτα: βαθμολογία */}
            <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10 transition-transform duration-300 hover:-translate-y-1 sm:-right-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
                <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-bold text-gray-900">4,8 / 5</span>
                <span className="text-xs text-gray-500">
                  από 12.400 πελάτες
                </span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------- ΚΑΤΗΓΟΡΙΕΣ ---------------------------- */}
      <section className="border-b border-gray-100 bg-white py-8 sm:py-12">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
              Τι σου άνοιξε η όρεξη;
            </h2>
            <a
              href="#"
              className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-orange-600 transition-colors hover:text-orange-700 sm:flex"
            >
              Όλες οι κατηγορίες
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
                    active
                      ? "border-orange-500 bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                      : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-600"
                  }`}
                >
                  <span className="text-lg leading-none">{cat.emoji}</span>
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ------------------------- ΠΡΟΤΕΙΝΟΜΕΝΑ ΜΑΓΑΖΙΑ ---------------------- */}
      <section className="bg-gray-50 py-14 sm:py-20">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col gap-2 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="text-sm font-bold uppercase tracking-wider text-orange-500">
                Επιλεγμένα για σένα
              </span>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
                Τα αγαπημένα της πόλης
              </h2>
              <p className="mt-2 text-sm text-gray-600 sm:text-base">
                Μαγαζιά που ξεχωρίζουν για τη γεύση και τη συνέπειά τους.
              </p>
            </div>
            <a
              href="#"
              className="inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-orange-300 hover:text-orange-600 hover:shadow-lg sm:self-auto"
            >
              Δες όλα τα μαγαζιά
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SHOPS.map((shop) => (
              <article
                key={shop.id}
                className="group cursor-pointer overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-orange-200 hover:shadow-2xl hover:shadow-gray-900/10"
              >
                {/* Εικόνα */}
                <div
                  className={`relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br ${shop.gradient}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shop.image}
                    alt={shop.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  {shop.tag && (
                    <span
                      className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-lg backdrop-blur-sm ${
                        TAG_STYLES[shop.tag.tone]
                      }`}
                    >
                      {shop.tag.label}
                    </span>
                  )}

                  <button
                    aria-label="Προσθήκη στα αγαπημένα"
                    className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-md backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:bg-white hover:text-red-500"
                  >
                    <Heart className="h-4 w-4" />
                  </button>

                  <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-gray-900 shadow-md backdrop-blur-sm">
                    <Clock className="h-3.5 w-3.5 text-orange-500" />
                    {shop.time}
                  </span>
                </div>

                {/* Περιεχόμενο */}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-extrabold leading-snug tracking-tight text-gray-900 transition-colors duration-300 group-hover:text-orange-600">
                      {shop.name}
                    </h3>
                    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
                      <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                      {shop.rating.toFixed(1).replace(".", ",")}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-gray-500">{shop.cuisine}</p>

                  <div className="mt-4 flex items-center justify-between border-t border-dashed border-gray-100 pt-4">
                    <span className="text-xs font-semibold text-gray-600">
                      {shop.minOrder}
                    </span>
                    <span className="text-xs text-gray-400">
                      {shop.reviews.toLocaleString("el-GR")} κριτικές
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------ ΓΙΑΤΙ BUKA --------------------------- */}
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

      {/* -------------------------------- CTA -------------------------------- */}
      <section className="bg-white px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
        <div className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 px-6 py-14 text-center shadow-2xl shadow-orange-500/30 sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" />

          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
              Έχεις μαγαζί; Φέρ&apos; το στο Buka.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-orange-50 sm:text-lg">
              Δώσε στην επιχείρησή σου μια premium ψηφιακή παρουσία και βρες
              νέους πελάτες στην περιοχή σου — χωρίς κρυφές χρεώσεις.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button className="w-full rounded-full bg-white px-8 py-4 text-base font-bold text-orange-600 shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-2xl active:scale-95 sm:w-auto">
                Γίνε συνεργάτης
              </button>
              <button className="w-full rounded-full border-2 border-white/40 px-8 py-4 text-base font-bold text-white transition-all duration-300 hover:scale-105 hover:border-white hover:bg-white/10 active:scale-95 sm:w-auto">
                Μάθε περισσότερα
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------- FOOTER ------------------------------ */}
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
                Το τοπικό delivery της επαρχίας, φτιαγμένο με μεράκι για τα
                μαγαζιά της γειτονιάς σου.
              </p>
            </div>

            {[
              {
                title: "Buka Delivery",
                links: ["Σχετικά με εμάς", "Καριέρα", "Blog", "Τύπος"],
              },
              {
                title: "Βοήθεια",
                links: [
                  "Συχνές ερωτήσεις",
                  "Επικοινωνία",
                  "Όροι χρήσης",
                  "Απόρρητο",
                ],
              },
              {
                title: "Συνεργάτες",
                links: [
                  "Εγγραφή καταστήματος",
                  "Γίνε διανομέας",
                  "Buka για εταιρείες",
                ],
              },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-extrabold uppercase tracking-wider text-gray-900">
                  {col.title}
                </h4>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
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
            <p className="text-xs text-gray-500">
              Φτιαγμένο με ❤️ στην Ελλάδα
            </p>
          </div>
        </div>
      </footer>

      {/* -------------------- MOBILE BOTTOM NAV (native feel) ---------------- */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-100 bg-white/90 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-2">
          {[
            { icon: Home, label: "Αρχική", active: true },
            { icon: Search, label: "Αναζήτηση", active: false },
            { icon: ShoppingBag, label: "Καλάθι", active: false },
            { icon: User, label: "Προφίλ", active: false },
          ].map((item) => (
            <button
              key={item.label}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition-colors duration-200 ${
                item.active
                  ? "text-orange-600"
                  : "text-gray-400 hover:text-gray-700"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
