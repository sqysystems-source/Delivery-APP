/* ==========================================================================
 *  Buka Delivery — lib/scroll-lock.ts   (milestone 3)
 *
 *  Κλείδωμα scroll της σελίδας με μετρητή. Χρειάζεται επειδή πλέον ανοίγουν
 *  διάλογοι ΠΑΝΩ από άλλους (π.χ. «Επεξεργασία επιλογών» μέσα από το καλάθι):
 *  όταν κλείνει ο πάνω διάλογος, η σελίδα πρέπει να μείνει κλειδωμένη όσο το
 *  καλάθι είναι ακόμη ανοιχτό.
 * ========================================================================== */

let locks = 0;
let previousOverflow = "";

/** Κλειδώνει το scroll· επιστρέφει συνάρτηση απελευθέρωσης (ασφαλής σε διπλή κλήση) */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (locks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = previousOverflow;
  };
}
