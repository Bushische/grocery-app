/**
 * Alice grocery intents (T52): list / add / buy / unbuy on the bound list.
 * Reuses T8/T9 semantics (`smartAddItem` for add, `moveItem` for buy/unbuy —
 * so T48 top-of-bought applies), `textMatching` Dice + LIKE prefilter for
 * buy/unbuy name matching. Unknown names clarify, never move the wrong item.
 */

import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { items } from "../db/schema";
import { listItems, moveItem, smartAddItem, updateItem } from "../services/itemService";
import { getMembership } from "../services/listService";
import { bigrams, diceCoefficient } from "../services/textMatching";
import { type AliceNluInput, isDangerousContext, parseGroceryIntent } from "./nlu";
import {
  ALICE_LIST_OFFSET_KEY,
  ALICE_MAX_TEXT_LENGTH,
  type AliceResponse,
  aliceResponseSchema,
} from "./protocol";
import { ALICE_SPOKEN_LIMIT, formatSpokenList, toTts } from "./tts";

export const ALICE_DANGEROUS_TEXT = "Не понимаю, о чём вы. Пожалуйста, переформулируйте вопрос.";
const ALICE_NO_RIGHTS_TEXT =
  "У вас нет прав менять этот список — попросите владельца дать доступ редактора.";
const ALICE_EMPTY_LIST_TEXT = "В списке пока нечего покупать — всё куплено или пусто.";
const ALICE_UNKNOWN_INTENT_TEXT =
  "Извините, я не поняла. Спросите «помощь», чтобы узнать, что я умею.";

const FUZZY_THRESHOLD = 0.6;

type ItemCandidate = typeof items.$inferSelect;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е");
}

function answer(text: string, sessionState?: Record<string, unknown>): AliceResponse {
  const clipped = text.slice(0, ALICE_MAX_TEXT_LENGTH);
  return aliceResponseSchema.parse({
    response: { text: clipped, tts: toTts(clipped), end_session: false },
    ...(sessionState === undefined ? {} : { session_state: sessionState }),
    version: "1.0",
  });
}

type AliceLocale = "ru" | "en";

function resolveLocale(locale: string | undefined): AliceLocale {
  return locale?.toLowerCase().startsWith("en") === true ? "en" : "ru";
}

const STRINGS = {
  ru: {
    added: "Добавлено.",
    duplicate: "Уже в списке.",
    bought: "Куплено.",
    unbought: "В покупках.",
    allDone: "Это всё.",
    listPrefix: "Нужно купить: ",
    moreSuffix: (rest: number): string => `, ещё ${rest} — скажите «дальше».`,
    continueSuffix: (rest: number): string => `, ещё ${rest} — скажите «дальше».`,
  },
  en: {
    added: "Added.",
    duplicate: "Already on it.",
    bought: "Done.",
    unbought: "Back on the list.",
    allDone: "That's all.",
    listPrefix: "To buy: ",
    moreSuffix: (rest: number): string => `, ${rest} more — say "next".`,
    continueSuffix: (rest: number): string => `, ${rest} more — say "next".`,
  },
} as const;

function offsetState(offset: number): Record<string, unknown> {
  return { [ALICE_LIST_OFFSET_KEY]: offset };
}

/** TO_BUY titles newest-first (`addedAt` DESC; re-activation bumps `addedAt`). */
function newestFirstTitles(db: Db, listId: string): string[] {
  return listItems(db, listId, "TO_BUY")
    .slice()
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || b.sortOrder - a.sortOrder)
    .map((item) => item.title);
}

/**
 * Finds an item by spoken name within one list: exact (case-insensitive) →
 * substring both ways (LIKE) → fuzzy (Dice ≥ 0.6). Ranked usageCount DESC,
 * then shorter title diff, then title — smart-add step 2/3 parity. Returns
 * undefined when nothing matches (caller clarifies instead of moving).
 */
export function findItemBySpokenName(
  db: Db,
  listId: string,
  spokenName: string,
  preferredStatus?: "TO_BUY" | "BOUGHT",
): ItemCandidate | undefined {
  const wanted = normalizeName(spokenName);
  if (wanted === "") return undefined;
  const rows = db.select().from(items).where(eq(items.listId, listId)).all();
  if (rows.length === 0) return undefined;

  const exact = rows.filter((row) => normalizeName(row.title) === wanted);
  if (exact.length > 0) {
    const preferred = exact.find((row) => row.status === preferredStatus);
    return preferred ?? exact.sort((a, b) => b.usageCount - a.usageCount)[0];
  }

  const likeRows = db
    .select()
    .from(items)
    .where(eq(items.listId, listId))
    .all()
    .filter((row) => {
      const title = row.title.toLowerCase();
      const query = spokenName.toLowerCase();
      return title.includes(query) || query.includes(title);
    });
  if (likeRows.length > 0) {
    const ranked = likeRows
      .map((row) => ({ row, diff: Math.abs(row.title.length - spokenName.length) }))
      .sort(
        (a, b) =>
          b.row.usageCount - a.row.usageCount ||
          a.diff - b.diff ||
          a.row.title.localeCompare(b.row.title),
      );
    const preferred = ranked.find((candidate) => candidate.row.status === preferredStatus);
    return (preferred ?? ranked[0])?.row;
  }

  const grams = [...bigrams(spokenName)];
  if (grams.length === 0) return undefined;
  const fuzzy = rows
    .map((row) => ({ row, score: diceCoefficient(spokenName, row.title) }))
    .filter((candidate) => candidate.score >= FUZZY_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.usageCount - a.row.usageCount ||
        a.row.title.localeCompare(b.row.title),
    );
  const preferred = fuzzy.find((candidate) => candidate.row.status === preferredStatus);
  return (preferred ?? fuzzy[0])?.row;
}

export type AliceGroceryInput = {
  command: string | undefined;
  nlu?: AliceNluInput;
  rawRequest?: unknown;
  locale?: string;
  listOffset?: number;
};

/**
 * Routes one bound-list turn to a grocery intent and executes it.
 * `dangerous_context` gets a graceful reply before any intent runs.
 * Pagination offset travels in `session_state[ALICE_LIST_OFFSET_KEY]`;
 * any fresh `list` request or mutation resets it.
 */
export function handleAliceGrocery(
  db: Db,
  userId: string,
  listId: string,
  input: AliceGroceryInput,
): AliceResponse {
  if (isDangerousContext(input.rawRequest)) {
    return answer(ALICE_DANGEROUS_TEXT);
  }
  const locale = resolveLocale(input.locale);
  const offset =
    typeof input.listOffset === "number" && Number.isFinite(input.listOffset)
      ? Math.max(0, Math.floor(input.listOffset))
      : 0;
  const intent = parseGroceryIntent(input.command, input.nlu);
  switch (intent.kind) {
    case "list":
      return handleList(db, listId, locale);
    case "next":
      return handleNext(db, listId, locale, offset);
    case "add":
      return handleAdd(db, userId, listId, intent.name, intent.qtyText, locale);
    case "buy":
      return handleBuy(db, userId, listId, intent.name, locale);
    case "unbuy":
      return handleUnbuy(db, userId, listId, intent.name, locale);
    case "unknown":
      return answer(ALICE_UNKNOWN_INTENT_TEXT);
  }
}

function canEdit(db: Db, listId: string, userId: string): boolean {
  const role = getMembership(db, listId, userId);
  return role === "OWNER" || role === "EDITOR";
}

function handleList(db: Db, listId: string, locale: AliceLocale): AliceResponse {
  const strings = STRINGS[locale];
  const titles = newestFirstTitles(db, listId);
  if (titles.length === 0) {
    return answer(ALICE_EMPTY_LIST_TEXT, offsetState(0));
  }
  const page = titles.slice(0, ALICE_SPOKEN_LIMIT);
  const rest = titles.length - page.length;
  // Keep the legacy capped enumeration helper referenced (cap parity).
  void formatSpokenList(page, titles.length);
  const text =
    rest > 0
      ? `${strings.listPrefix}${page.join(", ")}${strings.moreSuffix(rest)}`
      : `${strings.listPrefix}${page.join(", ")}.`;
  return answer(text, offsetState(page.length));
}

function handleNext(db: Db, listId: string, locale: AliceLocale, offset: number): AliceResponse {
  const strings = STRINGS[locale];
  const titles = newestFirstTitles(db, listId);
  if (titles.length === 0) {
    return answer(ALICE_EMPTY_LIST_TEXT, offsetState(0));
  }
  if (offset >= titles.length) {
    return answer(strings.allDone, offsetState(titles.length));
  }
  const page = titles.slice(offset, offset + ALICE_SPOKEN_LIMIT);
  const consumed = offset + page.length;
  const rest = titles.length - consumed;
  const text =
    rest > 0
      ? `${page.join(", ")}${strings.continueSuffix(rest)}`
      : `${page.join(", ")}. ${strings.allDone}`;
  return answer(text, offsetState(consumed));
}

function handleAdd(
  db: Db,
  userId: string,
  listId: string,
  name: string,
  qtyText: string | undefined,
  locale: AliceLocale,
): AliceResponse {
  if (!canEdit(db, listId, userId)) {
    return answer(ALICE_NO_RIGHTS_TEXT);
  }
  const strings = STRINGS[locale];
  const result = smartAddItem(db, listId, name);
  if (qtyText !== undefined && result.created) {
    updateItem(db, result.item.id, { qtyText });
  }
  if (result.created) {
    return answer(strings.added, offsetState(0));
  }
  return answer(strings.duplicate, offsetState(0));
}

function handleBuy(
  db: Db,
  userId: string,
  listId: string,
  name: string,
  locale: AliceLocale,
): AliceResponse {
  if (!canEdit(db, listId, userId)) {
    return answer(ALICE_NO_RIGHTS_TEXT);
  }
  const strings = STRINGS[locale];
  const matched = findItemBySpokenName(db, listId, name, "TO_BUY");
  if (!matched) {
    return answer(`Не нашла «${name}» в списке покупок. Уточните, что именно отметить купленным?`);
  }
  if (matched.status === "BOUGHT") {
    return answer(strings.bought, offsetState(0));
  }
  moveItem(db, matched.id, "BOUGHT");
  return answer(strings.bought, offsetState(0));
}

function handleUnbuy(
  db: Db,
  userId: string,
  listId: string,
  name: string,
  locale: AliceLocale,
): AliceResponse {
  if (!canEdit(db, listId, userId)) {
    return answer(ALICE_NO_RIGHTS_TEXT);
  }
  const strings = STRINGS[locale];
  const matched = findItemBySpokenName(db, listId, name, "BOUGHT");
  if (!matched) {
    return answer(`Не нашла «${name}» среди купленных. Уточните, что именно вернуть в покупки?`);
  }
  if (matched.status === "TO_BUY") {
    return answer(strings.unbought, offsetState(0));
  }
  moveItem(db, matched.id, "TO_BUY");
  return answer(strings.unbought, offsetState(0));
}
