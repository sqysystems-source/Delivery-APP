/* ==========================================================================
 *  POST /api/admin/shop-settings (milestone 4) — λογική του service.
 *
 *  ΨΕΥΤΙΚΟ store in-memory: η εγγραφή είναι update (merge) ώστε να φαίνεται
 *  ότι τα άσχετα πεδία μένουν. Ο έλεγχος ιδιοκτήτη γίνεται ΜΕΣΑ στη
 *  συναλλαγή — εδώ το αποδεικνύουμε αλλάζοντας ιδιοκτήτη ανάμεσα στην
 *  ταυτοποίηση και τη συναλλαγή.
 * ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_DELETE_FIELD,
  handleShopSettingsWrite,
  type ShopSettingsDeps,
  type ShopSettingsResponseBody,
} from "@/lib/server/shop-settings-service";
import { emptyWeekly } from "@/lib/shop/opening-hours";

const STAMP = Symbol("now");

let shops: Map<string, Record<string, unknown>>;
let deps: ShopSettingsDeps;
let beforeTransaction: (() => void) | null;

const HOURS = {
  enabled: true,
  weekly: { ...emptyWeekly(), fri: [{ open: "18:00", close: "02:00" }] },
  exceptions: [{ date: "2026-12-25", closed: true, intervals: [] }],
};

const ZONES = {
  enabled: true,
  zones: [
    {
      id: "zcenter",
      name: " Κέντρο ",
      available: true,
      postalCodes: ["546 22", "54621"],
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: null,
    },
  ],
};

function call(body: unknown, token: string | null = "uid-owner-1") {
  return handleShopSettingsWrite(deps, {
    authorization: token ? `Bearer ${token}` : null,
    rawBody: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const failure = (body: ShopSettingsResponseBody) => body as Extract<ShopSettingsResponseBody, { ok: false }>;

beforeEach(() => {
  shops = new Map([
    [
      "shop-a",
      {
        name: "Pizza A",
        ownerUid: "owner-1",
        active: false,
        minOrder: 8,
        deliveryFee: 1.5,
        rating: 4.8,
        openingHours: { enabled: false, weekly: emptyWeekly(), exceptions: [] },
      },
    ],
    ["shop-b", { name: "Shop B", ownerUid: "owner-2" }],
  ]);
  beforeTransaction = null;
  deps = {
    verifyIdToken: async (token) => {
      if (token.startsWith("uid-")) return { uid: token.slice(4) };
      throw new Error("bad token");
    },
    serverTimestamp: () => STAMP,
    logger: { error: vi.fn() },
    store: {
      runTransaction: async (fn) => {
        beforeTransaction?.();
        const pending: Array<[string, Record<string, unknown>]> = [];
        const result = await fn({
          getShop: async (shopId) => (shops.has(shopId) ? { ...(shops.get(shopId) as Record<string, unknown>) } : null),
          updateShop: (shopId, data) => pending.push([shopId, data]),
        });
        for (const [shopId, data] of pending) {
          const next = { ...(shops.get(shopId) as Record<string, unknown>) };
          for (const [key, value] of Object.entries(data)) {
            if (value === SETTINGS_DELETE_FIELD) delete next[key];
            else next[key] = value;
          }
          shops.set(shopId, next);
        }
        return result;
      },
    },
  };
});

describe("εξουσιοδότηση", () => {
  it("χωρίς token → 401", async () => {
    expect((await call({ shopId: "shop-a", openingHours: HOURS }, null)).status).toBe(401);
  });

  it("άκυρο token → 401", async () => {
    expect((await call({ shopId: "shop-a", openingHours: HOURS }, "forged")).status).toBe(401);
  });

  it("ιδιοκτήτης άλλου καταστήματος → 403, τίποτα δεν αλλάζει", async () => {
    const before = structuredClone(shops.get("shop-b"));
    const result = await call({ shopId: "shop-b", openingHours: HOURS }, "uid-owner-1");
    expect(result.status).toBe(403);
    expect(shops.get("shop-b")).toEqual(before);
  });

  it("ο ιδιοκτήτης ελέγχεται ΜΕΣΑ στη συναλλαγή (μεταβίβαση στο μεταξύ → 403)", async () => {
    beforeTransaction = () => shops.set("shop-a", { ...(shops.get("shop-a") as Record<string, unknown>), ownerUid: "new-owner" });
    const result = await call({ shopId: "shop-a", openingHours: HOURS });
    expect(result.status).toBe(403);
    expect((shops.get("shop-a") as Record<string, unknown>).openingHours).toMatchObject({ enabled: false });
  });

  it("ανύπαρκτο κατάστημα → 404", async () => {
    expect((await call({ shopId: "nope", openingHours: HOURS })).status).toBe(404);
  });

  it("μη έγκυρο shopId (διαδρομή) → 400", async () => {
    expect((await call({ shopId: "shop-a/../shop-b", openingHours: HOURS })).status).toBe(400);
  });
});

describe("επικύρωση και αποθήκευση", () => {
  it("αποθηκεύει ωράριο και ζώνες σε κανονική μορφή — τα άσχετα πεδία μένουν", async () => {
    const result = await call({ shopId: "shop-a", openingHours: HOURS, deliveryZones: ZONES });
    expect(result.status).toBe(200);
    const shop = shops.get("shop-a") as Record<string, unknown>;
    expect(shop).toMatchObject({ name: "Pizza A", ownerUid: "owner-1", active: false, minOrder: 8, rating: 4.8 });
    expect(shop.updatedAt).toBe(STAMP);
    expect(shop.openingHours).toEqual(HOURS);
    expect(shop.deliveryZones).toEqual({
      enabled: true,
      zones: [{ ...ZONES.zones[0], name: "Κέντρο", postalCodes: ["54621", "54622"] }],
    });
    expect(result.body).toMatchObject({ ok: true, deliveryZones: { zones: [{ postalCodes: ["54621", "54622"] }] } });
  });

  it("στέλνει μόνο τη μία ενότητα → η άλλη δεν αγγίζεται", async () => {
    await call({ shopId: "shop-a", deliveryZones: ZONES });
    expect((shops.get("shop-a") as Record<string, unknown>).openingHours).toMatchObject({ enabled: false });
  });

  it("null = διαγραφή ρύθμισης (επιστροφή στην παλιά συμπεριφορά)", async () => {
    await call({ shopId: "shop-a", openingHours: null });
    expect(shops.get("shop-a")).not.toHaveProperty("openingHours");
  });

  it("άκυρο ωράριο → 400 με διαδρομές λαθών, τίποτα δεν γράφεται", async () => {
    const result = await call({
      shopId: "shop-a",
      openingHours: { ...HOURS, weekly: { ...emptyWeekly(), mon: [{ open: "12:00", close: "16:00" }, { open: "15:00", close: "18:00" }] } },
    });
    expect(result.status).toBe(400);
    expect(failure(result.body).errors?.[0]).toMatchObject({ path: "openingHours.weekly.mon" });
    expect((shops.get("shop-a") as Record<string, unknown>).openingHours).toMatchObject({ enabled: false });
  });

  it("ΤΚ σε δύο ζώνες → 400 (κάθε ΤΚ σε μία μόνο ζώνη)", async () => {
    const result = await call({
      shopId: "shop-a",
      deliveryZones: {
        enabled: true,
        zones: [ZONES.zones[0], { ...ZONES.zones[0], id: "zother", name: "Άλλη", postalCodes: ["54622"] }],
      },
    });
    expect(result.status).toBe(400);
    expect(failure(result.body).errors?.[0].message).toContain("ανήκει ήδη");
  });

  it.each([
    ["κακόμορφος ΤΚ", { postalCodes: ["5462A"] }],
    ["διπλός ΤΚ στη ζώνη", { postalCodes: ["54622", "546 22"] }],
    ["αρνητικά μεταφορικά", { deliveryFeeCents: -1 }],
    ["μεταφορικά σε ευρώ (δεκαδικά)", { deliveryFeeCents: 1.5 }],
    ["υπερβολική ελάχιστη", { minOrderCents: 50_001 }],
    ["δωρεάν από 0", { freeDeliveryOverCents: 0 }],
    ["κενό όνομα", { name: "  " }],
    ["μη έγκυρο id", { id: "z one" }],
    ["χωρίς ΤΚ", { postalCodes: [] }],
    ["άγνωστο πεδίο", { radiusKm: 3 }],
  ])("απορρίπτει ζώνη: %s", async (_label, patch) => {
    const result = await call({ shopId: "shop-a", deliveryZones: { enabled: true, zones: [{ ...ZONES.zones[0], ...patch }] } });
    expect(result.status).toBe(400);
    expect(shops.get("shop-a")).not.toHaveProperty("deliveryZones");
  });

  it("ενεργός περιορισμός χωρίς ζώνες → 400", async () => {
    expect((await call({ shopId: "shop-a", deliveryZones: { enabled: true, zones: [] } })).status).toBe(400);
  });

  it("όριο πλήθους ζωνών", async () => {
    const zones = Array.from({ length: 21 }, (_, index) => ({
      ...ZONES.zones[0],
      id: `z${index}`,
      postalCodes: [String(10000 + index)],
    }));
    expect((await call({ shopId: "shop-a", deliveryZones: { enabled: true, zones } })).status).toBe(400);
  });

  it("πεδία εκτός ωραρίου/ζωνών (π.χ. ownerUid, minOrder) → 400", async () => {
    const result = await call({ shopId: "shop-a", openingHours: HOURS, ownerUid: "owner-1", minOrder: 0 });
    expect(result.status).toBe(400);
    expect(shops.get("shop-a")).toMatchObject({ minOrder: 8 });
  });

  it("κενό αίτημα (καμία ενότητα) → 400", async () => {
    expect((await call({ shopId: "shop-a" })).status).toBe(400);
  });

  it("πολύ μεγάλο σώμα → 413", async () => {
    expect((await call("x".repeat(70_000))).status).toBe(413);
  });

  it("άκυρο JSON → 400", async () => {
    expect((await call("{not json")).status).toBe(400);
  });

  it("σφάλμα βάσης → 500 χωρίς λεπτομέρειες", async () => {
    deps.store = { runTransaction: async () => Promise.reject(new Error("db down: secret detail")) };
    const result = await call({ shopId: "shop-a", openingHours: HOURS });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });
});
