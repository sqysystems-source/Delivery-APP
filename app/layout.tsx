/* ==========================================================================
 *  Buka Delivery — app/layout.tsx   (ΕΝΗΜΕΡΩΜΕΝΟ με auth)
 *
 *  Root layout (Server Component). Εδώ μπαίνουν ΜΙΑ φορά:
 *
 *    <AuthProvider>      → κατάσταση χρήστη + προφίλ από Firestore
 *      <CartProvider>    → κατάσταση καλαθιού
 *        <Navbar />      → header με διεύθυνση, καλάθι και UserMenu
 *        {children}      → το εκάστοτε route
 *        <CartDrawer />  → floating μπάρα + bottom sheet
 *        <AuthModal />   → σύνδεση / εγγραφή / επαναφορά κωδικού
 *
 *  Η σειρά έχει σημασία: το AuthProvider είναι ΕΞΩ από το CartProvider,
 *  ώστε αργότερα το καλάθι να μπορεί να διαβάσει τον χρήστη (π.χ. για να
 *  προσυμπληρώνει τη διεύθυνση από το προφίλ). Το αντίστροφο δεν ισχύει.
 * ========================================================================== */

import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import Navbar from "@/components/Navbar";
import CartDrawer from "@/components/CartDrawer";
import AuthModal from "@/components/AuthModal";
import "./globals.css";

/**
 * ΠΡΟΣΟΧΗ: το Geist ΔΕΝ διαθέτει ελληνικό subset — τα ελληνικά θα έπεφταν
 * σε fallback γραμματοσειρά. Το Inter καλύπτει πλήρως greek + greek-ext και
 * κρατά το ίδιο μοντέρνο, premium ύφος.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["greek", "latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Buka Delivery — Το αγαπημένο σου φαγητό, στην πόρτα σου",
    template: "%s | Buka Delivery",
  },
  description:
    "Παράγγειλε online από τα καλύτερα τοπικά μαγαζιά της πόλης σου. Σουβλάκι, πίτσα, burger, καφές και γλυκά με γρήγορη παράδοση.",
  keywords: [
    "delivery",
    "φαγητό",
    "online παραγγελία",
    "σουβλάκι",
    "πίτσα",
    "burger",
    "Buka",
  ],
  openGraph: {
    title: "Buka Delivery",
    description:
      "Το τοπικό delivery της επαρχίας. Ζεστό φαγητό, δίκαιες τιμές, γρήγορη παράδοση.",
    locale: "el_GR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="el"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-white font-sans text-gray-900">
        <AuthProvider>
          <CartProvider>
            <Navbar />

            {/* Κάθε route μπαίνει εδώ */}
            <div className="flex-1">{children}</div>

            {/* Global overlays — μία φορά για όλη την εφαρμογή */}
            <CartDrawer />
            <AuthModal />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
