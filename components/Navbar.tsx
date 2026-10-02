"use client";

/* ==========================================================================
 *  Buka Delivery — components/Navbar.tsx
 *
 *  Sticky header με logo, επιλογέα διεύθυνσης, κουμπί καλαθιού και το
 *  <UserMenu />, που αναλαμβάνει όλη τη λογική σύνδεσης/εγγραφής.
 *
 *  ── ΔΙΕΥΘΥΝΣΕΙΣ ─────────────────────────────────────────────────────────
 *  Ο επιλογέας δείχνει ΜΟΝΟ τις αποθηκευμένες διευθύνσεις του συνδεδεμένου
 *  χρήστη. Η ετικέτα («Σπίτι») είναι για εμφάνιση· αυτό που επιλέγεται και
 *  φτάνει στο checkout είναι η οδός και η πόλη. Διευθύνσεις χωρίς έγκυρη οδό
 *  εμφανίζονται απενεργοποιημένες, ώστε να μη χαθεί ποτέ η πραγματική
 *  διεύθυνση πίσω από μια ετικέτα.
 *
 *  Δεν υπάρχουν πια ενδεικτικές/προεπιλεγμένες διευθύνσεις: ο επισκέπτης
 *  συμπληρώνει τη διεύθυνσή του στο checkout.
 * ========================================================================== */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LogIn, MapPin, ShoppingBag } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { cleanSingleLine, isUsableStreet } from "@/lib/checkout/validation";
import { normalizePostalCode } from "@/lib/shop/postal-code";
import { cn } from "@/lib/format";
import type { UserAddress } from "@/lib/auth";

type AddressOption = {
  address: UserAddress;
  usable: boolean;
  title: string;
  detail: string;
};

export default function Navbar() {
  const { deliveryAddress, selectDeliveryAddress, totals, openCart, hydrated } = useCart();
  const { profile, user, isAuthenticated, openLogin } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileRef = useRef<HTMLDivElement | null>(null);

  /* Μόνο διευθύνσεις του ΤΡΕΧΟΝΤΟΣ χρήστη (το προφίλ ενημερώνεται ασύγχρονα) */
  const options = useMemo<AddressOption[]>(() => {
    if (!isAuthenticated || !user || !profile || profile.uid !== user.uid) return [];

    return profile.addresses.map((address) => {
      const street = cleanSingleLine(address.street);
      const city = cleanSingleLine(address.city ?? "");
      const label = cleanSingleLine(address.label);
      const usable = isUsableStreet(street);
      const location = [street, city].filter(Boolean).join(", ");

      return {
        address,
        usable,
        title: label || street || "Διεύθυνση",
        detail: usable ? location : "Λείπει η οδός — συμπλήρωσέ τη στο ταμείο",
      };
    });
  }, [isAuthenticated, user, profile]);

  /* Κλείσιμο dropdown με κλικ εκτός ή Escape.
   * Ελέγχονται ΚΑΙ τα δύο containers (desktop + mobile): αλλιώς ένα πάτημα
   * μέσα στη λίστα του κινητού έκλεινε τη λίστα πριν καταγραφεί η επιλογή. */
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside =
        dropdownRef.current?.contains(target) || mobileRef.current?.contains(target);
      if (!inside) setIsOpen(false);
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

  const chipTitle = deliveryAddress
    ? deliveryAddress.label || deliveryAddress.street
    : "Προσθήκη διεύθυνσης";
  const chipDetail = deliveryAddress
    ? [deliveryAddress.street, deliveryAddress.city].filter(Boolean).join(", ")
    : null;

  const chooseAddress = (option: AddressOption) => {
    if (!option.usable || !user) return;
    const postalCode = normalizePostalCode(option.address.postalCode);
    selectDeliveryAddress({
      sourceId: option.address.id,
      sourceUid: user.uid,
      label: cleanSingleLine(option.address.label),
      street: cleanSingleLine(option.address.street),
      city: cleanSingleLine(option.address.city ?? ""),
      /* Milestone 4: ΤΚ μόνο αν η αποθηκευμένη διεύθυνση έχει έγκυρο ρητό ΤΚ */
      ...(postalCode ? { postalCode } : {}),
      ...(option.address.notes ? { instructions: option.address.notes.trim() } : {}),
    });
    setIsOpen(false);
  };

  const addressList =
    options.length > 0 ? (
      <ul className="space-y-0.5" role="listbox" aria-label="Αποθηκευμένες διευθύνσεις">
        {options.map((option) => {
          const selected = deliveryAddress?.sourceId === option.address.id;
          return (
            <li key={option.address.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => chooseAddress(option)}
                disabled={!option.usable}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-gray-700"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{option.title}</span>
                    <span className="block truncate text-xs text-gray-500">{option.detail}</span>
                  </span>
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-orange-500" />}
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <div className="px-3 py-2 text-sm text-gray-600">
        <p>Τη διεύθυνση παράδοσης τη συμπληρώνεις στο ταμείο.</p>
        {!isAuthenticated && (
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openLogin();
            }}
            className="mt-2 flex items-center gap-1.5 text-xs font-bold text-orange-600 transition-colors hover:text-orange-700"
          >
            <LogIn className="h-3.5 w-3.5" />
            Σύνδεση για αποθηκευμένες διευθύνσεις
          </button>
        )}
      </div>
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
              <span className="truncate text-sm font-semibold text-gray-900">{chipTitle}</span>
              {chipDetail && chipDetail !== chipTitle && (
                <span className="mt-0.5 truncate text-[11px] text-gray-500">{chipDetail}</span>
              )}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {isOpen && (
            <div className="absolute top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-gray-900/10">
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Οι διευθύνσεις μου
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
      <div ref={mobileRef} className="border-t border-gray-100 px-4 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-2 text-left"
        >
          <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
          <span className="text-xs text-gray-500">Παράδοση σε:</span>
          <span className="truncate text-xs font-bold text-gray-900">
            {chipDetail ?? chipTitle}
          </span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {isOpen && <div className="mt-2 pb-1">{addressList}</div>}
      </div>
    </header>
  );
}
