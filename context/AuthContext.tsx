"use client";

/* ==========================================================================
 *  Buka Delivery — context/AuthContext.tsx
 *
 *  Global κατάσταση χρήστη. Ζει στο app/layout.tsx, πάνω από το CartProvider.
 *
 *  Τι κάνει:
 *   • Παρακολουθεί το Firebase Auth με onAuthStateChanged
 *   • Φορτώνει το προφίλ από το users/{uid} με onSnapshot — ζωντανά, οπότε
 *     μια αλλαγή στο προφίλ φαίνεται αμέσως σε όλη την εφαρμογή
 *   • Ελέγχει το άνοιγμα/κλείσιμο του AuthModal
 *
 *  ── ΣΗΜΑΝΤΙΚΗ ΔΙΑΚΡΙΣΗ ──────────────────────────────────────────────────
 *  Το `user` μπορεί να είναι ΑΝΩΝΥΜΟΣ χρήστης (από το checkout). Ανώνυμος
 *  ≠ συνδεδεμένος. Γι' αυτό υπάρχει το `isAuthenticated`, που είναι true
 *  μόνο για πραγματικό λογαριασμό. Το UI κοιτάζει ΠΑΝΤΑ αυτό.
 * ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { logout as signOutUser, mapUserProfile, type UserProfile } from "@/lib/auth";

export type AuthMode = "login" | "register";

type AuthContextValue = {
  /* Κατάσταση */
  user: User | null;
  profile: UserProfile | null;
  /** true μόνο για πραγματικό λογαριασμό (όχι anonymous) */
  isAuthenticated: boolean;
  isAnonymous: boolean;
  /** true μέχρι να απαντήσει το Firebase — απόφυγε flicker στο UI */
  loading: boolean;
  profileLoading: boolean;

  /* Modal */
  authMode: AuthMode | null;
  openLogin: () => void;
  openRegister: () => void;
  closeAuth: () => void;
  switchMode: (mode: AuthMode) => void;

  /* Ενέργειες */
  logout: () => Promise<void>;

  /** Βολικό όνομα για το UI: προφίλ → displayName → «Λογαριασμός» */
  displayName: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  /* ----------------------- Παρακολούθηση σύνδεσης ---------------------- */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  /* ------------------ Ζωντανή φόρτωση προφίλ από Firestore -------------- */
  useEffect(() => {
    /* Ανώνυμοι χρήστες δεν έχουν προφίλ — και τα rules θα απέρριπταν το read */
    if (!user || user.isAnonymous) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        setProfile(
          snapshot.exists()
            ? mapUserProfile(snapshot.id, snapshot.data() as Record<string, unknown>)
            : null,
        );
        setProfileLoading(false);
      },
      (error) => {
        console.error("[auth] Αποτυχία ανάγνωσης προφίλ:", error);
        setProfile(null);
        setProfileLoading(false);
      },
    );

    return unsubscribe;
  }, [user]);

  /* Μόλις συνδεθεί ο χρήστης, το modal δεν έχει λόγο να μένει ανοιχτό */
  useEffect(() => {
    if (user && !user.isAnonymous) setAuthMode(null);
  }, [user]);

  /* ----------------------------- Ενέργειες ----------------------------- */
  const openLogin = useCallback(() => setAuthMode("login"), []);
  const openRegister = useCallback(() => setAuthMode("register"), []);
  const closeAuth = useCallback(() => setAuthMode(null), []);
  const switchMode = useCallback((mode: AuthMode) => setAuthMode(mode), []);

  const handleLogout = useCallback(async () => {
    await signOutUser();
    setProfile(null);
  }, []);

  /* ------------------------------- Value ------------------------------- */
  const isAnonymous = user?.isAnonymous === true;
  const isAuthenticated = user !== null && !isAnonymous;

  const displayName =
    profile?.fullName?.trim() || user?.displayName?.trim() || "Λογαριασμός";

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isAuthenticated,
      isAnonymous,
      loading,
      profileLoading,
      authMode,
      openLogin,
      openRegister,
      closeAuth,
      switchMode,
      logout: handleLogout,
      displayName,
    }),
    [
      user,
      profile,
      isAuthenticated,
      isAnonymous,
      loading,
      profileLoading,
      authMode,
      openLogin,
      openRegister,
      closeAuth,
      switchMode,
      handleLogout,
      displayName,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error(
      "Το useAuth() πρέπει να χρησιμοποιείται μέσα σε <AuthProvider>. " +
        "Τύλιξε το {children} στο app/layout.tsx.",
    );
  }
  return context;
}
