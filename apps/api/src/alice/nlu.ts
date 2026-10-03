/**
 * Alice NLU helpers (T52): parses `request.command` (+ `nlu.tokens` /
 * `nlu.entities`) into grocery intents on the bound list.
 *
 * `YANDEX.NUMBER` shape verified against the `request-simpleutterance` doc:
 * entities are `{ tokens: { start, end }, type: "YANDEX.NUMBER", value: <number> }`
 * where `value` is a bare JSON number and `tokens` indexes into `nlu.tokens`.
 */

export type AliceNluInput = {
  tokens?: string[];
  entities?: unknown[];
};

export type AliceMarkupInput = {
  dangerous_context?: unknown;
};

export type GroceryIntent =
  | { kind: "list" }
  | { kind: "add"; name: string; qtyText?: string }
  | { kind: "buy"; name: string }
  | { kind: "unbuy"; name: string }
  | { kind: "unknown" };

type NumberEntity = { value: number; start: number; end: number };

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("ё", "е");
}

function stripPunctuation(value: string): string {
  return value.replace(/[.,!?;:…]+$/u, "").trim();
}

/** Extracts `YANDEX.NUMBER` entities (bare-number `value`, token-span indexed). */
export function extractNumberEntities(nlu: AliceNluInput | undefined): NumberEntity[] {
  if (!nlu || !Array.isArray(nlu.entities)) return [];
  const out: NumberEntity[] = [];
  for (const raw of nlu.entities) {
    if (typeof raw !== "object" || raw === null) continue;
    const entity = raw as Record<string, unknown>;
    if (entity.type !== "YANDEX.NUMBER") continue;
    if (typeof entity.value !== "number" || !Number.isFinite(entity.value)) continue;
    const tokens = entity.tokens as { start?: unknown; end?: unknown } | undefined;
    const start = typeof tokens?.start === "number" ? tokens.start : -1;
    const end = typeof tokens?.end === "number" ? tokens.end : -1;
    out.push({ value: entity.value, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

const ADD_VERBS = [
  "добавь",
  "добавьте",
  "добавить",
  "запиши",
  "запишите",
  "записать",
  "внеси",
  "внесите",
  "внести",
];
const BUY_VERBS = [
  "купили",
  "купил",
  "купила",
  "купило",
  "купить",
  "куплено",
  "куплен",
  "куплена",
  "отметь",
  "отметьте",
  "отметить",
];
const UNBUY_MARKERS = ["верни", "верните", "вернуть", "снова", "обратно"];
const FILLER_WORDS = new Set([
  "пожалуйста",
  "в",
  "во",
  "список",
  "списка",
  "покупок",
  "покупки",
  "покупку",
  "как",
  "купленное",
  "купленным",
  "купленный",
  "уже",
]);

function removeLeadingVerb(normalized: string, verbs: string[]): string | undefined {
  for (const verb of verbs) {
    if (normalized === verb) return "";
    if (normalized.startsWith(`${verb} `)) {
      return normalized.slice(verb.length).trim();
    }
  }
  return undefined;
}

function cleanName(raw: string): string {
  const name = stripPunctuation(raw.trim());
  // Drop trailing/leading filler words ("в покупки", "пожалуйста").
  const parts = name.split(/\s+/u).filter(Boolean);
  while (parts.length > 0 && FILLER_WORDS.has(parts[0] ?? "")) parts.shift();
  while (parts.length > 0 && FILLER_WORDS.has(parts[parts.length - 1] ?? "")) parts.pop();
  return parts.join(" ").trim();
}

/**
 * Parses a leading quantity ("2 молока", "2 литра молока") from an add-name.
 * Returns the remaining name plus the qty text (e.g. "2", "2 литра").
 */
function splitLeadingQuantity(raw: string): { name: string; qtyText?: string } {
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/u);
  if (!match) return { name: raw };
  const amount = (match[1] ?? "").replace(",", ".");
  const rest = (match[2] ?? "").trim();
  const restParts = rest.split(/\s+/u);
  if (restParts.length >= 2) {
    const unit = (restParts[0] ?? "").toLowerCase();
    // Common Russian units / packagings: keep "<amount> <unit>" as qty.
    if (
      /^(литр|литра|литров|л|кг|г|грамм|штук|шт|упаковк|пачк|бутылк|банок|банки|банку)/u.test(unit)
    ) {
      return { name: restParts.slice(1).join(" "), qtyText: `${amount} ${restParts[0]}` };
    }
  }
  return { name: rest, qtyText: amount };
}

function parseAddName(
  raw: string,
  nlu: AliceNluInput | undefined,
): { name: string; qtyText?: string } {
  const numbers = extractNumberEntities(nlu);
  const cleaned = cleanName(raw);
  const split = splitLeadingQuantity(cleaned);
  if (split.qtyText !== undefined) return split;
  // Fall back to the YANDEX.NUMBER entity when the normalized command kept
  // the digits (digits-as-numbers normalization): strip the number tokens.
  if (numbers.length > 0 && nlu?.tokens) {
    const first = numbers[0];
    if (first && first.start >= 0 && first.end > first.start) {
      const covered = nlu.tokens
        .slice(first.start, first.end)
        .map((token) => normalize(token))
        .join(" ");
      const without = cleanName(cleaned.replace(covered, " ").replace(/\s+/gu, " "));
      if (without !== "") {
        const valueText = Number.isInteger(first.value) ? String(first.value) : String(first.value);
        return { name: without, qtyText: valueText };
      }
    }
  }
  return { name: cleaned };
}

function parseBuyName(command: string): string | undefined {
  // "купили молоко" / "молоко купили" / "отметь молоко купленным".
  const leading = removeLeadingVerb(command, BUY_VERBS);
  if (leading !== undefined) return cleanName(leading);
  for (const verb of BUY_VERBS) {
    const index = command.indexOf(` ${verb}`);
    if (index > 0) {
      const before = cleanName(command.slice(0, index));
      const after = cleanName(command.slice(index + verb.length + 1));
      const combined = [before, after].filter(Boolean).join(" ").trim();
      if (combined !== "") return combined;
    }
  }
  return undefined;
}

function parseUnbuyName(command: string): string | undefined {
  // "верни молоко" / "молоко снова в покупки" / "молоко обратно в покупки".
  const leading = removeLeadingVerb(command, ["верни", "верните", "вернуть"]);
  if (leading !== undefined) return cleanName(leading);
  for (const marker of [
    "снова в покупки",
    "снова в покупку",
    "обратно в покупки",
    "обратно в покупку",
    "снова",
    "обратно",
  ]) {
    if (command.includes(marker)) {
      const without = cleanName(command.replace(marker, " "));
      if (without !== "") return without;
    }
  }
  return undefined;
}

function isListCommand(command: string): boolean {
  return (
    command.includes("что купить") ||
    command.includes("что куп") ||
    command.includes("что в спис") ||
    command.includes("что нужно") ||
    command.includes("что надо") ||
    command.includes("покажи список") ||
    command.includes("покажи покупки") ||
    command.includes("список покупок") ||
    command.includes("мои покупки") ||
    command === "список" ||
    command === "покупки"
  );
}

/** Parses a normalized `request.command` into a grocery intent. */
export function parseGroceryIntent(
  rawCommand: string | undefined,
  nlu?: AliceNluInput,
): GroceryIntent {
  const command = normalize(stripPunctuation(rawCommand ?? ""));
  if (command === "") return { kind: "unknown" };
  if (isListCommand(command)) return { kind: "list" };

  const isUnbuy = UNBUY_MARKERS.some((marker) => command.includes(marker));
  if (isUnbuy) {
    const name = parseUnbuyName(command);
    if (!name) return { kind: "unknown" };
    return { kind: "unbuy", name };
  }

  const addRemainder = removeLeadingVerb(command, ADD_VERBS);
  if (addRemainder !== undefined) {
    const { name, qtyText } = parseAddName(addRemainder, nlu);
    if (name === "") return { kind: "unknown" };
    return qtyText === undefined ? { kind: "add", name } : { kind: "add", name, qtyText };
  }

  const buyName = parseBuyName(command);
  if (buyName !== undefined) {
    if (buyName === "") return { kind: "unknown" };
    return { kind: "buy", name: buyName };
  }

  return { kind: "unknown" };
}

/** True when Yandex flagged the utterance as dangerous-context (graceful reply). */
export function isDangerousContext(request: unknown): boolean {
  if (typeof request !== "object" || request === null) return false;
  const markup = (request as { markup?: unknown }).markup;
  if (typeof markup !== "object" || markup === null) return false;
  return (markup as { dangerous_context?: unknown }).dangerous_context === true;
}
