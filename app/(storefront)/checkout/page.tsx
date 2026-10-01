/* ==========================================================================
 *  Buka Delivery — app/(storefront)/checkout/page.tsx
 *
 *  Server Component: ορίζει μόνο τα metadata (υποστηρίζονται μόνο σε Server
 *  Components) και αποδίδει το client κομμάτι. Ζει μέσα στο (storefront),
 *  οπότε κληρονομεί Navbar, CartProvider, CartDrawer και AuthModal.
 *
 *  Άμεση επίσκεψη / ανανέωση: δεν γίνεται redirect. Η σελίδα περιμένει να
 *  διαβαστεί το αποθηκευμένο καλάθι και μετά δείχνει είτε τη φόρμα είτε
 *  «άδειο καλάθι».
 * ========================================================================== */

import type { Metadata } from "next";
import CheckoutClient from "@/components/checkout/CheckoutClient";

export const metadata: Metadata = {
  title: "Ολοκλήρωση παραγγελίας",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
