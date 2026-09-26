import { pathToFileURL } from "node:url";
import { createId } from "@paralleldrive/cuid2";
import { hashSync } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type Db, createDb, createSqlite } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import {
  categories,
  groceryLists,
  items,
  listMembers,
  priceObservations,
  users,
} from "../src/db/schema";

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z.email().default("admin@grocery.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("admin-password"),
  SEED_MEMBER_EMAIL: z.email().default("member@grocery.local"),
  SEED_MEMBER_PASSWORD: z.string().min(8).default("member-password"),
});

export type SeedEnv = z.infer<typeof seedEnvSchema>;

export interface SeedResult {
  adminEmail: string;
  memberEmail: string;
  listId: string;
  counts: {
    users: number;
    lists: number;
    categories: number;
    items: number;
    priceObservations: number;
  };
}

const DAY_MS = 86_400_000;

function getOrCreateUser(db: Db, email: string, password: string, role: "admin" | "user") {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return existing;
  }
  return db
    .insert(users)
    .values({ id: createId(), email, passwordHash: hashSync(password, 10), role })
    .returning()
    .get();
}

/**
 * Seeds demo data per docs/TASKS.md T3: 1 admin user, 1 member user, 1 list,
 * 3 categories (incl. the default "Other"), 3 items, 4 price observations.
 * Idempotent: every entity is looked up by its natural key first; price
 * observations are only inserted together with a freshly created item.
 */
export function seedDatabase(db: Db, env: SeedEnv = seedEnvSchema.parse(process.env)): SeedResult {
  const admin = getOrCreateUser(db, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD, "admin");
  const member = getOrCreateUser(db, env.SEED_MEMBER_EMAIL, env.SEED_MEMBER_PASSWORD, "user");

  let list = db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.ownerId, admin.id), eq(groceryLists.title, "Weekly")))
    .get();
  if (!list) {
    list = db
      .insert(groceryLists)
      .values({ id: createId(), title: "Weekly", ownerId: admin.id })
      .returning()
      .get();
    db.insert(listMembers)
      .values([
        { listId: list.id, userId: admin.id, role: "OWNER" },
        { listId: list.id, userId: member.id, role: "EDITOR" },
      ])
      .run();
  }

  const getOrCreateCategory = (title: string, color: string, sortOrder: number) => {
    const existing = db
      .select()
      .from(categories)
      .where(and(eq(categories.listId, list.id), eq(categories.title, title)))
      .get();
    if (existing) {
      return existing;
    }
    return db
      .insert(categories)
      .values({ id: createId(), listId: list.id, title, color, sortOrder })
      .returning()
      .get();
  };

  const other = getOrCreateCategory("Other", "#6B7280", 0);
  const dairy = getOrCreateCategory("Dairy", "#3B82F6", 1);
  const produce = getOrCreateCategory("Produce", "#22C55E", 2);

  const now = Date.now();

  const getOrCreateItem = (
    title: string,
    categoryId: string,
    values: Partial<typeof items.$inferInsert>,
  ) => {
    const existing = db
      .select()
      .from(items)
      .where(and(eq(items.listId, list.id), eq(items.title, title)))
      .get();
    if (existing) {
      return { item: existing, created: false as const };
    }
    const item = db
      .insert(items)
      .values({
        id: createId(),
        listId: list.id,
        categoryId,
        title,
        ...values,
      })
      .returning()
      .get();
    return { item, created: true as const };
  };

  const milk = getOrCreateItem("Milk", dairy.id, {
    qtyText: "1L",
    status: "TO_BUY",
    sortOrder: 0,
    usageCount: 2,
    addedAt: new Date(now - 3 * DAY_MS),
  });
  const bananas = getOrCreateItem("Bananas", produce.id, {
    qtyText: "1 bunch",
    status: "TO_BUY",
    sortOrder: 1,
    usageCount: 1,
    addedAt: new Date(now - 1 * DAY_MS),
  });
  const bread = getOrCreateItem("Bread", other.id, {
    status: "BOUGHT",
    sortOrder: 0,
    usageCount: 1,
    addedAt: new Date(now - 5 * DAY_MS),
    boughtAt: new Date(now - 1 * DAY_MS),
  });

  if (milk.created) {
    db.insert(priceObservations)
      .values([
        {
          id: createId(),
          itemId: milk.item.id,
          priceCents: 119,
          shop: "Lidl",
          observedAt: new Date(now - 2 * DAY_MS),
        },
        {
          id: createId(),
          itemId: milk.item.id,
          priceCents: 129,
          shop: "Rewe",
          observedAt: new Date(now - 1 * DAY_MS),
        },
      ])
      .run();
  }
  if (bananas.created) {
    db.insert(priceObservations)
      .values({
        id: createId(),
        itemId: bananas.item.id,
        priceCents: 79,
        shop: "Lidl",
        observedAt: new Date(now - 1 * DAY_MS),
      })
      .run();
  }
  if (bread.created) {
    db.insert(priceObservations)
      .values({
        id: createId(),
        itemId: bread.item.id,
        priceCents: 199,
        shop: "Bakery",
        observedAt: new Date(now - 4 * DAY_MS),
      })
      .run();
  }

  const counts = {
    users: db.select().from(users).all().length,
    lists: db.select().from(groceryLists).all().length,
    categories: db.select().from(categories).all().length,
    items: db.select().from(items).all().length,
    priceObservations: db.select().from(priceObservations).all().length,
  };

  return { adminEmail: admin.email, memberEmail: member.email, listId: list.id, counts };
}

function main(): void {
  const env = seedEnvSchema.parse(process.env);
  const sqlite = createSqlite();
  const db = createDb(sqlite);
  try {
    runMigrations(db);
    const result = seedDatabase(db, env);
    console.log(
      `Seed complete: admin=${result.adminEmail} member=${result.memberEmail} list=${result.listId}`,
    );
    console.log(
      `Counts: users=${result.counts.users} lists=${result.counts.lists} categories=${result.counts.categories} items=${result.counts.items} priceObservations=${result.counts.priceObservations}`,
    );
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
