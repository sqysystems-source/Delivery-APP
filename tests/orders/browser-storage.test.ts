// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  ATTEMPT_MAX_AGE_MS,
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  clearCheckoutAttempt,
  clearCheckoutAttemptsExcept,
  isAttemptExpired,
  parseCheckoutAttempts,
  readCheckoutAttempts,
  saveCheckoutAttempt,
} from "@/lib/checkout/checkout-attempt";
import {
  LAST_ORDER_STORAGE_KEY,
  parseLastOrder,
  readLastOrderFor,
  saveLastOrder,
} from "@/lib/orders/last-order";

const KEY_A = "11111111-2222-4333-8444-555555555555";
const KEY_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

afterEach(() => window.localStorage.clear());

describe("προσπάθεια checkout στο localStorage", () => {
  it("αποθηκεύει ΜΟΝΟ uid, κλειδί και ώρα", () => {
    saveCheckoutAttempt({ uid: "anon-1", key: KEY_A, startedAt: 1000, ...{ phone: "6912345678", fullName: "Κ" } } as never);
    const raw = window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) ?? "";
    expect(JSON.parse(raw)).toEqual({ v: 1, attempts: [{ uid: "anon-1", key: KEY_A, startedAt: 1000 }] });
    expect(raw).not.toContain("6912345678");
  });

  it("μία προσπάθεια ανά uid· οι προσπάθειες άλλων uid δεν πειράζονται", () => {
    saveCheckoutAttempt({ uid: "anon-1", key: KEY_A, startedAt: 1000 });
    saveCheckoutAttempt({ uid: "user-2", key: KEY_B, startedAt: 2000 });
    saveCheckoutAttempt({ uid: "anon-1", key: KEY_B, startedAt: 3000 });
    expect(readCheckoutAttempts()).toEqual([
      { uid: "anon-1", key: KEY_B, startedAt: 3000 },
      { uid: "user-2", key: KEY_B, startedAt: 2000 },
    ]);
  });

  it("clear σβήνει μόνο αν ταιριάζουν uid ΚΑΙ κλειδί", () => {
    saveCheckoutAttempt({ uid: "anon-1", key: KEY_A, startedAt: 1000 });
    clearCheckoutAttempt("anon-1", KEY_B);
    clearCheckoutAttempt("other", KEY_A);
    expect(readCheckoutAttempts()).toHaveLength(1);
    clearCheckoutAttempt("anon-1", KEY_A);
    expect(readCheckoutAttempts()).toHaveLength(0);
    expect(window.localStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("«Κατάλαβα» σβήνει μόνο τις προσπάθειες άλλων συνδέσεων", () => {
    saveCheckoutAttempt({ uid: "anon-1", key: KEY_A, startedAt: 1000 });
    saveCheckoutAttempt({ uid: "user-2", key: KEY_B, startedAt: 2000 });
    clearCheckoutAttemptsExcept("user-2");
    expect(readCheckoutAttempts().map((entry) => entry.uid)).toEqual(["user-2"]);
  });

  it("κακόμορφα/ξένα δεδομένα αγνοούνται", () => {
    expect(parseCheckoutAttempts("{")).toEqual([]);
    expect(parseCheckoutAttempts('{"v":2,"attempts":[]}')).toEqual([]);
    expect(
      parseCheckoutAttempts(
        JSON.stringify({
          v: 1,
          attempts: [
            { uid: "u", key: "short", startedAt: 1 },
            { uid: "", key: KEY_A, startedAt: 1 },
            { uid: "u", key: KEY_A, startedAt: "x" },
            { uid: "u", key: "../../etc/passwd-0000000", startedAt: 1 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("λήξη: κάτω από τις 7 ημέρες του server", () => {
    expect(ATTEMPT_MAX_AGE_MS).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    const attempt = { uid: "u", key: KEY_A, startedAt: 0 };
    expect(isAttemptExpired(attempt, ATTEMPT_MAX_AGE_MS)).toBe(false);
    expect(isAttemptExpired(attempt, ATTEMPT_MAX_AGE_MS + 1)).toBe(true);
  });
});

describe("τελευταία παραγγελία επισκέπτη", () => {
  it("δεσμεύεται στον uid — άλλος χρήστης δεν τη βλέπει", () => {
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 5 });
    expect(readLastOrderFor("anon-1")?.orderId).toBe("abc123xyz");
    expect(readLastOrderFor("anon-2")).toBeNull();
    expect(readLastOrderFor(null)).toBeNull();
  });

  it("αποθηκεύει μόνο αναφορά — κανένα προσωπικό στοιχείο", () => {
    saveLastOrder({ uid: "anon-1", orderId: "abc123xyz", savedAt: 5, ...{ address: "Ερμού 5" } } as never);
    expect(JSON.parse(window.localStorage.getItem(LAST_ORDER_STORAGE_KEY) ?? "")).toEqual({
      v: 1,
      uid: "anon-1",
      orderId: "abc123xyz",
      savedAt: 5,
    });
  });

  it("άκυρο id ή κακόμορφα δεδομένα → τίποτα", () => {
    saveLastOrder({ uid: "anon-1", orderId: "orders/../x", savedAt: 5 });
    expect(window.localStorage.getItem(LAST_ORDER_STORAGE_KEY)).toBeNull();
    expect(parseLastOrder('{"v":1,"uid":"a","orderId":"__x__","savedAt":1}')).toBeNull();
    expect(parseLastOrder("not json")).toBeNull();
  });
});
