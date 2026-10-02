/* ==========================================================================
 *  Milestone 3 — browser client του POST /api/admin/menu-items.
 * ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  currentUser: null as { getIdToken: () => Promise<string> } | null,
}));
vi.mock("@/lib/firebase", () => ({ auth: authState }));

import { MENU_ITEMS_ENDPOINT, MenuItemSaveError, saveMenuItem } from "@/lib/menu/save-menu-item";
import type { MenuItemWriteInput } from "@/lib/menu/menu-item-input";
import { pizzaGroups } from "../fixtures/menu-options";

const item: MenuItemWriteInput = {
  name: "Πίτσα",
  description: "",
  categoryId: "pizzas",
  price: 5,
  oldPrice: null,
  image: null,
  popular: false,
  available: true,
  optionGroups: pizzaGroups(),
};

beforeEach(() => {
  authState.currentUser = { getIdToken: async () => "token-123" };
});

describe("saveMenuItem", () => {
  it("στέλνει Bearer token, shopId, itemId και το προϊόν", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, itemId: "pizza", created: false }));
    await expect(saveMenuItem("shop-a", item, "pizza", fetchMock)).resolves.toEqual({ itemId: "pizza", created: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MENU_ITEMS_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body as string)).toEqual({ shopId: "shop-a", itemId: "pizza", item });
  });

  it("χωρίς σύνδεση → σφάλμα χωρίς αίτημα", async () => {
    authState.currentUser = null;
    const fetchMock = vi.fn();
    await expect(saveMenuItem("shop-a", item, undefined, fetchMock)).rejects.toBeInstanceOf(MenuItemSaveError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("μεταφέρει τα λάθη ανά πεδίο/διαδρομή του server", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          code: "validation_failed",
          message: "Έλεγξε τα πεδία του προϊόντος.",
          fieldErrors: { price: "λάθος τιμή" },
          optionErrors: [{ path: "groups.0.label", message: "λάθος τίτλος" }],
        },
        { status: 400 },
      ),
    );
    const error = (await saveMenuItem("shop-a", item, undefined, fetchMock).catch((caught) => caught)) as MenuItemSaveError;
    expect(error).toBeInstanceOf(MenuItemSaveError);
    expect(error).toMatchObject({ code: "validation_failed", fieldErrors: { price: "λάθος τιμή" } });
    expect(error.optionErrors?.[0].path).toBe("groups.0.label");
  });

  it("σφάλμα δικτύου → ελληνικό μήνυμα", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(saveMenuItem("shop-a", item, undefined, fetchMock)).rejects.toMatchObject({ code: "network_error" });
  });
});
