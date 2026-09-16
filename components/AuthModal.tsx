"use client";

/* ==========================================================================
 *  Buka Delivery — components/AuthModal.tsx
 *
 *  Σύνδεση / Εγγραφή / Επαναφορά κωδικού σε ένα modal.
 *  Μπαίνει ΜΙΑ φορά στο app/layout.tsx και ανοίγει από το AuthContext.
 *
 *  ── ΓΙΑΤΙ MODAL ΚΑΙ ΟΧΙ ΞΕΧΩΡΙΣΤΕΣ ΣΕΛΙΔΕΣ ──────────────────────────────
 *  Σε delivery app η σύνδεση σχεδόν πάντα ζητείται στη μέση μιας ενέργειας:
 *  ο πελάτης έχει γεμάτο καλάθι και βρίσκεται στη σελίδα του μαγαζιού. Μια
 *  πλοήγηση σε /login τον βγάζει από τη ροή και τον κάνει να αναρωτηθεί αν
 *  κράτησε το καλάθι του. Το modal κρατά τα πάντα στη θέση τους: συνδέεται
 *  και συνεχίζει από εκεί που ήταν.
 *
 *  Αν αργότερα θες και μόνιμα URLs (π.χ. για link σε email), φτιάχνεις
 *  app/login/page.tsx που απλώς καλεί openLogin() και κάνει router.back().
 * ========================================================================== */

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
  X,
} from "lucide-react";
import { useAuth, type AuthMode } from "@/context/AuthContext";
import {
  authErrorMessage,
  loginWithEmail,
  registerWithEmail,
  sendPasswordReset,
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
} from "@/lib/auth";
import { cn } from "@/lib/format";

type View = AuthMode | "reset";

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  phone?: string;
};

export default function AuthModal() {
  const { authMode, closeAuth, switchMode } = useAuth();

  const [view, setView] = useState<View>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const isOpen = authMode !== null;

  /* Συγχρονισμός με το context όταν ανοίγει ή αλλάζει το tab */
  useEffect(() => {
    if (authMode) {
      setView(authMode);
      setFieldErrors({});
      setFormError(null);
      setResetSent(false);
    }
  }, [authMode]);

  /* Κλείδωμα scroll + Escape */
  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = "hidden";

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAuth();
    };
    document.addEventListener("keydown", handleKey);

    const focusTimer = window.setTimeout(() => firstFieldRef.current?.focus(), 80);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen, closeAuth]);

  if (!isOpen) return null;

  /* ------------------------------ Υποβολή ------------------------------ */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    /* ---------------------- Επαναφορά κωδικού ---------------------- */
    if (view === "reset") {
      const emailError = validateEmail(email);
      if (emailError) {
        setFieldErrors({ email: emailError });
        return;
      }

      setSubmitting(true);
      try {
        await sendPasswordReset(email);
        setResetSent(true);
      } catch (caught) {
        setFormError(authErrorMessage(caught));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    /* -------------------------- Επικύρωση -------------------------- */
    const errors: FieldErrors = {};

    if (view === "register") {
      const nameError = validateFullName(fullName);
      if (nameError) errors.fullName = nameError;

      const phoneError = validatePhone(phone);
      if (phoneError) errors.phone = phoneError;
    }

    const emailError = validateEmail(email);
    if (emailError) errors.email = emailError;

    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    /* --------------------------- Αποστολή --------------------------- */
    setSubmitting(true);
    try {
      if (view === "register") {
        await registerWithEmail({ fullName, email, password, phone });
      } else {
        await loginWithEmail(email, password);
      }
      /* Το AuthContext κλείνει μόνο του το modal μόλις αλλάξει ο χρήστης */
      setPassword("");
    } catch (caught) {
      setFormError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    cn(
      "w-full rounded-2xl border bg-gray-50 py-3 pl-11 pr-4 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:bg-white",
      hasError
        ? "border-red-300 focus:border-red-400"
        : "border-gray-200 focus:border-orange-400",
    );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={view === "register" ? "Εγγραφή" : "Σύνδεση"}
    >
      <div
        className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
        onClick={closeAuth}
      />

      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
        {/* ------------------------------ Header ------------------------- */}
        <div className="relative shrink-0 bg-gradient-to-br from-orange-500 to-red-500 px-6 pb-8 pt-7 text-white">
          <button
            type="button"
            onClick={closeAuth}
            aria-label="Κλείσιμο"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black">
            B
          </span>

          <h2 className="mt-4 text-2xl font-black tracking-tight">
            {view === "register"
              ? "Δημιούργησε λογαριασμό"
              : view === "reset"
                ? "Επαναφορά κωδικού"
                : "Καλώς ήρθες πίσω"}
          </h2>
          <p className="mt-1 text-sm text-orange-50">
            {view === "register"
              ? "Παραγγελίες σε ένα κλικ και ιστορικό πάντα διαθέσιμο."
              : view === "reset"
                ? "Θα σου στείλουμε σύνδεσμο για νέο κωδικό."
                : "Συνδέσου για να συνεχίσεις την παραγγελία σου."}
          </p>
        </div>

        {/* ------------------------------- Tabs -------------------------- */}
        {view !== "reset" && (
          <div className="shrink-0 px-6 pt-5">
            <div className="flex gap-1 rounded-full bg-gray-100 p-1">
              {(
                [
                  { id: "login", label: "Σύνδεση" },
                  { id: "register", label: "Εγγραφή" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchMode(tab.id)}
                  className={cn(
                    "flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition-all duration-300",
                    view === tab.id
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-900",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------ Φόρμα -------------------------- */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">
          {/* Επιτυχία επαναφοράς */}
          {view === "reset" && resetSent ? (
            <div className="py-6 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </span>
              <h3 className="mt-5 text-lg font-black text-gray-900">
                Έλεγξε το email σου
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                Στείλαμε σύνδεσμο επαναφοράς στο{" "}
                <span className="font-semibold text-gray-900">{email}</span>. Αν δεν
                τον βρίσκεις, κοίτα και στα ανεπιθύμητα.
              </p>
              <button
                type="button"
                onClick={() => {
                  setView("login");
                  setResetSent(false);
                }}
                className="mt-6 w-full rounded-full bg-gray-900 px-6 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:scale-[1.02] hover:bg-orange-500"
              >
                Επιστροφή στη σύνδεση
              </button>
            </div>
          ) : (
            <>
              {/* Γενικό σφάλμα */}
              {formError && (
                <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <p className="text-sm leading-relaxed text-red-800">{formError}</p>
                </div>
              )}

              <div className="space-y-4">
                {/* Ονοματεπώνυμο */}
                {view === "register" && (
                  <div>
                    <label
                      htmlFor="auth-name"
                      className="mb-1.5 block text-sm font-bold text-gray-900"
                    >
                      Ονοματεπώνυμο
                    </label>
                    <div className="relative">
                      <UserIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        id="auth-name"
                        ref={view === "register" ? firstFieldRef : undefined}
                        type="text"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Κώστας Παπαδόπουλος"
                        autoComplete="name"
                        className={inputClass(Boolean(fieldErrors.fullName))}
                      />
                    </div>
                    {fieldErrors.fullName && (
                      <p className="mt-1.5 text-xs font-semibold text-red-600">
                        {fieldErrors.fullName}
                      </p>
                    )}
                  </div>
                )}

                {/* Email */}
                <div>
                  <label
                    htmlFor="auth-email"
                    className="mb-1.5 block text-sm font-bold text-gray-900"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      id="auth-email"
                      ref={view !== "register" ? firstFieldRef : undefined}
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="onoma@email.com"
                      autoComplete="email"
                      inputMode="email"
                      className={inputClass(Boolean(fieldErrors.email))}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="mt-1.5 text-xs font-semibold text-red-600">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                {/* Τηλέφωνο */}
                {view === "register" && (
                  <div>
                    <label
                      htmlFor="auth-phone"
                      className="mb-1.5 flex items-center gap-2 text-sm font-bold text-gray-900"
                    >
                      Τηλέφωνο
                      <span className="text-xs font-medium text-gray-400">
                        προαιρετικό
                      </span>
                    </label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        id="auth-phone"
                        type="tel"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        placeholder="69XXXXXXXX"
                        autoComplete="tel"
                        inputMode="tel"
                        className={inputClass(Boolean(fieldErrors.phone))}
                      />
                    </div>
                    {fieldErrors.phone ? (
                      <p className="mt-1.5 text-xs font-semibold text-red-600">
                        {fieldErrors.phone}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-gray-500">
                        Το ζητάει ο διανομέας αν δυσκολευτεί να σε βρει.
                      </p>
                    )}
                  </div>
                )}

                {/* Κωδικός */}
                {view !== "reset" && (
                  <div>
                    <label
                      htmlFor="auth-password"
                      className="mb-1.5 block text-sm font-bold text-gray-900"
                    >
                      Κωδικός
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        id="auth-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={
                          view === "register" ? "Τουλάχιστον 6 χαρακτήρες" : "••••••••"
                        }
                        autoComplete={
                          view === "register" ? "new-password" : "current-password"
                        }
                        className={cn(
                          inputClass(Boolean(fieldErrors.password)),
                          "pr-12",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={
                          showPassword ? "Απόκρυψη κωδικού" : "Εμφάνιση κωδικού"
                        }
                        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {fieldErrors.password && (
                      <p className="mt-1.5 text-xs font-semibold text-red-600">
                        {fieldErrors.password}
                      </p>
                    )}
                  </div>
                )}

                {/* Ξέχασα τον κωδικό */}
                {view === "login" && (
                  <button
                    type="button"
                    onClick={() => {
                      setView("reset");
                      setFieldErrors({});
                      setFormError(null);
                    }}
                    className="text-xs font-bold text-orange-600 transition-colors hover:text-orange-700"
                  >
                    Ξέχασες τον κωδικό σου;
                  </button>
                )}
              </div>

              {/* Κουμπί υποβολής */}
              <button
                type="submit"
                disabled={submitting}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {view === "register"
                      ? "Δημιουργία…"
                      : view === "reset"
                        ? "Αποστολή…"
                        : "Σύνδεση…"}
                  </>
                ) : view === "register" ? (
                  "Δημιουργία λογαριασμού"
                ) : view === "reset" ? (
                  "Αποστολή συνδέσμου"
                ) : (
                  "Σύνδεση"
                )}
              </button>

              {view === "reset" && (
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="mt-3 w-full rounded-full px-6 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
                >
                  Πίσω στη σύνδεση
                </button>
              )}

              {/* Υποσημείωση */}
              {view === "register" && (
                <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-gray-500">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  Με την εγγραφή αποδέχεσαι τους όρους χρήσης και την πολιτική
                  απορρήτου. Δεν μοιραζόμαστε τα στοιχεία σου με τρίτους.
                </p>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  );
}
