/* ==========================================================================
 *  Ψεύτικο, in-memory CheckoutStore για τα tests του checkout-service.
 *
 *  Μοντελοποιεί ΣΕΙΡΙΟΠΟΙΗΣΙΜΕΣ συναλλαγές με οπτιμιστικό έλεγχο:
 *    • κάθε ανάγνωση κρατά την «έκδοση» του εγγράφου
 *    • στο commit, αν έστω ένα διαβασμένο έγγραφο άλλαξε → η συναλλαγή
 *      ξανατρέχει από την αρχή (όπως κάνει το Firestore σε σύγκρουση)
 *    • οι εγγραφές είναι `create`: αποτυγχάνουν αν το έγγραφο υπάρχει
 *  Κάθε ανάγνωση περιμένει ένα macrotask, ώστε ταυτόχρονα αιτήματα να
 *  διαπλέκονται πραγματικά μέσα στη διεργασία των tests.
 *
 *  ΠΡΟΣΟΧΗ: αυτό αποδεικνύει ότι η ΛΟΓΙΚΗ του service είναι σωστή ΑΝ η βάση
 *  δίνει σειριοποιήσιμες συναλλαγές. ΔΕΝ αποδεικνύει τη συμπεριφορά του
 *  πραγματικού Firestore — αυτό θέλει τον Firestore Emulator.
 * ========================================================================== */

import {
  CHECKOUT_REQUESTS_COLLECTION,
  parseIdempotencyRecord,
  type CheckoutStore,
  type CheckoutTransaction,
} from "@/lib/server/checkout-service";

export const SERVER_TIMESTAMP = Symbol("serverTimestamp");

type Doc = { data: Record<string, unknown>; version: number };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function assertSafeSegment(segment: string) {
  // Αν ποτέ φτάσει εδώ id με «/», το service δεν επικύρωσε σωστά
  if (!segment || segment.includes("/")) {
    throw new Error(`Μη ασφαλές τμήμα διαδρομής: ${JSON.stringify(segment)}`);
  }
}

export class FakeCheckoutDb {
  readonly docs = new Map<string, Doc>();
  nowMs = 1_750_000_000_000;
  transactionAttempts = 0;
  commits = 0;
  private sequence = 0;

  /* ------------------------------ Βοηθητικά ------------------------------ */

  setShop(shopId: string, data: Record<string, unknown>) {
    this.put(`shops/${shopId}`, data);
  }

  setItem(shopId: string, itemId: string, data: Record<string, unknown>) {
    this.put(`shops/${shopId}/menuItems/${itemId}`, data);
  }

  private put(path: string, data: Record<string, unknown>) {
    const previous = this.docs.get(path);
    this.docs.set(path, { data, version: (previous?.version ?? 0) + 1 });
  }

  private version(path: string): number {
    return this.docs.get(path)?.version ?? 0;
  }

  collection(prefix: string): Array<[string, Record<string, unknown>]> {
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(`${prefix}/`) && path.split("/").length === 2)
      .map(([path, doc]) => [path.split("/")[1], doc.data]);
  }

  get orders() {
    return this.collection("orders");
  }

  get records() {
    return this.collection(CHECKOUT_REQUESTS_COLLECTION);
  }

  /* -------------------------------- Store -------------------------------- */

  store(): CheckoutStore {
    const read = async (path: string, reads?: Map<string, number>) => {
      await tick();
      reads?.set(path, this.version(path));
      return this.docs.get(path)?.data ?? null;
    };

    return {
      getIdempotencyRecord: async (recordId) => {
        assertSafeSegment(recordId);
        const data = await read(`${CHECKOUT_REQUESTS_COLLECTION}/${recordId}`);
        return data ? parseIdempotencyRecord(data) : null;
      },

      countRecentOrders: async (uid, sinceMs, limit) => {
        await tick();
        const count = this.orders.filter(
          ([, order]) => order.userId === uid && (order.createdAtMs as number) > sinceMs,
        ).length;
        return Math.min(count, limit + 1);
      },

      newOrderId: () => `ord${String(++this.sequence).padStart(5, "0")}abcdefghijkl`,

      runTransaction: async <T,>(fn: (tx: CheckoutTransaction) => Promise<T>): Promise<T> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          this.transactionAttempts += 1;
          const reads = new Map<string, number>();
          const creates: Array<{ path: string; data: Record<string, unknown> }> = [];

          const result = await fn({
            getIdempotencyRecord: async (recordId) => {
              assertSafeSegment(recordId);
              const data = await read(`${CHECKOUT_REQUESTS_COLLECTION}/${recordId}`, reads);
              return data ? parseIdempotencyRecord(data) : null;
            },
            getShop: async (shopId) => {
              assertSafeSegment(shopId);
              return read(`shops/${shopId}`, reads);
            },
            getMenuItems: async (shopId, itemIds) => {
              assertSafeSegment(shopId);
              return Promise.all(
                itemIds.map((itemId) => {
                  assertSafeSegment(itemId);
                  return read(`shops/${shopId}/menuItems/${itemId}`, reads);
                }),
              );
            },
            createOrderWithRecord: ({ orderId, order, recordId, record }) => {
              creates.push({ path: `orders/${orderId}`, data: order });
              creates.push({ path: `${CHECKOUT_REQUESTS_COLLECTION}/${recordId}`, data: record });
            },
            createClosedAttempt: ({ recordId, record }) => {
              assertSafeSegment(recordId);
              creates.push({ path: `${CHECKOUT_REQUESTS_COLLECTION}/${recordId}`, data: record });
            },
          });

          /* ---- commit: σύγχρονο μπλοκ = ατομικό μέσα στο event loop ---- */
          const conflict = [...reads].some(([path, version]) => this.version(path) !== version);
          if (conflict) continue;

          for (const { path } of creates) {
            if (this.docs.has(path)) {
              const error = new Error("6 ALREADY_EXISTS: Document already exists") as Error & {
                code: number;
              };
              error.code = 6;
              throw error;
            }
          }

          for (const { path, data } of creates) {
            const materialized: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
              materialized[key] = value === SERVER_TIMESTAMP ? { toDate: () => new Date(this.nowMs) } : value;
            }
            if (path.startsWith("orders/")) materialized.createdAtMs = this.nowMs;
            this.put(path, materialized);
          }

          this.commits += creates.length > 0 ? 1 : 0;
          return result;
        }
        throw new Error("ABORTED: too much contention");
      },

      isAlreadyExistsError: (error) =>
        typeof error === "object" && error !== null && (error as { code?: unknown }).code === 6,
    };
  }
}
