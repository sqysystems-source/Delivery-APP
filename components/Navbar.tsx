"use client";

/* ==========================================================================
 *  Buka Delivery — components/Navbar.tsx   (ΕΝΗΜΕΡΩΜΕΝΟ με auth)
 *
 *  Sticky header με logo, επιλογέα διεύθυνσης, κουμπί καλαθιού και το
 *  <UserMenu />, που αναλαμβάνει όλη τη λογική σύνδεσης/εγγραφής.
 *
 *  Νέο: αν ο χρήστης είναι συνδεδεμένος και έχει αποθηκευμένες διευθύνσεις
 *  στο προφίλ του, ο επιλογέας δείχνει ΕΚΕΙΝΕΣ αντί για τις προεπιλεγμένες.
 * ========================================================================== */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, MapPin, ShoppingBag } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { fetchAddresses } from "@/lib/data";
import { cn } from "@/lib/format";

export default function Navbar() {
  const { address, setAddress, totals, openCart, hydrated } = useCart();
  const { profile } = useAuth();

  const [defaultAddresses, setDefaultAddresses] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  /* Προεπιλεγμένες διευθύνσεις (μέχρι να συνδεθεί ο χρήστης) */
  useEffect(() => {
    let cancelled = false;
    fetchAddresses().then((data) => {
      if (!cancelled) setDefaultAddresses(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Οι διευθύνσεις του προφίλ έχουν προτεραιότητα */
  const addresses = useMemo(() => {
    const saved = profile?.addresses ?? [];
    if (saved.length === 0) return defaultAddresses;

    return saved.map((item) => item.label?.trim() || item.street);
  }, [profile, defaultAddresses]);

  /* Κλείσιμο dropdown με κλικ εκτός ή Escape */
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const itemCount = hydrated ? totals.itemCount : 0;

  const addressList = (
    <>
      {addresses.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => {
            setAddress(item);
            setIsOpen(false);
          }}
          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-orange-50 hover:text-orange-600"
        >
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="truncate">{item}</span>
          </span>
          {address === item && <Check className="h-4 w-4 shrink-0 text-orange-500" />}
        </button>
      ))}
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/85 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
        {/* ------------------------------ Logo ------------------------------ */}
        <Link href="/" className="group flex shrink-0 items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-lg font-black text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 lg:h-10 lg:w-10">
            B
          </span>
          <span className="text-xl font-extrabold tracking-tight text-gray-900 lg:text-2xl">
            Buka
            <span className="text-orange-500">.</span>
            <span className="hidden font-light text-gray-500 sm:inline">delivery</span>
          </span>
        </Link>

        {/* ------------------- Επιλογέας διεύθυνσης (desktop) --------------- */}
        <div ref={dropdownRef} className="relative hidden flex-1 justify-center md:flex">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
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
              className={cn(
                "h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {isOpen && (
            <div className="absolute top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-gray-900/10">
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {profile && profile.addresses.length > 0
                  ? "Οι διευθύνσεις μου"
                  : "Δημοφιλείς περιοχές"}
              </p>
              {addressList}
            </div>
          )}
        </div>

        {/* ---------------------------- Ενέργειες --------------------------- */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={openCart}
            aria-label="Άνοιγμα καλαθιού"
            className="relative hidden h-11 w-11 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-all duration-300 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600 md:flex"
          >
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-white shadow-md">
                {itemCount}
              </span>
            )}
          </button>

          <UserMenu />
        </div>
      </nav>

      {/* -------------------- Επιλογέας διεύθυνσης (mobile) ---------------- */}
      <div className="border-t border-gray-100 px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-2 text-left"
        >
          <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
          <span className="text-xs text-gray-500">Παράδοση σε:</span>
          <span className="truncate text-xs font-bold text-gray-900">{address}</span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {isOpen && <div className="mt-2 space-y-1 pb-1">{addressList}</div>}
      </div>
    </header>
  );
}
