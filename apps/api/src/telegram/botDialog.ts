import { findItemBySpokenName } from "../alice/dialog";
import { matchListChoice } from "../alice/links";
import { type GroceryIntent, parseGroceryIntent } from "../alice/nlu";
import type { Db } from "../db/client";
import { createItem, listItems, moveItem, smartAddItem, updateItem } from "../services/itemService";
import { getMembership, listListsForUser } from "../services/listService";
import { diceCoefficient } from "../services/textMatching";
import type { ListChoice } from "./botApi";
import { getChatDefaultWithTitle, setChatDefault } from "./chatDefaults";
import type { ActionExtractor } from "./extract";

/** Confidence floor for acting on a JEV verdict (T66); below it we clarify. */
export const DEFAULT_JEV_CONFIDENCE_THRESHOLD = 0.6;

export type TelegramDialogDeps = {
  extractor?: ActionExtractor;
  confidenceThreshold?: number;
};

type Lang = "ru" | "en";
type CandidateList = { id: string; title: string };

export type TelegramChatAnswer = {
  text?: string;
  silent: boolean;
  /** Tap-to-select lists (T70) — the webhook renders them as inline buttons. */
  choices?: ListChoice[];
};

const LIST_CAP = 7;

/** Max products added from one message (T65) — reply-lists stay bounded. */
export const MAX_CHAT_ITEMS = 20;

function quoteRu(names: string[]): string {
  return names.map((name) => `«${name}»`).join(", ");
}

function quoteEn(names: string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

/**
 * Splits unstructured product text into fragments (T65): lines first, then
 * `;`, then `,` (covers "milk, bread" and pasted multi-line lists), then
 * `and/и` ("milk and bread"). Leading bullets/dashes are stripped.
 */
export function splitItems(raw: string): string[] {
  return raw
    .split(/[\n;]+/u)
    .flatMap((line) => line.split(/,/u))
    .flatMap((part) => part.split(/\s+(?:and|и)\s+/iu))
    .map((part) => part.trim().replace(/^[•\-*]\s+/u, ""))
    .filter((part) => part !== "")
    .slice(0, MAX_CHAT_ITEMS);
}

/** Leading-quantity strip per fragment ("2 milk" → milk + qty "2"). */
function splitLeadingDigits(raw: string): { name: string; qtyText?: string } {
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if (!match) return { name: raw };
  const amount = (match[1] ?? "").replace(",", ".");
  const rest = (match[2] ?? "").trim();
  if (rest === "") return { name: raw };
  return { name: rest, qtyText: amount };
}

function langOf(text: string): Lang {
  return /[а-яё]/iu.test(text) ? "ru" : "en";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е");
}

function stripEdgePlease(value: string): string {
  return value
    .replace(/^(please\s+)+/iu, "")
    .replace(/(\s+please)+$/iu, "")
    .trim();
}

/**
 * A polite-need prefix (T82): one generic rule instead of per-phrase keywords
 * ("need to buy", "надо купить", "хочу …", "I need …"). Strips an optional
 * courtesy/pronoun head, a modal word, and an infinitive — the remainder is
 * the products ("надо купить: яблоки, хлеб" → "яблоки, хлеб"); nothing left
 * means a readout request ("надо купить" → list).
 */
const MODAL_HEAD =
  /^(?:пожалуйста,?\s+|please\s+)?(?:(?:я|мне|нам|i|we)\s+)?(?:надо|нужно|необходимо|хочу|хочется|не\s+забудь(?:те)?|need(?:\s+to)?|want(?:\s+to)?|wanna|gotta|going\s+to|don't\s+forget|remember\s+to)\s+(.*)$/su;
const INFINITIVE_HEAD =
  /^(?:купить|покупать|buy(?:\s+to)?|to\s+buy|добавить|add|взять|take|bring(?:\s+along)?)\s*:?\s*(.*)$/su;

/** Maps English verbs onto the Russian verbs Alice NLU parses, then delegates. */
export function parseTelegramIntent(rawCommand: string): GroceryIntent {
  const command = normalize(stripEdgePlease(rawCommand));
  if (command === "") return { kind: "unknown" };
  if (isEnglishListCommand(command)) return { kind: "list" };
  const modal = command.match(MODAL_HEAD);
  if (modal) {
    const withoutModal = (modal[1] ?? "").trim();
    const infinitive = withoutModal.match(INFINITIVE_HEAD);
    const products = infinitive ? (infinitive[1] ?? "").trim() : withoutModal;
    if (products === "") return { kind: "list" };
    return parseGroceryIntent(`добавь ${products}`);
  }
  return parseGroceryIntent(mapChatVerbs(command));
}

function isEnglishListCommand(command: string): boolean {
  return (
    command.includes("what to buy") ||
    command.includes("what is on the list") ||
    command.includes("what's on the list") ||
    command.includes("whats on the list") ||
    command.includes("show list") ||
    command.includes("shopping list") ||
    command === "list"
  );
}

/**
 * Maps chat verbs onto the Russian verbs Alice NLU parses, then delegates —
 * one matching engine for voice and chat. English: `buy/add→добавь`,
 * `bought/done→купили`, `unbuy/return→верни`. Russian chat imperative
 * `купи/купите→добавь` ("купи молоко" adds; only `купили` marks bought).
 */
function mapChatVerbs(command: string): string {
  const add = command.match(/^(buy|add)\b\s*(.*)$/u);
  if (add) return `добавь ${(add[2] ?? "").trim()}`.trim();
  const unbuy = command.match(/^(unbuy|return)\b\s*(.*)$/u);
  if (unbuy) return `верни ${(unbuy[2] ?? "").trim()}`.trim();
  // Note: `\b` is ASCII-only in JS and never matches after Cyrillic, so the
  // Russian verbs use a whitespace/end lookahead instead.
  const buyImperative = command.match(/^(купи|купите)(?=\s|$)\s*(.*)$/u);
  if (buyImperative) return `добавь ${(buyImperative[2] ?? "").trim()}`.trim();
  return command
    .replace(/\b(bought|done)\b/gu, "купили")
    .replace(/\bback to (the )?(shopping list|list)\b/gu, "снова в покупки");
}

type ListResolution =
  | {
      kind: "resolved";
      listId: string;
      title: string;
      rest: string;
      via: "suffix" | "default" | "single";
    }
  | { kind: "need_choice"; lists: CandidateList[]; lockedTitle?: string }
  | { kind: "no_lists" };

/**
 * Resolves the target list (docs/TELEGRAM_PLAN.md → §7): a `… в <List>` /
 * `… in <List>` suffix wins (and is remembered as the chat default), then
 * the chat's shared default (one per chat_id, last writer wins), then a
 * single accessible list silently. Several lists with no default ask once
 * (`/use <name>` or a tap — T69/T70 — answers without retyping the suffix).
 * Titles are NOT secret (shown unfiltered, 🔒-marked when the caller lacks
 * access); mutations still need EDITOR+ (`noRights` reply for VIEWERs and
 * outsiders), reading works on any accessible list.
 */
export function resolveTelegramList(
  db: Db,
  userId: string,
  chatId: string,
  command: string,
): ListResolution {
  const accessible = listListsForUser(db, userId);
  if (accessible.length === 0) return { kind: "no_lists" };
  const byTitle = (wanted: string): Extract<ListResolution, { kind: "resolved" }> | undefined => {
    const matchedId = matchListChoice(
      accessible.map((list) => ({ id: list.id, title: list.title })),
      wanted,
    );
    if (matchedId === undefined) return undefined;
    const matched = accessible.find((list) => list.id === matchedId);
    return {
      kind: "resolved",
      listId: matchedId,
      title: matched?.title ?? wanted,
      rest: "",
      via: "suffix",
    };
  };
  // A list hint without products (a bare "/buy in Second" reply) still
  // resolves the list — the products come from the quoted message.
  const hintOnly = command.match(/^(?:в|in)\s+(.+)$/isu);
  if (hintOnly && (hintOnly[1] ?? "").trim() !== "") {
    const hinted = byTitle((hintOnly[1] ?? "").trim());
    if (hinted) return { ...hinted, rest: "" };
  }
  const suffix = command.match(/^(.*?)\s+(?:в|in)\s+(.+)$/isu);
  if (suffix) {
    const rest = (suffix[1] ?? "").trim();
    const wanted = (suffix[2] ?? "").trim();
    const hinted = wanted !== "" ? byTitle(wanted) : undefined;
    // An empty rest (a bare "/buy in Second" reply) still resolves the list —
    // the products come from the quoted message (answerForProducts).
    if (hinted) return { ...hinted, rest };
  }
  const chatDefault = getChatDefaultWithTitle(db, chatId);
  if (chatDefault) {
    const mine = accessible.find((list) => list.id === chatDefault.listId);
    if (mine) {
      return {
        kind: "resolved",
        listId: mine.id,
        title: mine.title,
        rest: command,
        via: "default",
      };
    }
    // The chat remembers a list this caller cannot access: show it marked
    // (titles are not secret) instead of hiding it or leaking its items.
    return {
      kind: "need_choice",
      lists: accessible.map((list) => ({ id: list.id, title: list.title })),
      lockedTitle: chatDefault.title,
    };
  }
  if (accessible.length === 1) {
    const only = accessible[0];
    if (!only) return { kind: "no_lists" };
    return { kind: "resolved", listId: only.id, title: only.title, rest: command, via: "single" };
  }
  return {
    kind: "need_choice",
    lists: accessible.map((list) => ({ id: list.id, title: list.title })),
  };
}

function canEdit(db: Db, listId: string, userId: string): boolean {
  const role = getMembership(db, listId, userId);
  return role === "OWNER" || role === "EDITOR";
}

function noListsText(lang: Lang): string {
  return lang === "ru"
    ? "Нет доступных списков — создайте список в приложении."
    : "No lists yet — create one in the app.";
}

function helpText(lang: Lang): string {
  return lang === "ru"
    ? "Команды:\n• /grocery_lists — списки и текущий список чата\n• /use_list <название> — выбрать список чата\n• «купи молоко» — добавить\n• «что купить» — показать покупки\n• «купили молоко» — отметить купленным\n• «верни молоко» — вернуть в покупки"
    : 'Commands:\n• /grocery_lists — lists and this chat\'s default\n• /use_list <name> — set it\n• "buy milk" — add\n• "what to buy" — show\n• "bought milk" — mark bought\n• "unbuy milk" — return';
}

/**
 * Explicit chat commands (T69/T73, slash already stripped by the webhook):
 * `/grocery_lists` (alias `/lists`) shows the caller's lists with the chat
 * default marked (●, or 🔒 when the caller cannot access it — titles are not
 * secret), `/use_list <name>` (alias `/use`) stores the shared default
 * (membership required, last writer wins; quoted products are NOT consumed —
 * resend the items after switching), `/help`+`/start` explain. Returns
 * undefined for non-commands so the grocery pipeline runs. `/help` is
 * private-only (groups stay silent); `/grocery_lists`+`/use_list` answer
 * wherever they were addressed.
 */
function answerChatCommand(
  db: Db,
  userId: string,
  chatId: string,
  trimmed: string,
  lang: Lang,
  isPrivate: boolean,
): TelegramChatAnswer | undefined {
  // The webhook strips a leading /command (extractCommandText), but tolerate
  // a surviving slash so direct calls and pasted commands behave the same.
  const normalized = normalize(trimmed).replace(/^\/+/, "");
  if (
    normalized === "help" ||
    normalized === "start" ||
    normalized === "помощь" ||
    normalized === "старт"
  ) {
    if (!isPrivate) return undefined;
    return { silent: false, text: helpText(lang) };
  }
  if (normalized === "lists" || normalized === "grocery_lists" || normalized === "списки") {
    const accessible = listListsForUser(db, userId);
    if (accessible.length === 0) return { silent: false, text: noListsText(lang) };
    const chatDefault = getChatDefaultWithTitle(db, chatId);
    const quoteName = (title: string): string => (lang === "ru" ? `«${title}»` : `"${title}"`);
    const bullets = accessible
      .map((list) => `• ${chatDefault?.listId === list.id ? "● " : ""}${quoteName(list.title)}`)
      .join("\n");
    const locked =
      chatDefault && !accessible.some((list) => list.id === chatDefault.listId)
        ? lang === "ru"
          ? `\n🔒 «${chatDefault.title}» — список этого чата, но у вас нет доступа — попросите владельца поделиться.`
          : `\n🔒 "${chatDefault.title}" is this chat's default but you have no access — ask the owner to share it.`
        : "";
    const current =
      chatDefault && accessible.some((list) => list.id === chatDefault.listId)
        ? lang === "ru"
          ? `\nКоманды без уточнения идут в ● «${chatDefault.title}».`
          : `\nBare commands go to ● "${chatDefault.title}".`
        : "";
    const switchLine =
      lang === "ru" ? "\nПереключить: /use_list <название>." : "\nSwitch: /use_list <name>.";
    return {
      silent: false,
      text:
        lang === "ru"
          ? `Списки:\n${bullets}${current}${switchLine}${locked}`
          : `Lists:\n${bullets}${current}${switchLine}${locked}`,
      choices: accessible.map((list) => ({ listId: list.id, title: list.title })),
    };
  }
  const useMatch = normalized.match(/^(use_list|use|используй|выбери)\s+(.+)$/su);
  if (useMatch) {
    const displayName = trimmed.slice(trimmed.search(/\s/u)).trim() || (useMatch[2] ?? "").trim();
    const accessible = listListsForUser(db, userId);
    const matchedId = matchListChoice(
      accessible.map((list) => ({ id: list.id, title: list.title })),
      (useMatch[2] ?? "").trim(),
    );
    const matched = accessible.find((list) => list.id === matchedId);
    if (!matched) {
      return {
        silent: false,
        text:
          lang === "ru"
            ? `Не нашёл «${displayName}» среди ваших списков. Покажите их: /grocery_lists.`
            : `Couldn't find "${displayName}" among your lists. Show them: /grocery_lists.`,
      };
    }
    setChatDefault(db, chatId, matched.id, userId);
    return {
      silent: false,
      text:
        lang === "ru"
          ? `Теперь этот чат покупает в:\n• ● «${matched.title}»`
          : `This chat now shops for:\n• ● "${matched.title}"`,
    };
  }
  return undefined;
}

/**
 * Answers one linked chat turn. `quoted` is the `reply_to_message` text for
 * `/command`-as-reply (T65): the command carries the list hint
 * (`/buy in Home`), the quote carries the products.
 * Returns `{ silent: true }` for group chatter with no recognizable intent
 * (never spam a group); everything else is text.
 */
export async function handleTelegramChat(
  db: Db,
  userId: string,
  chatId: string,
  rawCommand: string,
  isPrivate: boolean,
  quoted = "",
  deps: TelegramDialogDeps = {},
): Promise<TelegramChatAnswer> {
  const quote = quoted.trim();
  const trimmed = rawCommand.trim();
  const lang = langOf(trimmed !== "" ? trimmed : quote);
  // Explicit chat commands (T69): only when the text was typed, never when it
  // fell back to the quote (a quoted "lists" is products, not a command).
  // /lists + /use answer in groups too (addressed delivery is enforced by the
  // webhook); /help stays private-only like any other unknown text.
  if (trimmed !== "" && trimmed !== quote) {
    const commanded = answerChatCommand(db, userId, chatId, trimmed, lang, isPrivate);
    if (commanded) return commanded;
  }
  const resolution = resolveTelegramList(db, userId, chatId, trimmed || quote);
  if (resolution.kind === "no_lists") {
    return { silent: false, text: noListsText(lang) };
  }
  if (resolution.kind === "need_choice") {
    const bullets = resolution.lists.map((list) => `• «${list.title}»`).join("\n");
    const bulletsEn = resolution.lists.map((list) => `• "${list.title}"`).join("\n");
    const locked =
      resolution.lockedTitle === undefined
        ? ""
        : lang === "ru"
          ? `\n🔒 «${resolution.lockedTitle}» — список этого чата, но у вас нет доступа — попросите владельца поделиться.`
          : `\n🔒 "${resolution.lockedTitle}" is this chat's default but you have no access — ask the owner to share it.`;
    return {
      silent: false,
      text:
        lang === "ru"
          ? `У вас несколько списков:\n${bullets}\nУточните, например: «купи молоко в ${resolution.lists[0]?.title}» или «/use_list ${resolution.lists[0]?.title}».${locked}`
          : `You have several lists:\n${bulletsEn}\nSpecify one, e.g. "buy milk in ${resolution.lists[0]?.title}" or "/use_list ${resolution.lists[0]?.title}".${locked}`,
      choices: resolution.lists.map((list) => ({ listId: list.id, title: list.title })),
    };
  }
  // An explicit suffix doubles as the chat's new shared default (last writer
  // wins) — the next bare command lands without asking.
  if (resolution.via === "suffix") {
    setChatDefault(db, chatId, resolution.listId, userId);
  }
  const intent = parseTelegramIntent(resolution.rest);
  if (intent.kind === "unknown") {
    // Last resort before clarifying (T66): a configured extractor (JEV)
    // judges the message; below-threshold or failed verdicts fall through
    // to the quote/fragment/clarify handling below.
    const judged = await applyJudgedAction(
      db,
      userId,
      resolution,
      quote,
      lang,
      deps.extractor,
      deps.confidenceThreshold,
    );
    if (judged) return judged;
    // No products in the command itself: fall back to the quoted message
    // (T65 — reply-`/buy`, or a list-hint-only `/buy in Home` reply).
    if (quote !== "") {
      return answerForProducts(db, userId, resolution, quote, lang, isPrivate);
    }
    // Bare product text (T65): verb-less "milk, bread" — with 2+ fragments
    // the intent is clearly "add these".
    const fragments = splitItems(resolution.rest);
    if (fragments.length >= 2) {
      return handleAddMany(db, userId, resolution.listId, resolution.title, fragments, lang);
    }
    if (!isPrivate) return { silent: true };
    return {
      silent: false,
      text:
        lang === "ru"
          ? "Не понял. Примеры: «купи молоко», «что купить», «купили молоко»."
          : 'Didn\'t get that. Try "buy milk", "what to buy", "bought milk".',
    };
  }
  // A mid-sentence buy/unbuy verb is a shaky parse (T82: "надо купить X" reads
  // as mark-bought) — a confident JEV verdict overrides it, otherwise the
  // deterministic intent stands. Without an extractor this never triggers.
  if (deps.extractor && isWeakBuyUnbuy(resolution.rest, intent)) {
    const judged = await applyJudgedAction(
      db,
      userId,
      resolution,
      quote,
      lang,
      deps.extractor,
      deps.confidenceThreshold,
    );
    if (judged) return judged;
  }
  return runIntent(db, userId, resolution.listId, resolution.title, intent, lang);
}

/** Leading buy/unbuy verbs (firm parses); infinitive купить is excluded. */
const LEADING_BUY_UNBUY =
  /^(купили|купил|купила|купило|куплено|куплен|куплена|отметь|отметьте|отметить|верни|верните|вернуть|bought|done|unbuy|return)(?=\s|$)/u;

/**
 * True for buy/unbuy intents parsed off a mid-sentence verb ("вчера купили
 * молоко", "надо купить X") — worth a JEV second opinion when configured.
 */
function isWeakBuyUnbuy(rawCommand: string, intent: GroceryIntent): boolean {
  if (intent.kind !== "buy" && intent.kind !== "unbuy") return false;
  return !LEADING_BUY_UNBUY.test(normalize(rawCommand));
}

/**
 * Asks the extractor (JEV) to judge an already-resolved turn. Returns an
 * answer when a confident verdict applies, undefined to fall through to the
 * caller's deterministic handling (quote/fragments/clarify, or the shaky
 * intent itself).
 */
async function applyJudgedAction(
  db: Db,
  userId: string,
  resolution: Extract<ListResolution, { kind: "resolved" }>,
  quote: string,
  lang: Lang,
  extractor: ActionExtractor | undefined,
  confidenceThreshold: number | undefined,
): Promise<TelegramChatAnswer | undefined> {
  if (!extractor) return undefined;
  const judged = await extractor.extractAction(resolution.rest !== "" ? resolution.rest : quote);
  const threshold = confidenceThreshold ?? DEFAULT_JEV_CONFIDENCE_THRESHOLD;
  if (judged.action === "unknown" || judged.confidence < threshold) return undefined;
  const products = quote !== "" ? quote : resolution.rest;
  if (judged.action === "list") {
    return runIntent(db, userId, resolution.listId, resolution.title, { kind: "list" }, lang);
  }
  if (judged.action === "add") {
    const fragments = splitItems(products);
    if (fragments.length >= 2) {
      return handleAddMany(db, userId, resolution.listId, resolution.title, fragments, lang);
    }
    if (fragments.length === 1 && fragments[0] !== undefined) {
      return runIntent(
        db,
        userId,
        resolution.listId,
        resolution.title,
        { kind: "add", name: fragments[0] },
        lang,
      );
    }
    return undefined;
  }
  if (products.trim() === "") return undefined;
  // buy/unbuy: the whole text is the item name — the fuzzy matcher
  // clarifies on miss rather than moving the wrong item.
  return runIntent(
    db,
    userId,
    resolution.listId,
    resolution.title,
    {
      kind: judged.action,
      name: products.trim(),
    },
    lang,
  );
}

/**
 * Answers from quoted product text on an already-resolved list: full intent
 * parsing first (a quoted "bought milk" works too), then the 2+-fragment
 * add rule, then clarify/silence.
 */
function answerForProducts(
  db: Db,
  userId: string,
  resolution: Extract<ListResolution, { kind: "resolved" }>,
  products: string,
  lang: Lang,
  isPrivate: boolean,
): TelegramChatAnswer {
  const intent = parseTelegramIntent(products);
  if (intent.kind !== "unknown") {
    return runIntent(db, userId, resolution.listId, resolution.title, intent, lang);
  }
  const fragments = splitItems(products);
  if (fragments.length >= 2) {
    return handleAddMany(db, userId, resolution.listId, resolution.title, fragments, lang);
  }
  if (fragments.length === 1 && fragments[0] !== undefined) {
    return runIntent(
      db,
      userId,
      resolution.listId,
      resolution.title,
      { kind: "add", name: fragments[0] },
      lang,
    );
  }
  if (!isPrivate) return { silent: true };
  return {
    silent: false,
    text:
      lang === "ru"
        ? "Не понял. Примеры: «купи молоко», «что купить», «купили молоко»."
        : 'Didn\'t get that. Try "buy milk", "what to buy", "bought milk".',
  };
}

function runIntent(
  db: Db,
  userId: string,
  listId: string,
  title: string,
  intent: GroceryIntent,
  lang: Lang,
): TelegramChatAnswer {
  switch (intent.kind) {
    case "list":
    case "next": {
      const toBuy = listItems(db, listId, "TO_BUY");
      if (toBuy.length === 0) {
        return {
          silent: false,
          text:
            lang === "ru"
              ? `В «${title}» пока нечего покупать.`
              : `"${title}" has nothing to buy yet.`,
        };
      }
      const names = toBuy
        .slice(0, LIST_CAP)
        .map((item) => `• ${item.title}`)
        .join("\n");
      const rest = toBuy.length - Math.min(toBuy.length, LIST_CAP);
      const more = rest > 0 ? (lang === "ru" ? `\nи ещё ${rest}` : `\nand ${rest} more`) : "";
      return {
        silent: false,
        text: lang === "ru" ? `«${title}»:\n${names}${more}` : `"${title}":\n${names}${more}`,
      };
    }
    case "add": {
      if (!canEdit(db, listId, userId)) return noRights(title, lang);
      const fragments = splitItems(intent.name);
      if (fragments.length > 1) {
        return handleAddMany(db, userId, listId, title, fragments, lang);
      }
      const result = smartAddItem(db, listId, intent.name);
      if (intent.qtyText !== undefined && result.created) {
        updateItem(db, result.item.id, { qtyText: intent.qtyText });
      }
      return {
        silent: false,
        text: result.created
          ? lang === "ru"
            ? `Добавил «${result.item.title}» в «${title}».`
            : `Added "${result.item.title}" to "${title}".`
          : lang === "ru"
            ? `«${result.item.title}» уже в «${title}».`
            : `"${result.item.title}" is already on "${title}".`,
      };
    }
    case "buy": {
      if (!canEdit(db, listId, userId)) return noRights(title, lang);
      const matched = findItemBySpokenName(db, listId, intent.name, "TO_BUY");
      if (!matched) {
        return {
          silent: false,
          text:
            lang === "ru"
              ? `Не нашёл «${intent.name}» в «${title}». Что именно отметить?`
              : `Couldn't find "${intent.name}" on "${title}". What exactly?`,
        };
      }
      if (matched.status === "BOUGHT") {
        return {
          silent: false,
          text:
            lang === "ru"
              ? `«${matched.title}» уже куплено.`
              : `"${matched.title}" is already bought.`,
        };
      }
      const moved = moveItem(db, matched.id, "BOUGHT");
      return {
        silent: false,
        text:
          lang === "ru"
            ? `Отметил «${moved.title}» купленным.`
            : `Marked "${moved.title}" as bought.`,
      };
    }
    case "unbuy": {
      if (!canEdit(db, listId, userId)) return noRights(title, lang);
      const matched = findItemBySpokenName(db, listId, intent.name, "BOUGHT");
      if (!matched) {
        return {
          silent: false,
          text:
            lang === "ru"
              ? `Не нашёл «${intent.name}» среди купленных в «${title}».`
              : `Couldn't find "${intent.name}" among bought on "${title}".`,
        };
      }
      if (matched.status === "TO_BUY") {
        return {
          silent: false,
          text:
            lang === "ru"
              ? `«${matched.title}» уже в покупках.`
              : `"${matched.title}" is already on the list.`,
        };
      }
      const moved = moveItem(db, matched.id, "TO_BUY");
      return {
        silent: false,
        text:
          lang === "ru"
            ? `Вернул «${moved.title}» в покупки.`
            : `Moved "${moved.title}" back to buy.`,
      };
    }
    case "unknown": {
      return { silent: true };
    }
  }
}

/**
 * Adds several products at once (T65): each fragment through `smartAddItem`
 * (re-activation semantics kept), per-fragment leading quantities applied,
 * one summary reply. T78/T89: a comma-separated chat list is deliberate —
 * only close matches dedup (`exact`, plural-fold equality, Dice ≥ 0.85);
 * anything else force-creates ("item1, item2, item3" yields three rows while
 * "oranges" still finds `Orange`).
 */
function handleAddMany(
  db: Db,
  userId: string,
  listId: string,
  title: string,
  fragments: string[],
  lang: Lang,
): TelegramChatAnswer {
  if (!canEdit(db, listId, userId)) return noRights(title, lang);
  const added: string[] = [];
  const kept: string[] = [];
  for (const fragment of fragments) {
    const { name, qtyText } = splitLeadingDigits(fragment);
    if (name === "") continue;
    const result = smartAddItem(db, listId, name);
    if (result.created || result.matchedBy === "exact") {
      if (qtyText !== undefined && result.created) {
        updateItem(db, result.item.id, { qtyText });
      }
      (result.created ? added : kept).push(result.item.title);
      continue;
    }
    // Near-miss on a deliberate list: keep only plural/typo variants of the
    // matched title, create genuinely different fragments (T89).
    if (
      pluralFold(normalize(name)) === pluralFold(normalize(result.item.title)) ||
      diceCoefficient(name, result.item.title) >= CHAT_KEEP_THRESHOLD
    ) {
      kept.push(result.item.title);
      continue;
    }
    const created = createItem(db, listId, { title: name });
    if (qtyText !== undefined) {
      updateItem(db, created.id, { qtyText });
    }
    added.push(created.title);
  }
  const bullet = (name: string): string =>
    lang === "ru" ? `• ${quoteRu([name])}` : `• ${quoteEn([name])}`;
  if (added.length === 0) {
    return {
      silent: false,
      text:
        lang === "ru"
          ? `Уже в «${title}»:\n${kept.map(bullet).join("\n")}`
          : `Already on "${title}":\n${kept.map(bullet).join("\n")}`,
    };
  }
  const keptNote =
    kept.length === 0
      ? ""
      : lang === "ru"
        ? `\nУже в списке:\n${kept.map(bullet).join("\n")}`
        : `\nAlready on the list:\n${kept.map(bullet).join("\n")}`;
  return {
    silent: false,
    text:
      lang === "ru"
        ? `Добавил в «${title}»:\n${added.map(bullet).join("\n")}${keptNote}`
        : `Added to "${title}":\n${added.map(bullet).join("\n")}${keptNote}`,
  };
}

/** Chat multi-add merge bar (T89): below it, fragments are distinct items. */
const CHAT_KEEP_THRESHOLD = 0.85;

/**
 * Naive English plural fold for chat dedup, applied to both sides
 * ("oranges"→"orange", "berries"→"berry"); consistent by construction.
 */
function pluralFold(value: string): string {
  const folded = value.endsWith("ies")
    ? `${value.slice(0, -3)}y`
    : value.endsWith("es")
      ? value.slice(0, -2)
      : value.endsWith("s")
        ? value.slice(0, -1)
        : value;
  return folded === "" ? value : folded;
}

function noRights(title: string, lang: Lang): TelegramChatAnswer {
  return {
    silent: false,
    text:
      lang === "ru"
        ? `Нет прав менять «${title}» — нужен доступ редактора.`
        : `You can't edit "${title}" — editor access needed.`,
  };
}
