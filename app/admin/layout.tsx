"use client";

/* ==========================================================================
 *  Buka Delivery — app/admin/layout.tsx
 *
 *  Φύλακας πρόσβασης για όλα τα /admin routes.
 *
 *  ── ΔΙΑΒΑΣΕ ΑΥΤΟ ΠΡΙΝ ΒΑΣΙΣΤΕΙΣ ΠΑΝΩ ΤΟΥ ───────────────────────────────
 *  Αυτός ο έλεγχος είναι UX, ΟΧΙ ασφάλεια. Τρέχει στον browser, άρα ο
 *  καθένας μπορεί να τον παρακάμψει με τα DevTools και να δει το κέλυφος
 *  της σελίδας. Δεν πειράζει: χωρίς δικαίωμα στα Security Rules, η σελίδα
 *  δεν θα φέρει ούτε μία παραγγελία. Η ΠΡΑΓΜΑΤΙΚΗ προστασία είναι στο
 *  firestore.rules — εκεί ελέγχεται το ownerUid, και αυτό δεν παρακάμπτεται.
 *
 *  ── ΓΙΑΤΙ ΟΧΙ MIDDLEWARE ───────────────────────────────────────────────
 *  Το Next.js middleware τρέχει στον edge, πριν φορτώσει η React. Το
 *  Firebase Auth όμως κρατά το session στο IndexedDB του browser, ΟΧΙ σε
 *  cookie — οπότε το middleware δεν έχει τρόπο να δει ποιος είναι
 *  συνδεδεμένος. Θα χρειαζόταν session cookie μέσω Admin SDK, που είναι
 *  ξεχωριστό έργο και δεν προσθέτει ασφάλεια εδώ: τα δεδομένα προστατεύονται
 *  ήδη στη βάση.
 * ========================================================================== */

import Link from "next/link";
import { Loader2, LockKeyhole, LogIn, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, isAuthenticated, profile, profileLoading, displayName, openLogin } =
    useAuth();

  /* ------------------------------ Φόρτωση ------------------------------- */
  if (loading || (isAuthenticated && profileLoading)) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          <p className="text-sm font-semibold text-gray-500">Έλεγχος πρόσβασης…</p>
        </div>
      </div>
    );
  }

  /* --------------------------- Μη συνδεδεμένος -------------------------- */
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-900/5">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100">
            <LockKeyhole className="h-8 w-8 text-gray-500" />
          </span>

          <h1 className="mt-5 text-2xl font-black tracking-tight text-gray-900">
            Περιοχή καταστήματος
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Συνδέσου με τον λογαριασμό του καταστήματός σου για να δεις τις
            παραγγελίες.
          </p>

          <button
            type="button"
            onClick={openLogin}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95"
          >
            <LogIn className="h-4 w-4" />
            Σύνδεση
          </button>

          <Link
            href="/"
            className="mt-3 block rounded-full px-6 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
          >
            Επιστροφή στο Buka
          </Link>
        </div>
      </div>
    );
  }

  /* ---------------------------- Λάθος ρόλος ----------------------------- */
  const role = profile?.role ?? "customer";
  const hasAccess = role === "owner" || role === "admin";

  if (!hasAccess) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl shadow-gray-900/5">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-100">
            <ShieldAlert className="h-8 w-8 text-amber-600" />
          </span>

          <h1 className="mt-5 text-2xl font-black tracking-tight text-gray-900">
            Δεν έχεις πρόσβαση
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Ο λογαριασμός <span className="font-bold">{displayName}</span> δεν έχει
            δικαιώματα καταστήματος. Αν διαχειρίζεσαι μαγαζί στο Buka,
            επικοινώνησε μαζί μας για ενεργοποίηση.
          </p>

          <Link
            href="/"
            className="mt-6 block rounded-full bg-gray-900 px-6 py-4 text-sm font-bold text-white transition-all duration-300 hover:scale-[1.02] hover:bg-orange-500"
          >
            Επιστροφή στο Buka
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
