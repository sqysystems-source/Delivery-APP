/* ==========================================================================
 *  Buka Delivery — lib/shop/postal-code.ts   (milestone 4)
 *
 *  Ελληνικοί ταχυδρομικοί κώδικες (ΤΚ): 5 ψηφία.
 *
 *  Κανονικοποίηση:
 *    • «546 22», « 54622 », «546 22» (μη διακοπτόμενο κενό) → «54622»
 *    • ψηφία πλήρους πλάτους (π.χ. από κινητό με ασιατικό πληκτρολόγιο) → ASCII
 *    • ΠΑΝΤΑ ως κείμενο: τα αρχικά μηδενικά μένουν («01234» δεν γίνεται 1234)
 *  Απορρίπτονται: γράμματα, παύλες, τελείες, λιγότερα/περισσότερα ψηφία.
 *  Κανένας ΤΚ δεν «μαντεύεται» από οδό, πόλη ή ετικέτα διεύθυνσης.
 *
 *  Καθαρό module χωρίς κανένα import (το χρησιμοποιούν validation, ζώνες,
 *  φόρμες) — έτσι δεν δημιουργεί κύκλους εξαρτήσεων.
 * ========================================================================== */

export const POSTAL_CODE_INPUT_MAX = 12;

const WHITESPACE = /[\s   ]+/g;
const FIVE_DIGITS = /^[0-9]{5}$/;

/** Κανονική μορφή «NNNNN», ή null αν δεν είναι έγκυρος ΤΚ */
export function normalizePostalCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > POSTAL_CODE_INPUT_MAX * 2) return null;
  const compact = raw.normalize("NFKC").replace(WHITESPACE, "");
  return FIVE_DIGITS.test(compact) ? compact : null;
}

export function isNormalizedPostalCode(value: unknown): value is string {
  return typeof value === "string" && FIVE_DIGITS.test(value);
}

/** «54622» → «546 22» (μόνο για εμφάνιση) */
export function formatPostalCode(code: string): string {
  return isNormalizedPostalCode(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type PostalCodeListParse = {
  /** Έγκυροι, κανονικοποιημένοι, με τη σειρά που γράφτηκαν (χωρίς διπλότυπα) */
  codes: string[];
  /** Κείμενα που δεν είναι έγκυροι ΤΚ (όπως γράφτηκαν) */
  invalid: string[];
  /** ΤΚ που γράφτηκαν πάνω από μία φορά */
  duplicates: string[];
};

/**
 * Λίστα ΤΚ από ελεύθερο κείμενο (φόρμα καταστηματάρχη). Διαχωριστικά: κόμμα,
 * ερωτηματικό, αλλαγή γραμμής. ΟΧΙ το κενό — το «546 22» είναι ΕΝΑΣ ΤΚ.
 */
export function parsePostalCodeList(text: string): PostalCodeListParse {
  const codes: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const token of text.split(/[,;\n\r]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const code = normalizePostalCode(trimmed);
    if (!code) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(code)) {
      if (!duplicates.includes(code)) duplicates.push(code);
      continue;
    }
    seen.add(code);
    codes.push(code);
  }
  return { codes, invalid, duplicates };
}
