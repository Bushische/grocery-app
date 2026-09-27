import { describe, expect, it } from "vitest";
import {
  API_BASE_PATH,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_SUGGEST_RESULTS,
  addListMemberRequestSchema,
  categorySchema,
  createCategoryRequestSchema,
  createItemRequestSchema,
  createListRequestSchema,
  createPriceObservationRequestSchema,
  hexColorSchema,
  itemDetailSchema,
  itemImageResponseSchema,
  itemSchema,
  itemStatusByFilter,
  itemStatusFilterSchema,
  listRoleSchema,
  listSummarySchema,
  loginRequestSchema,
  loginResponseSchema,
  moveItemRequestSchema,
  priceObservationSchema,
  pricesResponseSchema,
  searchResponseSchema,
  searchResultSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
  suggestResponseSchema,
  updateCategoryRequestSchema,
  updateItemRequestSchema,
} from "./index";

describe("shared package", () => {
  it("exports the API base path", () => {
    expect(API_BASE_PATH).toBe("/api");
  });
});

describe("loginRequestSchema", () => {
  it("trims and lowercases the email", () => {
    const parsed = loginRequestSchema.parse({ email: "  Alex@Example.COM ", password: "secret" });
    expect(parsed).toEqual({ email: "alex@example.com", password: "secret" });
  });

  it("rejects non-email addresses and empty passwords", () => {
    expect(loginRequestSchema.safeParse({ email: "nope", password: "secret" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ password: "secret" }).success).toBe(false);
  });
});

describe("loginResponseSchema", () => {
  it("requires accessToken and a user with id, email, role", () => {
    const value = { accessToken: "eyJ...", user: { id: "u1", email: "a@b.co", role: "admin" } };
    expect(loginResponseSchema.parse(value)).toEqual(value);
    expect(
      loginResponseSchema.safeParse({ user: { id: "u1", email: "a@b.co", role: "admin" } }).success,
    ).toBe(false);
    expect(
      loginResponseSchema.safeParse({
        accessToken: "x",
        user: { id: "u1", email: "a@b.co", role: "superuser" },
      }).success,
    ).toBe(false);
  });
});

describe("list schemas", () => {
  it("createListRequestSchema trims the title and rejects empty or whitespace-only titles", () => {
    expect(createListRequestSchema.parse({ title: "  Weekly " })).toEqual({ title: "Weekly" });
    expect(createListRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createListRequestSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createListRequestSchema.safeParse({}).success).toBe(false);
  });

  it("listRoleSchema accepts only OWNER, EDITOR, VIEWER", () => {
    expect(listRoleSchema.parse("OWNER")).toBe("OWNER");
    expect(listRoleSchema.parse("EDITOR")).toBe("EDITOR");
    expect(listRoleSchema.parse("VIEWER")).toBe("VIEWER");
    expect(listRoleSchema.safeParse("ADMIN").success).toBe(false);
    expect(listRoleSchema.safeParse("owner").success).toBe(false);
  });

  it("addListMemberRequestSchema normalizes the email and validates the role", () => {
    expect(
      addListMemberRequestSchema.parse({ email: " Mom@Example.COM ", role: "EDITOR" }),
    ).toEqual({ email: "mom@example.com", role: "EDITOR" });
    expect(addListMemberRequestSchema.safeParse({ email: "nope", role: "EDITOR" }).success).toBe(
      false,
    );
    expect(addListMemberRequestSchema.safeParse({ email: "a@b.co", role: "GOD" }).success).toBe(
      false,
    );
  });

  it("listSummarySchema requires id, title, role, and itemCounts", () => {
    const value = { id: "l1", title: "Weekly", role: "OWNER", itemCounts: { toBuy: 5, bought: 2 } };
    expect(listSummarySchema.parse(value)).toEqual(value);
    expect(listSummarySchema.safeParse({ ...value, itemCounts: { toBuy: 1 } }).success).toBe(false);
    expect(listSummarySchema.safeParse({ ...value, role: "GOD" }).success).toBe(false);
    expect(
      listSummarySchema.safeParse({ ...value, itemCounts: { toBuy: -1, bought: 0 } }).success,
    ).toBe(false);
  });
});

describe("category schemas", () => {
  it("hexColorSchema accepts only #RRGGBB", () => {
    expect(hexColorSchema.parse("#6B7280")).toBe("#6B7280");
    expect(hexColorSchema.parse("#3B82F6")).toBe("#3B82F6");
    expect(hexColorSchema.parse("#ff8800")).toBe("#ff8800");
    for (const bad of ["blue", "#12345", "#1234567", "#GGGGGG", "6B7280", ""]) {
      expect(hexColorSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("createCategoryRequestSchema requires a title and a hex color", () => {
    expect(createCategoryRequestSchema.parse({ title: "  Dairy ", color: "#3B82F6" })).toEqual({
      title: "Dairy",
      color: "#3B82F6",
    });
    expect(createCategoryRequestSchema.safeParse({ title: "Dairy" }).success).toBe(false);
    expect(createCategoryRequestSchema.safeParse({ title: " ", color: "#3B82F6" }).success).toBe(
      false,
    );
    expect(createCategoryRequestSchema.safeParse({ title: "Dairy", color: "blue" }).success).toBe(
      false,
    );
  });

  it("updateCategoryRequestSchema allows partial patches and an empty no-op", () => {
    expect(updateCategoryRequestSchema.parse({ title: " Dairy " })).toEqual({ title: "Dairy" });
    expect(updateCategoryRequestSchema.parse({ color: "#3B82F6" })).toEqual({
      color: "#3B82F6",
    });
    expect(updateCategoryRequestSchema.parse({})).toEqual({});
    expect(updateCategoryRequestSchema.safeParse({ color: "blue" }).success).toBe(false);
    expect(updateCategoryRequestSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("categorySchema requires id, title, color, sortOrder, and itemCount", () => {
    const value = { id: "c1", title: "Dairy", color: "#3B82F6", sortOrder: 0, itemCount: 4 };
    expect(categorySchema.parse(value)).toEqual(value);
    expect(categorySchema.safeParse({ ...value, sortOrder: -1 }).success).toBe(false);
    expect(categorySchema.safeParse({ ...value, itemCount: 1.5 }).success).toBe(false);
    expect(categorySchema.safeParse({ ...value, color: "#3B82F" }).success).toBe(false);
  });
});

describe("item schemas", () => {
  const item = {
    id: "i1",
    title: "Milk",
    qtyText: "2x",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: "2026-09-27T08:00:00.000Z",
    daysInList: 3,
    category: { id: "c1", title: "Dairy", color: "#3B82F6" },
    imageFilename: null,
    currentPrice: null,
  };

  it("itemSchema accepts the DTO shape with nullable fields", () => {
    expect(itemSchema.parse(item)).toEqual(item);
    expect(itemSchema.parse({ ...item, qtyText: null, status: "BOUGHT" })).toEqual({
      ...item,
      qtyText: null,
      status: "BOUGHT",
    });
  });

  it("itemSchema accepts a populated currentPrice and rejects an invalid one", () => {
    const priced = {
      ...item,
      currentPrice: { price: 1.99, shop: "Lidl", observedAt: "2026-09-25T10:00:00.000Z" },
    };
    expect(itemSchema.parse(priced)).toEqual(priced);
    expect(
      itemSchema.safeParse({ ...item, currentPrice: { price: 0, shop: "Lidl" } }).success,
    ).toBe(false);
    expect(itemSchema.safeParse({ ...item, currentPrice: { price: 1.99, shop: "" } }).success).toBe(
      false,
    );
  });

  it("itemSchema rejects bad status, timestamps, and negative days", () => {
    expect(itemSchema.safeParse({ ...item, status: "BOUGHT?" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, addedAt: "2026-09-27 08:00" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...item, daysInList: -1 }).success).toBe(false);
    expect(
      itemSchema.safeParse({ ...item, category: { ...item.category, color: "red" } }).success,
    ).toBe(false);
  });
});

describe("item request schemas", () => {
  it("createItemRequestSchema requires a title and allows optional category/qty", () => {
    expect(createItemRequestSchema.parse({ title: " Milk " })).toEqual({ title: "Milk" });
    expect(
      createItemRequestSchema.parse({ title: "Milk", categoryId: "c1", qtyText: " 2x " }),
    ).toEqual({ title: "Milk", categoryId: "c1", qtyText: "2x" });
    expect(createItemRequestSchema.parse({ title: "Milk", qtyText: null })).toEqual({
      title: "Milk",
      qtyText: null,
    });
    expect(createItemRequestSchema.safeParse({}).success).toBe(false);
    expect(createItemRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createItemRequestSchema.safeParse({ title: "Milk", qtyText: "  " }).success).toBe(false);
  });

  it("updateItemRequestSchema allows partial patches and clearing qtyText with null", () => {
    expect(updateItemRequestSchema.parse({})).toEqual({});
    expect(updateItemRequestSchema.parse({ title: " Bread ", qtyText: null })).toEqual({
      title: "Bread",
      qtyText: null,
    });
    expect(updateItemRequestSchema.safeParse({ title: "" }).success).toBe(false);
    expect(updateItemRequestSchema.safeParse({ qtyText: "" }).success).toBe(false);
  });

  it("smartAddRequestSchema trims and requires non-empty text", () => {
    expect(smartAddRequestSchema.parse({ text: " semi milk " })).toEqual({ text: "semi milk" });
    expect(smartAddRequestSchema.safeParse({}).success).toBe(false);
    expect(smartAddRequestSchema.safeParse({ text: "   " }).success).toBe(false);
  });
});

describe("smartAddResponseSchema", () => {
  const item = {
    id: "i1",
    title: "Milk",
    qtyText: "2x",
    status: "TO_BUY",
    sortOrder: 0,
    addedAt: "2026-09-27T08:00:00.000Z",
    daysInList: 3,
    category: { id: "c1", title: "Dairy", color: "#3B82F6" },
    imageFilename: null,
    currentPrice: null,
  };

  it("accepts created/matchedBy/item and validates matchedBy values", () => {
    expect(smartAddResponseSchema.parse({ created: false, matchedBy: "exact", item })).toEqual({
      created: false,
      matchedBy: "exact",
      item,
    });
    for (const matchedBy of ["substring", "fuzzy"] as const) {
      expect(smartAddResponseSchema.parse({ created: false, matchedBy, item }).matchedBy).toBe(
        matchedBy,
      );
    }
    expect(
      smartAddResponseSchema.parse({ created: true, matchedBy: "created", item }).created,
    ).toBe(true);
  });

  it("rejects unknown matchedBy values and missing fields", () => {
    expect(
      smartAddResponseSchema.safeParse({ created: false, matchedBy: "regex", item }).success,
    ).toBe(false);
    expect(smartAddResponseSchema.safeParse({ created: false, matchedBy: "exact" }).success).toBe(
      false,
    );
  });
});

describe("price observation schemas", () => {
  it("priceObservationSchema requires positive decimal price, shop, ISO date", () => {
    const value = { price: 1.99, shop: "Lidl", observedAt: "2026-09-25T10:00:00.000Z" };
    expect(priceObservationSchema.parse(value)).toEqual(value);
    expect(priceObservationSchema.safeParse({ ...value, price: 0 }).success).toBe(false);
    expect(priceObservationSchema.safeParse({ ...value, price: -1 }).success).toBe(false);
    expect(priceObservationSchema.safeParse({ ...value, shop: "" }).success).toBe(false);
    expect(priceObservationSchema.safeParse({ ...value, observedAt: "yesterday" }).success).toBe(
      false,
    );
  });

  it("createPriceObservationRequestSchema trims shop and makes observedAt optional", () => {
    expect(createPriceObservationRequestSchema.parse({ price: 1.99, shop: " Lidl " })).toEqual({
      price: 1.99,
      shop: "Lidl",
    });
    expect(
      createPriceObservationRequestSchema.parse({
        price: 0.5,
        shop: "Rewe",
        observedAt: "2026-09-25T10:00:00.000Z",
      }),
    ).toEqual({ price: 0.5, shop: "Rewe", observedAt: "2026-09-25T10:00:00.000Z" });
    expect(createPriceObservationRequestSchema.safeParse({ price: 0, shop: "Lidl" }).success).toBe(
      false,
    );
    expect(createPriceObservationRequestSchema.safeParse({ price: 1.99, shop: "  " }).success).toBe(
      false,
    );
    expect(createPriceObservationRequestSchema.safeParse({ shop: "Lidl" }).success).toBe(false);
    expect(
      createPriceObservationRequestSchema.safeParse({ price: 1.99, shop: "Lidl", observedAt: "x" })
        .success,
    ).toBe(false);
    expect(
      createPriceObservationRequestSchema.safeParse({ price: "1.99", shop: "Lidl" }).success,
    ).toBe(false);
  });

  it("pricesResponseSchema requires the observations array and a nullable nextCursor", () => {
    const observation = { price: 1.99, shop: "Lidl", observedAt: "2026-09-25T10:00:00.000Z" };
    expect(pricesResponseSchema.parse({ observations: [observation], nextCursor: null })).toEqual({
      observations: [observation],
      nextCursor: null,
    });
    expect(pricesResponseSchema.parse({ observations: [], nextCursor: "abc" }).nextCursor).toBe(
      "abc",
    );
    expect(pricesResponseSchema.safeParse({ observations: [] }).success).toBe(false);
    expect(
      pricesResponseSchema.safeParse({ observations: [observation], nextCursor: 5 }).success,
    ).toBe(false);
  });

  it("itemDetailSchema extends the item DTO with the prices array", () => {
    const item = {
      id: "i1",
      title: "Milk",
      qtyText: null,
      status: "TO_BUY",
      sortOrder: 0,
      addedAt: "2026-09-27T08:00:00.000Z",
      daysInList: 3,
      category: { id: "c1", title: "Dairy", color: "#3B82F6" },
      imageFilename: null,
      currentPrice: { price: 1.29, shop: "Rewe", observedAt: "2026-09-26T10:00:00.000Z" },
    };
    const detail = {
      ...item,
      prices: [
        { price: 1.29, shop: "Rewe", observedAt: "2026-09-26T10:00:00.000Z" },
        { price: 1.19, shop: "Lidl", observedAt: "2026-09-25T10:00:00.000Z" },
      ],
    };
    expect(itemDetailSchema.parse(detail)).toEqual(detail);
    expect(itemDetailSchema.safeParse(item).success).toBe(false);
  });
});

describe("itemStatusFilterSchema", () => {
  it("accepts only the to_buy/bought query values and maps them to statuses", () => {
    expect(itemStatusFilterSchema.parse("to_buy")).toBe("to_buy");
    expect(itemStatusFilterSchema.parse("bought")).toBe("bought");
    expect(itemStatusFilterSchema.safeParse("TO_BUY").success).toBe(false);
    expect(itemStatusFilterSchema.safeParse("all").success).toBe(false);
    expect(itemStatusByFilter.to_buy).toBe("TO_BUY");
    expect(itemStatusByFilter.bought).toBe("BOUGHT");
  });
});

describe("moveItemRequestSchema", () => {
  it("accepts the filter-style target status of POST /items/:id/move", () => {
    expect(moveItemRequestSchema.parse({ status: "bought" })).toEqual({ status: "bought" });
    expect(moveItemRequestSchema.parse({ status: "to_buy" })).toEqual({ status: "to_buy" });
  });

  it("rejects stored-enum values, unknown values, and missing status", () => {
    expect(moveItemRequestSchema.safeParse({ status: "BOUGHT" }).success).toBe(false);
    expect(moveItemRequestSchema.safeParse({ status: "TO_BUY" }).success).toBe(false);
    expect(moveItemRequestSchema.safeParse({ status: "all" }).success).toBe(false);
    expect(moveItemRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("item image schemas", () => {
  it("exposes the 2 MB upload limit and 600 px resize edge from the contracts", () => {
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_IMAGE_DIMENSION).toBe(600);
  });

  it("itemImageResponseSchema requires the imageFilename", () => {
    expect(itemImageResponseSchema.parse({ imageFilename: "i1-abc.webp" })).toEqual({
      imageFilename: "i1-abc.webp",
    });
    expect(itemImageResponseSchema.safeParse({}).success).toBe(false);
    expect(itemImageResponseSchema.safeParse({ imageFilename: "" }).success).toBe(false);
  });
});

describe("suggest & search schemas (T12)", () => {
  it("MAX_SUGGEST_RESULTS matches the contract", () => {
    expect(MAX_SUGGEST_RESULTS).toBe(20);
  });

  it("suggestResponseSchema validates grouped suggestions", () => {
    const parsed = suggestResponseSchema.parse({
      groups: [
        {
          category: { id: "c1", title: "Dairy", color: "#3B82F6" },
          items: [{ id: "i1", title: "Milk", qtyText: null, status: "TO_BUY" }],
        },
      ],
    });
    expect(parsed.groups[0]!.category.color).toBe("#3B82F6");
    expect(suggestResponseSchema.safeParse({ groups: [{ category: { id: "c1" } }] }).success).toBe(
      false,
    );
  });

  it("searchResultSchema requires itemId, listId, title, status, categoryColor", () => {
    expect(
      searchResponseSchema.parse({
        results: [
          { itemId: "i1", listId: "l1", title: "Milk", status: "BOUGHT", categoryColor: "#000000" },
        ],
      }).results,
    ).toHaveLength(1);
    expect(
      searchResultSchema.safeParse({ itemId: "i1", listId: "l1", title: "Milk", status: "BOUGHT" })
        .success,
    ).toBe(false);
    expect(searchResultSchema.safeParse({ itemId: "i1", categoryColor: "red" }).success).toBe(
      false,
    );
  });
});
