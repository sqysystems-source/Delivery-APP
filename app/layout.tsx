/* ==========================================================================
 *  Buka Delivery — app/layout.tsx   (ROOT LAYOUT, ΜΕΤΑ ΤΑ ROUTE GROUPS)
 *
 *  Το root layout κρατά ΜΟΝΟ ό,τι είναι κοινό σε ΟΛΗ την εφαρμογή:
 *    • <html> / <body>, γραμματοσειρές, metadata
 *    • <AuthProvider> — και το κατάστημα και το admin χρειάζονται τον χρήστη
 *
 *  Ό,τι αφορά μόνο τον πελάτη (Navbar, καλάθι) μετακόμισε στο
 *  app/(storefront)/layout.tsx. Ό,τι αφορά μόνο τον καταστηματάρχη πήγε
 *  στο app/(admin)/layout.tsx.
 *
 *  ΓΙΑΤΙ ΕΜΕΙΝΕ ΕΔΩ ΤΟ AuthProvider:
 *  Αν μπει ξεχωριστά σε κάθε group, τότε ένας χρήστης που πηγαίνει από το
 *  /admin στο / ξαναπερνά από πλήρη αρχικοποίηση του Firebase Auth —
 *  αναβοσβήνει το UI και ξαναδιαβάζεται το προφίλ. Ένας provider, μία φορά.
 * ========================================================================== */

import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

/**
 * ΠΡΟΣΟΧΗ: το Geist ΔΕΝ διαθέτει ελληνικό subset — τα ελληνικά θα έπεφταν
 * σε fallback γραμματοσειρά. Το Inter καλύπτει πλήρως greek + greek-ext.
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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
