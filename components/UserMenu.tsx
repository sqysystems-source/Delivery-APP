"use client";

/* ==========================================================================
 *  Buka Delivery — components/UserMenu.tsx
 *
 *  Το κομμάτι του Navbar που αφορά τον χρήστη. Τρεις καταστάσεις:
 *
 *   1. Φορτώνει      → skeleton, ώστε να μην αναβοσβήνουν τα κουμπιά
 *   2. Αποσυνδεδεμένος → ghost «Σύνδεση» + solid dark «Εγγραφή»
 *   3. Συνδεδεμένος   → avatar με αρχικά + dropdown
 *
 *  Ο ανώνυμος χρήστης του checkout μετράει ως αποσυνδεδεμένος: έχει uid,
 *  αλλά δεν έχει λογαριασμό. Το `isAuthenticated` κάνει αυτή τη διάκριση.
 * ========================================================================== */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  LogIn,
  LogOut,
  MapPin,
  Receipt,
  UserCircle2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getInitials } from "@/lib/auth";
import { cn } from "@/lib/format";

export default function UserMenu({ className }: { className?: string }) {
  const {
    isAuthenticated,
    loading,
    profile,
    user,
    displayName,
    openLogin,
    openRegister,
    logout,
  } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /* Κλείσιμο με κλικ εκτός ή Escape */
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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

  /* ---------------------------- 1. Φόρτωση ---------------------------- */
  if (loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="hidden h-10 w-24 animate-pulse rounded-full bg-gray-100 sm:block" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-gray-100 sm:w-24" />
      </div>
    );
  }

  /* ------------------------ 2. Αποσυνδεδεμένος ------------------------ */
  if (!isAuthenticated) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {/* Ghost — διακριτικό, με εικονίδιο */}
        <button
          type="button"
          onClick={openLogin}
          className="hidden items-center gap-1.5 rounded-full border border-transparent px-4 py-2.5 text-sm font-semibold text-gray-700 transition-all duration-300 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 sm:flex"
        >
          <LogIn className="h-4 w-4" />
          Σύνδεση
        </button>

        {/* Solid dark — η κύρια ενέργεια */}
        <button
          type="button"
          onClick={openRegister}
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gray-900/10 transition-all duration-300 hover:scale-105 hover:bg-orange-500 hover:shadow-xl hover:shadow-orange-500/30"
        >
          Εγγραφή
        </button>

        {/* Σε πολύ μικρές οθόνες, η Σύνδεση γίνεται εικονίδιο */}
        <button
          type="button"
          onClick={openLogin}
          aria-label="Σύνδεση"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600 sm:hidden"
        >
          <LogIn className="h-4 w-4" />
        </button>
      </div>
    );
  }

  /* ------------------------- 3. Συνδεδεμένος -------------------------- */
  const initials = getInitials(displayName, "Β");
  const email = profile?.email || user?.email || "";

  const menuItems = [
    { href: "/orders", label: "Οι παραγγελίες μου", icon: Receipt },
    { href: "/profile", label: "Το προφίλ μου", icon: UserCircle2 },
    { href: "/profile/addresses", label: "Οι διευθύνσεις μου", icon: MapPin },
  ];

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-gray-200 py-1.5 pl-1.5 pr-2 transition-all duration-300 hover:border-orange-300 hover:bg-orange-50 sm:pr-3"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 text-xs font-black text-white">
          {initials}
        </span>
        <span className="hidden max-w-28 truncate text-sm font-semibold text-gray-900 sm:block">
          {displayName.split(" ")[0]}
        </span>
        <ChevronDown
          className={cn(
            "hidden h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300 sm:block",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl shadow-gray-900/10"
        >
          {/* Στοιχεία χρήστη */}
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 text-sm font-black text-white">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-bold text-gray-900">
                {displayName}
              </span>
              {email && (
                <span className="truncate text-xs text-gray-500">{email}</span>
              )}
            </span>
          </div>

          {/* Σύνδεσμοι */}
          <nav className="p-2">
            {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-orange-50 hover:text-orange-600"
              >
                <item.icon className="h-4 w-4 text-gray-400" />
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Αποσύνδεση */}
          <div className="border-t border-gray-100 p-2">
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  await logout();
                  setIsOpen(false);
                } finally {
                  setSigningOut(false);
                }
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 text-gray-400" />
              {signingOut ? "Αποσύνδεση…" : "Αποσύνδεση"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
