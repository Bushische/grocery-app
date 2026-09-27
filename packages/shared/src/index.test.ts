import { describe, expect, it } from "vitest";
import {
  API_BASE_PATH,
  addListMemberRequestSchema,
  categorySchema,
  createCategoryRequestSchema,
  createItemRequestSchema,
  createListRequestSchema,
  hexColorSchema,
  itemDetailSchema,
  itemSchema,
  itemStatusByFilter,
  itemStatusFilterSchema,
  listRoleSchema,
  listSummarySchema,
  loginRequestSchema,
  loginResponseSchema,
  priceObservationSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
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
  };

  it("itemSchema accepts the DTO shape with nullable fields", () => {
    expect(itemSchema.parse(item)).toEqual(item);
    expect(itemSchema.parse({ ...item, qtyText: null, status: "BOUGHT" })).toEqual({
      ...item,
      qtyText: null,
      status: "BOUGHT",
    });
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
    };
    const detail = {
      ...item,
      prices: [{ price: 1.99, shop: "Lidl", observedAt: "2026-09-25T10:00:00.000Z" }],
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
