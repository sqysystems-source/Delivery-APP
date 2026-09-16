/* ==========================================================================
 *  Buka Delivery — app/(storefront)/layout.tsx
 *
 *  Κέλυφος για ΟΛΕΣ τις σελίδες του πελάτη: αρχική, σελίδα καταστήματος,
 *  και ό,τι άλλο προστεθεί μέσα στο (storefront).
 *
 *  Οι παρενθέσεις στο όνομα του φακέλου κάνουν το group «αόρατο» στο URL:
 *    app/(storefront)/page.tsx          →  /
 *    app/(storefront)/shop/[id]/page.tsx →  /shop/pizza-roma
 *
 *  Εδώ ζουν το CartProvider και τα overlays του πελάτη. Το admin panel δεν
 *  τα φορτώνει καν — ούτε το καλάθι, ούτε ο επιλογέας διεύθυνσης.
 * ========================================================================== */

import { CartProvider } from "@/context/CartContext";
import Navbar from "@/components/Navbar";
import CartDrawer from "@/components/CartDrawer";
import AuthModal from "@/components/AuthModal";

export default function StorefrontLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <CartProvider>
      <Navbar />

      {/* Η εκάστοτε σελίδα του καταστήματος */}
      <div className="flex-1">{children}</div>

      {/* Global overlays του πελάτη — μία φορά για όλο το storefront */}
      <CartDrawer />
      <AuthModal />
    </CartProvider>
  );
}
