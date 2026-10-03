import { findItemBySpokenName } from "../alice/dialog";
import { matchListChoice } from "../alice/links";
import { type GroceryIntent, parseGroceryIntent } from "../alice/nlu";
import type { Db } from "../db/client";
import { listItems, moveItem, smartAddItem, updateItem } from "../services/itemService";
import { getMembership, listListsForUser } from "../services/listService";
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

/** Maps English verbs onto the Russian verbs Alice NLU parses, then delegates. */
export function parseTelegramIntent(rawCommand: string): GroceryIntent {
  const command = normalize(stripEdgePlease(rawCommand));
  if (command === "") return { kind: "unknown" };
  if (isEnglishListCommand(command)) return { kind: "list" };
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
    ? "Команды: /grocery_lists — списки и текущий список чата; /use_list <название> — выбрать список чата. Дальше просто «купи молоко». Ещё: «что купить», «купили молоко», «верни молоко»."
    : 'Commands: /grocery_lists — lists and this chat\'s default; /use_list <name> — set it. Then just "buy milk". Also "what to buy", "bought milk", "unbuy milk".';
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
    const names = accessible
      .map((list) => `${chatDefault?.listId === list.id ? "● " : ""}${quoteName(list.title)}`)
      .join(", ");
    const locked =
      chatDefault && !accessible.some((list) => list.id === chatDefault.listId)
        ? lang === "ru"
          ? ` 🔒 «${chatDefault.title}» — список этого чата, но у вас нет доступа — попросите владельца поделиться.`
          : ` 🔒 "${chatDefault.title}" is this chat's default but you have no access — ask the owner to share it.`
        : "";
    const current =
      chatDefault && accessible.some((list) => list.id === chatDefault.listId)
        ? lang === "ru"
          ? ` Команды без уточнения идут в ● «${chatDefault.title}».`
          : ` Bare commands go to ● "${chatDefault.title}".`
        : "";
    return {
      silent: false,
      text:
        lang === "ru"
          ? `Списки: ${names}.${current} Переключить: /use_list <название>.${locked}`
          : `Lists: ${names}.${current} Switch: /use_list <name>.${locked}`,
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
          ? `Теперь этот чат покупает в «${matched.title}».`
          : `This chat now shops for "${matched.title}".`,
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
    const names = resolution.lists.map((list) => `«${list.title}»`).join(", ");
    const locked =
      resolution.lockedTitle === undefined
        ? ""
        : lang === "ru"
          ? ` 🔒 «${resolution.lockedTitle}» — список этого чата, но у вас нет доступа — попросите владельца поделиться.`
          : ` 🔒 "${resolution.lockedTitle}" is this chat's default but you have no access — ask the owner to share it.`;
    return {
      silent: false,
      text:
        lang === "ru"
          ? `У вас несколько списков: ${names}. Уточните, например: «купи молоко в ${resolution.lists[0]?.title}» или «/use_list ${resolution.lists[0]?.title}».${locked}`
          : `You have several lists: ${names}. Specify one, e.g. "buy milk in ${resolution.lists[0]?.title}" or "/use_list ${resolution.lists[0]?.title}".${locked}`,
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
    if (deps.extractor) {
      const judged = await deps.extractor.extractAction(
        resolution.rest !== "" ? resolution.rest : quote,
      );
      const threshold = deps.confidenceThreshold ?? DEFAULT_JEV_CONFIDENCE_THRESHOLD;
      if (judged.action !== "unknown" && judged.confidence >= threshold) {
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
        } else if (products.trim() !== "") {
          // buy/unbuy: the whole text is the item name — the fuzzy matcher
          // clarifies on miss rather than moving the wrong item.
          return runIntent(
            db,
            userId,
            resolution.listId,
            resolution.title,
            { kind: judged.action, name: products.trim() },
            lang,
          );
        }
      }
    }
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
  return runIntent(db, userId, resolution.listId, resolution.title, intent, lang);
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
    case "list": {
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
      const names = toBuy.slice(0, LIST_CAP).map((item) => item.title);
      const rest = toBuy.length - names.length;
      const more = rest > 0 ? (lang === "ru" ? ` и ещё ${rest}` : ` and ${rest} more`) : "";
      return {
        silent: false,
        text:
          lang === "ru"
            ? `«${title}»: ${names.join(", ")}${more}.`
            : `"${title}": ${names.join(", ")}${more}.`,
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
 * one summary reply.
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
    if (qtyText !== undefined && result.created) {
      updateItem(db, result.item.id, { qtyText });
    }
    (result.created ? added : kept).push(result.item.title);
  }
  const quote = lang === "ru" ? quoteRu : quoteEn;
  if (added.length === 0) {
    return {
      silent: false,
      text:
        lang === "ru"
          ? `${quote(kept)} уже в «${title}».`
          : `${quote(kept)} already on "${title}".`,
    };
  }
  const keptNote =
    kept.length === 0
      ? ""
      : lang === "ru"
        ? ` ${quote(kept)} уже в списке.`
        : ` ${quote(kept)} already on the list.`;
  return {
    silent: false,
    text:
      lang === "ru"
        ? `Добавил ${quote(added)} в «${title}».${keptNote}`
        : `Added ${quote(added)} to "${title}".${keptNote}`,
  };
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
