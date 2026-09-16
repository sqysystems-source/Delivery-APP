"use client";

/* ==========================================================================
 *  Buka Delivery — app/seed/page.tsx           ⚠️ ΠΡΟΣΩΡΙΝΟ ΑΡΧΕΙΟ ⚠️
 *
 *  Πίνακας ελέγχου για το seeding, με ένα κουμπί.
 *  Επισκέψου: https://<το-site-σου>.vercel.app/seed
 *
 *  Ο κωδικός που πληκτρολογείς πάει ως header στο /api/seed και ελέγχεται
 *  στον server. ΔΕΝ αποθηκεύεται πουθενά και δεν μπαίνει στο bundle.
 *
 *  ΜΕΤΑ ΤΟ SEEDING: σβήσε αυτό το αρχείο και το app/api/seed/route.ts.
 * ========================================================================== */

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Database,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";

/* --------------------------------------------------------------------------
 *  Τύποι απαντήσεων του API
 * -------------------------------------------------------------------------- */

type SeedResponse = {
  ok: boolean;
  error?: string;
  shopCount?: number;
  categoryCount?: number;
  itemCount?: number;
  verifiedShops?: number;
  durationMs?: number;
  log?: string[];
};

type StatusResponse = {
  ok: boolean;
  error?: string;
  shopCount?: number;
  orderCount?: number;
  shops?: Array<{ id: string; name: string; categories: number; items: number }>;
};

type Phase = "idle" | "seeding" | "checking" | "done" | "error";

export default function SeedPage() {
  const [secret, setSecret] = useState("");
  const [wipe, setWipe] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SeedResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const busy = phase === "seeding" || phase === "checking";

  /* ----------------------------- Εκτέλεση seed ------------------------- */
  const runSeed = async () => {
    if (!secret.trim()) {
      setErrorMessage("Συμπλήρωσε πρώτα το SEED_SECRET.");
      setPhase("error");
      return;
    }

    if (
      wipe &&
      !window.confirm(
        "Η επιλογή «καθαρό ανέβασμα» θα ΔΙΑΓΡΑΨΕΙ όλες τις κατηγορίες και τα " +
          "προϊόντα των καταστημάτων πριν τα ξαναγράψει.\n\nΣυνέχεια;",
      )
    ) {
      return;
    }

    setPhase("seeding");
    setErrorMessage(null);
    setResult(null);

    try {
      const response = await fetch("/api/seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-seed-secret": secret.trim(),
        },
        body: JSON.stringify({ wipe }),
      });

      const data = (await response.json()) as SeedResponse;
      setResult(data);

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? `Σφάλμα ${response.status}`);
        setPhase("error");
        return;
      }

      setPhase("done");
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error ? caught.message : "Αποτυχία επικοινωνίας με τον server.",
      );
      setPhase("error");
    }
  };

  /* --------------------------- Έλεγχος κατάστασης ---------------------- */
  const checkStatus = async () => {
    if (!secret.trim()) {
      setErrorMessage("Συμπλήρωσε πρώτα το SEED_SECRET.");
      setPhase("error");
      return;
    }

    setPhase("checking");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/seed", {
        headers: { "x-seed-secret": secret.trim() },
      });

      const data = (await response.json()) as StatusResponse;
      setStatus(data);

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? `Σφάλμα ${response.status}`);
        setPhase("error");
        return;
      }

      setPhase("idle");
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error ? caught.message : "Αποτυχία επικοινωνίας με τον server.",
      );
      setPhase("error");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl">
        {/* ----------------------------- Header ---------------------------- */}
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-orange-600"
        >
          <ChevronLeft className="h-4 w-4" />
          Πίσω στο Buka
        </Link>

        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/30">
            <Database className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-gray-900">
              Seeding βάσης
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Ανεβάζει τα καταστήματα και τα μενού στο Firestore.
            </p>
          </div>
        </div>

        {/* -------------------------- Προειδοποίηση ------------------------ */}
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm leading-relaxed text-amber-900">
            <p className="font-bold">Προσωρινή σελίδα — σβήσ&apos; την μετά.</p>
            <p className="mt-1">
              Όταν τελειώσεις, διέγραψε τα αρχεία{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                app/seed/page.tsx
              </code>{" "}
              και{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                app/api/seed/route.ts
              </code>
              , καθώς και τη μεταβλητή{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                SEED_SECRET
              </code>{" "}
              από τη Vercel.
            </p>
          </div>
        </div>

        {/* ------------------------------ Φόρμα ---------------------------- */}
        <div className="mt-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-xl shadow-gray-900/5">
          <label
            htmlFor="seed-secret"
            className="flex items-center gap-2 text-sm font-bold text-gray-900"
          >
            <KeyRound className="h-4 w-4 text-orange-500" />
            SEED_SECRET
          </label>
          <input
            id="seed-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Ο κωδικός που όρισες στη Vercel"
            autoComplete="off"
            className="mt-2 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-orange-400 focus:bg-white"
          />

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:border-orange-200 hover:bg-orange-50/40">
            <input
              type="checkbox"
              checked={wipe}
              onChange={(event) => setWipe(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
            />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-bold text-gray-900">
                <Trash2 className="h-3.5 w-3.5 text-gray-500" />
                Καθαρό ανέβασμα
              </span>
              <span className="mt-0.5 block leading-relaxed text-gray-600">
                Διαγράφει πρώτα όλες τις κατηγορίες και τα προϊόντα κάθε
                καταστήματος. Χρήσιμο αν έχεις σβήσει προϊόντα από το{" "}
                <code className="font-mono text-xs">mock-data.ts</code> και θέλεις
                να φύγουν και από τη βάση. Χωρίς αυτό, τα υπάρχοντα απλώς
                ενημερώνονται.
              </span>
            </span>
          </label>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={runSeed}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
            >
              {phase === "seeding" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ανεβαίνουν τα δεδομένα…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Εκτέλεση seeding
                </>
              )}
            </button>

            <button
              type="button"
              onClick={checkStatus}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-6 py-4 text-sm font-bold text-gray-700 transition-all duration-300 hover:border-orange-300 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "checking" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Έλεγχος βάσης
            </button>
          </div>
        </div>

        {/* ------------------------------ Σφάλμα --------------------------- */}
        {errorMessage && (
          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="min-w-0 text-sm text-red-800">
              <p className="font-bold">Κάτι πήγε στραβά</p>
              <p className="mt-1 break-words leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* ---------------------------- Αποτέλεσμα ------------------------- */}
        {phase === "done" && result?.ok && (
          <div className="mt-6 overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-xl shadow-gray-900/5">
            <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-6 py-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
              <div>
                <p className="font-black text-emerald-900">Το seeding ολοκληρώθηκε</p>
                <p className="text-xs text-emerald-700">
                  σε {((result.durationMs ?? 0) / 1000).toFixed(1)} δευτερόλεπτα
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
              {[
                { label: "Καταστήματα", value: result.shopCount ?? 0 },
                { label: "Κατηγορίες", value: result.categoryCount ?? 0 },
                { label: "Προϊόντα", value: result.itemCount ?? 0 },
              ].map((stat) => (
                <div key={stat.label} className="px-4 py-5 text-center">
                  <p className="text-3xl font-black text-gray-900">{stat.value}</p>
                  <p className="mt-1 text-xs text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {result.log && result.log.length > 0 && (
              <ul className="space-y-1.5 px-6 py-5">
                {result.log.map((line, index) => (
                  <li key={index} className="text-sm leading-relaxed text-gray-700">
                    {line}
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-gray-100 bg-gray-50 px-6 py-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-6 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-500"
              >
                Δες την αρχική με τα ζωντανά δεδομένα
              </Link>
            </div>
          </div>
        )}

        {/* ------------------------ Κατάσταση βάσης ------------------------ */}
        {status?.ok && (
          <div className="mt-6 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5">
            <div className="border-b border-gray-100 px-6 py-4">
              <p className="font-black text-gray-900">Τρέχουσα κατάσταση βάσης</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {status.shopCount ?? 0} καταστήματα · {status.orderCount ?? 0}{" "}
                παραγγελίες
              </p>
            </div>

            {status.shops && status.shops.length > 0 ? (
              <ul className="divide-y divide-gray-50">
                {status.shops.map((shop) => (
                  <li
                    key={shop.id}
                    className="flex items-center justify-between gap-3 px-6 py-3"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
                      {shop.name}
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {shop.categories} κατηγορίες · {shop.items} προϊόντα
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-gray-500">
                Η βάση είναι ακόμη άδεια. Πάτα «Εκτέλεση seeding».
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
