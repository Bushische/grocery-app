/** Alice TTS helpers (T52): `tts` mirrors `text` with `+`-stress marks. */

import { ALICE_MAX_TEXT_LENGTH } from "./protocol";

/** Cap on spoken TO_BUY names (spec: 5–7 + "и ещё N"). */
export const ALICE_SPOKEN_LIMIT = 5;

/** Whole-word stress marks for reply scaffolding (Yandex `+` notation). */
const STRESS_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[^а-яёa-z])нужно(?![а-яёa-z])/giu, "$1н+ужно"],
  [/(^|[^а-яёa-z])купить(?![а-яёa-z])/giu, "$1куп+ить"],
  [/(^|[^а-яёa-z])купили(?![а-яёa-z])/giu, "$1куп+или"],
  [/(^|[^а-яёa-z])добавила(?![а-яёa-z])/giu, "$1доб+авила"],
  [/(^|[^а-яёa-z])вернула(?![а-яёa-z])/giu, "$1верн+ула"],
  [/(^|[^а-яёa-z])списке(?![а-яёa-z])/giu, "$1сп+иске"],
  [/(^|[^а-яёa-z])список(?![а-яёa-z])/giu, "$1сп+исок"],
  [/(^|[^а-яёa-z])покупок(?![а-яёa-z])/giu, "$1пок+упок"],
  [/(^|[^а-яёa-z])покупки(?![а-яёa-z])/giu, "$1пок+упки"],
  [/(^|[^а-яёa-z])ещё(?![а-яёa-z])/giu, "$1ещ+ё"],
  [/(^|[^а-яёa-z])извините(?![а-яёa-z])/giu, "$1извин+ите"],
  [/(^|[^а-яёa-z])поняла(?![а-яёa-z])/giu, "$1понял+а"],
];

const VOWEL_PATTERN = /[аеёиоуыэюя]/iu;

/** Inserts `+` before the stressed (last) vowel of a quoted item name. */
function stressQuotedName(name: string): string {
  if (name.includes("+")) return name;
  const letters = [...name];
  for (let i = letters.length - 1; i >= 0; i--) {
    if (VOWEL_PATTERN.test(letters[i] ?? "")) {
      letters.splice(i, 0, "+");
      return letters.join("");
    }
  }
  return name;
}

function stressQuotedSegments(text: string): string {
  return text.replace(/«([^»]+)»/gu, (_match, inner: string) => `«${stressQuotedName(inner)}»`);
}

/** Mirrors display text into Yandex TTS with `+`-stress on key words. */
export function toTts(text: string): string {
  let out = text;
  for (const [pattern, replacement] of STRESS_WORDS) {
    out = out.replace(pattern, replacement);
  }
  out = stressQuotedSegments(out);
  return out.slice(0, ALICE_MAX_TEXT_LENGTH);
}

/** Renders a capped spoken enumeration: first N names + "и ещё N". */
export function formatSpokenList(names: string[], total: number): string {
  const spoken = names.slice(0, ALICE_SPOKEN_LIMIT);
  const rest = total - spoken.length;
  if (spoken.length === 0) return "";
  if (rest > 0) {
    return `${spoken.join(", ")} и ещё ${rest}`;
  }
  return spoken.join(", ");
}
