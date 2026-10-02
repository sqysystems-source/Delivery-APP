/* ==========================================================================
 *  Buka Delivery — app/(storefront)/orders/page.tsx   (milestone 2)
 *
 *  «Οι παραγγελίες μου». Τα δεδομένα φορτώνονται στον browser με τα
 *  δικαιώματα του συνδεδεμένου χρήστη (components/orders/MyOrdersClient.tsx).
 * ========================================================================== */

import type { Metadata } from "next";
import MyOrdersClient from "@/components/orders/MyOrdersClient";

export const metadata: Metadata = {
  title: "Οι παραγγελίες μου",
  robots: { index: false, follow: false },
};

export default function MyOrdersPage() {
  return <MyOrdersClient />;
}
