import { findItemBySpokenName } from "../alice/dialog";
import { matchListChoice } from "../alice/links";
import { type GroceryIntent, parseGroceryIntent } from "../alice/nlu";
import type { Db } from "../db/client";
import { listItems, moveItem, smartAddItem, updateItem } from "../services/itemService";
import { getMembership, listListsForUser } from "../services/listService";

type Lang = "ru" | "en";
type CandidateList = { id: string; title: string };

export type TelegramChatAnswer = { text?: string; silent: boolean };

const LIST_CAP = 7;

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
  | { kind: "resolved"; listId: string; title: string; rest: string }
  | { kind: "need_choice"; lists: CandidateList[] }
  | { kind: "no_lists" };

/**
 * Resolves the target list (docs/TELEGRAM_PLAN.md → §7): a `… в <List>` /
 * `… in <List>` suffix wins, a single accessible list applies silently,
 * several lists without a suffix ask once (stateless — the user repeats with
 * the suffix). Mutations need EDITOR+ (`noRights` reply for VIEWERs); reading
 * works on any accessible list.
 */
export function resolveTelegramList(db: Db, userId: string, command: string): ListResolution {
  const accessible = listListsForUser(db, userId);
  if (accessible.length === 0) return { kind: "no_lists" };
  const suffix = command.match(/^(.*?)\s+(?:в|in)\s+(.+)$/isu);
  if (suffix) {
    const rest = (suffix[1] ?? "").trim();
    const wanted = (suffix[2] ?? "").trim();
    const matchedId = matchListChoice(
      accessible.map((list) => ({ id: list.id, title: list.title })),
      wanted,
    );
    if (matchedId !== undefined && rest !== "") {
      const matched = accessible.find((list) => list.id === matchedId);
      return { kind: "resolved", listId: matchedId, title: matched?.title ?? wanted, rest };
    }
  }
  if (accessible.length === 1) {
    const only = accessible[0];
    if (!only) return { kind: "no_lists" };
    return { kind: "resolved", listId: only.id, title: only.title, rest: command };
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

/**
 * Answers one linked chat turn. Returns `{ silent: true }` for group chatter
 * with no recognizable intent (never spam a group); everything else is text.
 */
export function handleTelegramChat(
  db: Db,
  userId: string,
  rawCommand: string,
  isPrivate: boolean,
): TelegramChatAnswer {
  const lang = langOf(rawCommand);
  const resolution = resolveTelegramList(db, userId, rawCommand.trim());
  if (resolution.kind === "no_lists") {
    return {
      silent: false,
      text:
        lang === "ru"
          ? "Нет доступных списков — создайте список в приложении."
          : "No lists yet — create one in the app.",
    };
  }
  if (resolution.kind === "need_choice") {
    const names = resolution.lists.map((list) => `«${list.title}»`).join(", ");
    return {
      silent: false,
      text:
        lang === "ru"
          ? `У вас несколько списков: ${names}. Уточните, например: «купи молоко в ${resolution.lists[0]?.title}».`
          : `You have several lists: ${names}. Specify one, e.g. "buy milk in ${resolution.lists[0]?.title}".`,
    };
  }
  const intent = parseTelegramIntent(resolution.rest);
  if (intent.kind === "unknown") {
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

function noRights(title: string, lang: Lang): TelegramChatAnswer {
  return {
    silent: false,
    text:
      lang === "ru"
        ? `Нет прав менять «${title}» — нужен доступ редактора.`
        : `You can't edit "${title}" — editor access needed.`,
  };
}
