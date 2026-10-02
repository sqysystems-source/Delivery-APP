/* ==========================================================================
 *  Milestone 3 — POST /api/admin/menu-items (λογική service).
 *
 *  Αποδεικνύει: μόνο ο ΤΡΕΧΩΝ ιδιοκτήτης γράφει, η ρύθμιση επιλογών
 *  επικυρώνεται στο σημείο εγγραφής, δεν αγγίζονται άλλα καταστήματα, τα
 *  άγνωστα υπάρχοντα πεδία μένουν. In-memory fake — ΟΧΙ πραγματικό Firestore.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE_FIELD,
  handleMenuItemWrite,
  type MenuItemDeps,
  type MenuItemResponseBody,
  type MenuWriteStore,
} from "@/lib/server/menu-item-service";
import type { MenuItemWriteInput } from "@/lib/menu/menu-item-input";
import { pizzaGroups } from "../fixtures/menu-options";

const NOW = Symbol("now");

class FakeMenuDb {
  docs = new Map<string, Record<string, unknown>>();
  writes = 0;
  private sequence = 0;

  store(): MenuWriteStore {
    return {
      newItemId: () => `new${++this.sequence}`,
      runTransaction: async (fn) => {
        const pending: Array<() => void> = [];
        const result = await fn({
          getShop: async (shopId) => this.docs.get(`shops/${shopId}`) ?? null,
          getCategory: async (shopId, id) => this.docs.get(`shops/${shopId}/menuCategories/${id}`) ?? null,
          getItem: async (shopId, id) => this.docs.get(`shops/${shopId}/menuItems/${id}`) ?? null,
          createItem: (shopId, id, data) =>
            pending.push(() => {
              const path = `shops/${shopId}/menuItems/${id}`;
              if (this.docs.has(path)) throw new Error("ALREADY_EXISTS");
              this.docs.set(path, { ...data });
            }),
          updateItem: (shopId, id, data) =>
            pending.push(() => {
              const path = `shops/${shopId}/menuItems/${id}`;
              const next = { ...(this.docs.get(path) ?? {}) };
              for (const [key, value] of Object.entries(data)) {
                if (value === DELETE_FIELD) delete next[key];
                else next[key] = value;
              }
              this.docs.set(path, next);
            }),
        });
        pending.forEach((write) => write());
        this.writes += pending.length;
        return result;
      },
    };
  }
}

let db: FakeMenuDb;
let deps: MenuItemDeps;

function item(overrides: Partial<MenuItemWriteInput> = {}): MenuItemWriteInput {
  return {
    name: "Πίτσα του σεφ",
    description: "Σάλτσα, μοτσαρέλα",
    categoryId: "pizzas",
    price: 5,
    oldPrice: null,
    image: null,
    popular: false,
    available: true,
    optionGroups: pizzaGroups(),
    ...overrides,
  };
}

const call = (payload: unknown, uid: string | null = "owner-a") =>
  handleMenuItemWrite(deps, {
    authorization: uid ? `Bearer uid-${uid}` : null,
    rawBody: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

type Failure = Extract<MenuItemResponseBody, { ok: false }>;
const asFailure = (body: MenuItemResponseBody) => body as Failure;

beforeEach(() => {
  db = new FakeMenuDb();
  db.docs.set("shops/shop-a", { name: "A", ownerUid: "owner-a" });
  db.docs.set("shops/shop-b", { name: "B", ownerUid: "owner-b" });
  db.docs.set("shops/shop-a/menuCategories/pizzas", { label: "Πίτσες" });
  db.docs.set("shops/shop-b/menuCategories/pizzas", { label: "Πίτσες" });
  db.docs.set("shops/shop-a/menuItems/legacy", {
    name: "Margherita",
    price: 8.5,
    categoryId: "pizzas",
    createdAt: "κάποτε",
    extraField: "να μείνει",
  });
  db.docs.set("shops/shop-b/menuItems/b-item", { name: "B", price: 3, categoryId: "pizzas" });
  deps = {
    store: db.store(),
    verifyIdToken: async (token) => {
      if (token.startsWith("uid-")) return { uid: token.slice(4) };
      throw new Error("bad token");
    },
    serverTimestamp: () => NOW,
    logger: { error: vi.fn() },
  };
});

/* ========================================================================== */

describe("ο τρέχων ιδιοκτήτης", () => {
  it("δημιουργεί προϊόν με επιλογές", async () => {
    const result = await call({ shopId: "shop-a", item: item() });
    expect(result.status).toBe(201);
    const created = db.docs.get("shops/shop-a/menuItems/new1");
    expect(created).toMatchObject({ shopId: "shop-a", name: "Πίτσα του σεφ", price: 5, createdAt: NOW, updatedAt: NOW });
    expect((created?.optionGroups as unknown[]).length).toBe(3);
  });

  it("προσθέτει επιλογές σε παλιό προϊόν ΧΩΡΙΣ να σβήσει άλλα πεδία", async () => {
    const result = await call({ shopId: "shop-a", itemId: "legacy", item: item({ name: "Margherita", price: 8.5 }) });
    expect(result.status).toBe(200);
    expect(db.docs.get("shops/shop-a/menuItems/legacy")).toMatchObject({
      createdAt: "κάποτε",
      extraField: "να μείνει",
      price: 8.5,
    });
  });

  it("κενές επιλογές → το πεδίο optionGroups σβήνεται (απλό προϊόν ξανά)", async () => {
    await call({ shopId: "shop-a", itemId: "legacy", item: item() });
    await call({ shopId: "shop-a", itemId: "legacy", item: item({ optionGroups: [] }) });
    expect(db.docs.get("shops/shop-a/menuItems/legacy")).not.toHaveProperty("optionGroups");
  });

  it("οι ετικέτες καθαρίζονται πριν αποθηκευτούν", async () => {
    const groups = pizzaGroups();
    groups[0].label = "  Μέγεθος​  ";
    await call({ shopId: "shop-a", item: item({ optionGroups: groups }) });
    const stored = db.docs.get("shops/shop-a/menuItems/new1")?.optionGroups as Array<{ label: string }>;
    expect(stored[0].label).toBe("Μέγεθος");
  });
});

describe("εξουσιοδότηση — μη εξουσιοδοτημένες εγγραφές ρύθμισης", () => {
  it("χωρίς token → 401, καμία εγγραφή", async () => {
    expect((await call({ shopId: "shop-a", item: item() }, null)).status).toBe(401);
    expect((await handleMenuItemWrite(deps, { authorization: "Bearer bad", rawBody: "{}" })).status).toBe(401);
    expect(db.writes).toBe(0);
  });

  it("ιδιοκτήτης ΑΛΛΟΥ καταστήματος → 403", async () => {
    const result = await call({ shopId: "shop-b", itemId: "b-item", item: item() }, "owner-a");
    expect(result.status).toBe(403);
    expect(db.docs.get("shops/shop-b/menuItems/b-item")).not.toHaveProperty("optionGroups");
    expect(db.writes).toBe(0);
  });

  it("πελάτης (μη ιδιοκτήτης) → 403", async () => {
    expect((await call({ shopId: "shop-a", item: item() }, "customer-1")).status).toBe(403);
  });

  it("πρώην ιδιοκτήτης μετά από μεταβίβαση → 403 (ελέγχεται το ΤΡΕΧΟΝ ownerUid)", async () => {
    db.docs.set("shops/shop-a", { name: "A", ownerUid: "new-owner" });
    expect((await call({ shopId: "shop-a", item: item() }, "owner-a")).status).toBe(403);
    expect(db.writes).toBe(0);
  });

  it("άγνωστο κατάστημα → 404· προϊόν που δεν υπάρχει → 404 (όχι «create» από update)", async () => {
    expect((await call({ shopId: "ghost", item: item() })).status).toBe(404);
    expect((await call({ shopId: "shop-a", itemId: "ghost", item: item() })).status).toBe(404);
    expect(db.docs.has("shops/shop-a/menuItems/ghost")).toBe(false);
  });

  it("ids με «/» (απόπειρα άλλης διαδρομής) → 400", async () => {
    expect((await call({ shopId: "shop-b/menuItems", item: item() })).status).toBe(400);
    expect((await call({ shopId: "shop-a", itemId: "../../shop-b", item: item() })).status).toBe(400);
  });
});

describe("επικύρωση στο σημείο εγγραφής", () => {
  it("αδύνατη υποχρεωτική ομάδα → 400 με λάθος ανά διαδρομή", async () => {
    const groups = pizzaGroups();
    groups[0].choices.forEach((choice) => (choice.available = false));
    const result = await call({ shopId: "shop-a", item: item({ optionGroups: groups }) });
    expect(result.status).toBe(400);
    expect(asFailure(result.body).optionErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "groups.0.choices" })]),
    );
    expect(db.writes).toBe(0);
  });

  it.each([
    ["αρνητική προσαύξηση", (g: ReturnType<typeof pizzaGroups>) => { g[1].choices[0].priceDelta = -1; }],
    ["NaN προσαύξηση (ως null στο JSON)", (g: ReturnType<typeof pizzaGroups>) => { g[1].choices[0].priceDelta = Number.NaN; }],
    ["διπλό id", (g: ReturnType<typeof pizzaGroups>) => { g[1].choices[1].id = "cheese"; }],
    ["min > max", (g: ReturnType<typeof pizzaGroups>) => { g[1].required = true; g[1].minSelect = 3; g[1].maxSelect = 2; }],
  ])("%s → 400, καμία εγγραφή", async (_name, mutate) => {
    const groups = pizzaGroups();
    mutate(groups);
    const result = await call({ shopId: "shop-a", item: item({ optionGroups: groups }) });
    expect(result.status).toBe(400);
    expect(asFailure(result.body).code).toBe("validation_failed");
    expect(db.writes).toBe(0);
  });

  it("βασικά πεδία: τιμή 3 δεκαδικών, παλιά τιμή ≤ τιμής, URL χωρίς http → 400 ανά πεδίο", async () => {
    const result = await call({
      shopId: "shop-a",
      item: item({ price: 3.999, oldPrice: 1, image: "javascript:alert(1)" }),
    });
    expect(result.status).toBe(400);
    expect(Object.keys(asFailure(result.body).fieldErrors ?? {})).toEqual(expect.arrayContaining(["price", "image"]));
  });

  it("κατηγορία που δεν υπάρχει → 400 στο categoryId", async () => {
    const result = await call({ shopId: "shop-a", item: item({ categoryId: "ghost" }) });
    expect(asFailure(result.body).fieldErrors?.categoryId).toBeTruthy();
  });

  it("πολύ μεγάλο σώμα → 413", async () => {
    const result = await call(JSON.stringify({ shopId: "shop-a", pad: "x".repeat(40_000) }));
    expect(result.status).toBe(413);
  });
});

describe("συμβατότητα με τα Rules του menuItems", () => {
  /* Ό,τι γράφει ο server πρέπει να περνά το isValidMenuItem των Rules —
   * αλλιώς η άμεση εναλλαγή διαθεσιμότητας από τον browser θα απορριπτόταν. */
  const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
  const block = rules.slice(rules.indexOf("match /menuItems/{itemId}"));
  const allowed = [...(block.match(/hasOnly\(\[([\s\S]*?)\]\)/)?.[1].matchAll(/'([A-Za-z]+)'/g) ?? [])].map(
    (match) => match[1],
  );

  it("τα πεδία που γράφει ο server είναι όλα στη λίστα hasOnly των Rules (μαζί με optionGroups)", async () => {
    expect(allowed).toContain("optionGroups");
    await call({
      shopId: "shop-a",
      item: item({ oldPrice: 6, image: "https://example.com/p.jpg", popular: true }),
    });
    const written = db.docs.get("shops/shop-a/menuItems/new1") ?? {};
    for (const key of Object.keys(written)) expect(allowed).toContain(key);
  });

  it("URL εικόνας > 500 χαρακτήρες (όριο των Rules) → 400 από τον server", async () => {
    const result = await call({ shopId: "shop-a", item: item({ image: `https://example.com/${"a".repeat(490)}` }) });
    expect(result.status).toBe(400);
    expect(asFailure(result.body).fieldErrors?.image).toContain("500");
  });
});
