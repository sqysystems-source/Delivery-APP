/* ==========================================================================
 *  Buka Delivery — app/(storefront)/orders/[orderId]/page.tsx   (milestone 2)
 *
 *  Server Component: μόνο metadata (noindex) και το id από το URL. Τα
 *  δεδομένα της παραγγελίας φορτώνονται στον browser με τα δικαιώματα του
 *  συνδεδεμένου Firebase χρήστη — ο server δεν τα αποδίδει ποτέ σε HTML,
 *  οπότε δεν υπάρχει cache/SSR διαρροή προσωπικών στοιχείων.
 * ========================================================================== */

import type { Metadata } from "next";
import OrderTrackingClient from "@/components/orders/OrderTrackingClient";

export const metadata: Metadata = {
  title: "Παρακολούθηση παραγγελίας",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  // Η επικύρωση μορφής γίνεται στον client (isValidDocumentId) πριν από κάθε ερώτημα
  return <OrderTrackingClient key={orderId} orderId={orderId} />;
}
