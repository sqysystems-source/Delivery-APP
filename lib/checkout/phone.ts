/* ==========================================================================
 *  Buka Delivery — lib/checkout/phone.ts
 *
 *  Κανονικοποίηση τηλεφώνου σε μορφή E.164 (π.χ. +306912345678).
 *
 *  Δεκτά:
 *    • Ελληνικά εθνικά: κινητά 69XXXXXXXX, σταθερά 2XXXXXXXXX
 *    • Με πρόθεμα χώρας: +30…, 0030…, 30… (για Ελλάδα ελέγχεται και το εθνικό μέρος)
 *    • Διεθνή: + και 8–15 ψηφία (π.χ. +44…, +49…)
 *
 *  ΣΗΜΑΝΤΙΚΟ: αυτό ελέγχει μόνο ότι ο αριθμός ΜΟΙΑΖΕΙ έγκυρος. Δεν αποδεικνύει
 *  ότι ανήκει στον πελάτη — δεν γίνεται επαλήθευση με SMS.
 * ========================================================================== */

const GREEK_NATIONAL = /^(?:2\d{9}|69\d{8})$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Επιστρέφει το τηλέφωνο σε E.164 ή `null` αν δεν είναι αποδεκτό */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > 32) return null;

  // Επιτρεπτά διαχωριστικά: κενά, παύλες, τελείες, παρενθέσεις, κάθετοι
  const compact = raw.trim().replace(/[\s\-.()/]/g, "");
  if (compact.length === 0) return null;

  let international: string | null = null;

  if (compact.startsWith("+")) {
    international = compact;
  } else if (compact.startsWith("00")) {
    international = `+${compact.slice(2)}`;
  } else if (/^30\d{10}$/.test(compact)) {
    international = `+${compact}`;
  } else if (GREEK_NATIONAL.test(compact)) {
    return `+30${compact}`;
  } else {
    return null;
  }

  if (!E164.test(international)) return null;

  // Για την Ελλάδα απαιτούμε έγκυρο εθνικό μέρος — όχι απλώς 8–15 ψηφία
  if (international.startsWith("+30")) {
    return GREEK_NATIONAL.test(international.slice(3)) ? international : null;
  }

  return international;
}

/** Φιλική εμφάνιση: +306912345678 → «691 234 5678» */
export function formatPhoneForDisplay(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone;

  if (normalized.startsWith("+30")) {
    const national = normalized.slice(3);
    return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  }
  return normalized;
}

/** href για σύνδεσμο κλήσης — `null` όταν το τηλέφωνο δεν είναι αξιόπιστο */
export function phoneHref(phone: string): string | null {
  const normalized = normalizePhone(phone);
  return normalized ? `tel:${normalized}` : null;
}
