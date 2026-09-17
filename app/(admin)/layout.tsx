"use client";

/* ==========================================================================
 *  Buka Delivery — app/(admin)/layout.tsx
 *
 *  Κέλυφος του B2B panel. Κάνει τρία πράγματα:
 *    1. Φυλάει την πρόσβαση (σύνδεση + ρόλος owner/admin)
 *    2. Βρίσκει το κατάστημα του χρήστη μία φορά (OwnerShopProvider)
 *    3. Δίνει τη μόνιμη πλοήγηση: Παραγγελίες / Κατάλογος / Ρυθμίσεις
 *
 *  Καμία σχέση με το storefront: δεν φορτώνει καλάθι, ούτε Navbar πελάτη.
 *
 *  ── Ο ΕΛΕΓΧΟΣ ΕΔΩ ΕΙΝΑΙ UX, ΟΧΙ ΑΣΦΑΛΕΙΑ ───────────────────────────────
 *  Τρέχει στον browser, άρα παρακάμπτεται με DevTools. Δεν πειράζει: χωρίς
 *  δικαίωμα στα Security Rules, η σελίδα δεν φέρνει ούτε μία παραγγελία και
 *  δεν γράφει ούτε ένα προϊόν. Η πραγματική προστασία είναι στο Firestore.
 *
 *  Middleware δεν βοηθά εδώ: το Firebase Auth κρατά το session σε IndexedDB,
 *  όχι σε cookie, οπότε ο edge δεν βλέπει ποιος είναι συνδεδεμένος.
 * ========================================================================== */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChefHat,
  ExternalLink,
  Loader2,
  LockKeyhole,
  LogIn,
  LogOut,
  Receipt,
  Settings,
  ShieldAlert,
  UtensilsCrossed,
} from "lucide-react";
import AuthModal from "@/components/AuthModal";
import { OwnerShopProvider, useOwnerShop } from "@/context/OwnerShopContext";
import { useAuth } from "@/context/AuthContext";
import { getInitials } from "@/lib/auth";
import { cn } from "@/lib/format";

/* --------------------------------------------------------------------------
 *  Πλοήγηση
 * -------------------------------------------------------------------------- */

const NAV_ITEMS = [
  { href: "/admin/orders", label: "Παραγγελίες", icon: Receipt },
  { href: "/admin/menu", label: "Κατάλογος", icon: UtensilsCrossed },
  { href: "/admin/settings", label: "Ρυθμίσεις", icon: Settings },
] as const;

/* ==========================================================================
 *  LAYOUT
 * ========================================================================== */

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated, profile, profileLoading, displayName, openLogin } =
    useAuth();

  /* ------------------------------ Φόρτωση ------------------------------- */
  if (loading || (isAuthenticated && profileLoading)) {
    return (
      <>
        <div className="flex min-h-dvh items-center justify-center bg-gray-100">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            <p className="text-sm font-semibold text-gray-500">Έλεγχος πρόσβασης…</p>
          </div>
        </div>
        <AuthModal />
      </>
    );
  }

  /* --------------------------- Μη συνδεδεμένος -------------------------- */
  if (!isAuthenticated) {
    return (
      <>
        <GateCard
          icon={<LockKeyhole className="h-8 w-8 text-gray-500" />}
          iconClass="bg-gray-100"
          title="Περιοχή καταστήματος"
          description="Συνδέσου με τον λογαριασμό του καταστήματός σου για να δεις τις παραγγελίες και τον κατάλογό σου."
          action={
            <button
              type="button"
              onClick={openLogin}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95"
            >
              <LogIn className="h-4 w-4" />
              Σύνδεση
            </button>
          }
        />
        <AuthModal />
      </>
    );
  }

  /* ---------------------------- Λάθος ρόλος ----------------------------- */
  const role = profile?.role ?? "customer";
  if (role !== "owner" && role !== "admin") {
    return (
      <>
        <GateCard
          icon={<ShieldAlert className="h-8 w-8 text-amber-600" />}
          iconClass="bg-amber-100"
          title="Δεν έχεις πρόσβαση"
          description={`Ο λογαριασμός ${displayName} δεν έχει δικαιώματα καταστήματος. Αν διαχειρίζεσαι μαγαζί στο Buka, επικοινώνησε μαζί μας για ενεργοποίηση.`}
          action={
            <Link
              href="/"
              className="block rounded-full bg-gray-900 px-6 py-4 text-center text-sm font-bold text-white transition-all duration-300 hover:scale-[1.02] hover:bg-orange-500"
            >
              Επιστροφή στο Buka
            </Link>
          }
        />
        <AuthModal />
      </>
    );
  }

  /* ------------------------------ Το panel ------------------------------ */
  return (
    <OwnerShopProvider>
      <div className="flex min-h-dvh flex-col bg-gray-100 lg:flex-row">
        <AdminNav />

        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      <AuthModal />
    </OwnerShopProvider>
  );
}

/* ==========================================================================
 *  ΠΛΟΗΓΗΣΗ
 *
 *  Desktop/tablet landscape → μόνιμη πλαϊνή στήλη.
 *  Μικρές οθόνες → header πάνω + tab bar κάτω, όπου φτάνει ο αντίχειρας.
 * ========================================================================== */

function AdminNav() {
  const pathname = usePathname();
  const { shopName, loading } = useOwnerShop();
  const { displayName, logout } = useAuth();

  const initials = getInitials(displayName, "Β");

  return (
    <>
      {/* --------------------------- Sidebar (lg+) ---------------------- */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-800 bg-gray-900 lg:flex">
        <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white">
            <ChefHat className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-white">
              {loading ? "Φόρτωση…" : (shopName ?? "Κατάστημα")}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-400">
              Buka Business
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-bold transition-colors duration-200",
                  active
                    ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-gray-800 p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            Το site πελατών
          </Link>

          <div className="flex items-center gap-3 rounded-xl px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 text-xs font-black text-white">
              {initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-300">
              {displayName}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Αποσύνδεση"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ------------------------ Header (μικρές οθόνες) ---------------- */}
      <header className="flex items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-white">
            <ChefHat className="h-5 w-5" />
          </span>
          <p className="truncate text-sm font-black text-white">
            {loading ? "Φόρτωση…" : (shopName ?? "Κατάστημα")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Αποσύνδεση"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-700 text-gray-400 transition-colors hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      {/* ----------------------- Tab bar (μικρές οθόνες) ---------------- */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-800 bg-gray-900 lg:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-bold transition-colors",
                  active ? "text-orange-400" : "text-gray-500 hover:text-gray-300",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/* ==========================================================================
 *  ΚΑΡΤΑ ΦΡΑΓΗΣ (μη συνδεδεμένος / λάθος ρόλος)
 * ========================================================================== */

function GateCard({
  icon,
  iconClass,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-xl shadow-gray-900/5">
        <span
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-3xl",
            iconClass,
          )}
        >
          {icon}
        </span>

        <h1 className="mt-5 text-2xl font-black tracking-tight text-gray-900">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{description}</p>

        <div className="mt-6 space-y-3">{action}</div>
      </div>
    </div>
  );
}
