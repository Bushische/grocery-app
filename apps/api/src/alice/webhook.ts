import type { AuthUser } from "@grocery/shared";
import type { FastifyInstance } from "fastify";
import { FastifyHttpError } from "../errors";
import { ensureAliceList, matchListChoice, setAliceLink } from "./links";
import {
  ALICE_AWAITING_CHOICE_KEY,
  ALICE_PENDING_COMMAND_KEY,
  type AliceRequest,
  type AliceResponse,
  aliceRequestSchema,
  isLinkCompleteEvent,
  linkCardAnswer,
  supportsAccountLinking,
  textAnswer,
} from "./protocol";
import { resolveAliceUser } from "./requireAlice";

const HELP_COMMANDS = new Set([
  "помощь",
  "help",
  "хелп",
  "что ты умеешь",
  "что ты умеешь делать",
  "?",
]);

const WELCOME_TEXT =
  "Привет! Я помогу с вашим списком покупок: покажу, что нужно купить, добавлю товар или отмечу купленное.";
const WELCOME_LINK_HINT =
  "Чтобы начать, привяжите аккаунт в приложении Яндекса — просто попросите что-нибудь из списка.";
const HELP_TEXT =
  "Я умею показывать список покупок, добавлять товары, отмечать купленное и возвращать товары обратно в покупки. Например: «что купить» или «добавь молоко».";
const FALLBACK_TEXT = "Извините, я не поняла. Спросите «помощь», чтобы узнать, что я умею.";
const LINKED_WELCOME_TEXT =
  "Аккаунт привязан! Теперь я могу работать с вашим списком покупок. Спросите «помощь», чтобы узнать команды.";
const NO_LINKING_SURFACE_TEXT =
  "Этот экран не поддерживает привязку аккаунта. Откройте навык в приложении Яндекса и привяжите аккаунт там.";
const NO_LISTS_TEXT =
  "У вас пока нет ни одного списка покупок. Создайте список в приложении, и я смогу помогать.";

function askChoiceText(titles: string[]): string {
  const quoted = titles.map((title) => `«${title}»`).join(", ");
  return `У вас несколько списков: ${quoted}. Какой список использовать для Алисы? Назовите его название.`;
}

function choiceBoundText(title: string): string {
  return `Хорошо, использую список «${title}». Спросите «помощь», чтобы узнать команды.`;
}

function normalizeCommand(command: string | undefined): string {
  return (command ?? "").trim().toLowerCase();
}

export type AliceWebhookOptions = { skillId: string };

/**
 * `POST /alice/webhook` (externally `/api/alice/webhook` — nginx strips the
 * `/api/` prefix): protocol-1.0 skeleton — `skill_id` check, token→user
 * resolution, welcome/help/fallback router, link gating, pending-request
 * replay, single-list binding. Every request gets an answer, never silence.
 */
export async function aliceWebhookRoutes(
  app: FastifyInstance,
  options: AliceWebhookOptions,
): Promise<void> {
  const db = app.db;
  const { skillId } = options;

  app.post("/alice/webhook", async (request): Promise<AliceResponse> => {
    const body = aliceRequestSchema.parse(request.body);
    if (body.session.skill_id !== skillId) {
      throw new FastifyHttpError(403, "FORBIDDEN", "Unknown skill_id");
    }
    const user = resolveAliceUser(db, {
      authHeader: request.headers.authorization,
      sessionToken: body.session.user?.access_token,
    });

    if (isLinkCompleteEvent(body.request)) {
      return handleLinkComplete(db, body, user);
    }
    if (body.session.new === true) {
      return handleWelcome(db, user);
    }
    const command = normalizeCommand(body.request.command);
    if (HELP_COMMANDS.has(command)) {
      return textAnswer(HELP_TEXT);
    }
    return handlePrivateTurn(db, body, user, body.request.command ?? "");
  });
}

function handleWelcome(db: FastifyInstance["db"], user: AuthUser | null): AliceResponse {
  if (!user) {
    return textAnswer(`${WELCOME_TEXT} ${WELCOME_LINK_HINT}`);
  }
  // Bind silently on the first linked turn when unambiguous; a multi-list
  // choice is deferred to the first private intent (welcome stays public).
  ensureAliceList(db, user.id);
  return textAnswer(WELCOME_TEXT);
}

function handleLinkComplete(
  db: FastifyInstance["db"],
  body: AliceRequest,
  user: AuthUser | null,
): AliceResponse {
  if (!user) {
    return needLink(body, undefined);
  }
  const pending = body.state?.session?.[ALICE_PENDING_COMMAND_KEY];
  if (typeof pending !== "string" || normalizeCommand(pending) === "") {
    return textAnswer(LINKED_WELCOME_TEXT);
  }
  // Answer the saved request immediately so the user does not repeat it.
  if (HELP_COMMANDS.has(normalizeCommand(pending))) {
    return textAnswer(HELP_TEXT);
  }
  return handlePrivateTurn(db, body, user, pending);
}

function handlePrivateTurn(
  db: FastifyInstance["db"],
  body: AliceRequest,
  user: AuthUser | null,
  rawCommand: string,
): AliceResponse {
  if (!user) {
    return needLink(body, rawCommand);
  }
  const awaitingChoice = body.state?.session?.[ALICE_AWAITING_CHOICE_KEY] === true;
  const binding = ensureAliceList(db, user.id);
  if (binding.kind === "no_lists") {
    return textAnswer(NO_LISTS_TEXT);
  }
  if (binding.kind === "need_choice") {
    if (awaitingChoice) {
      const matchedId = matchListChoice(binding.lists, rawCommand);
      if (matchedId !== undefined) {
        const matched = binding.lists.find((list) => list.id === matchedId);
        setAliceLink(db, user.id, matchedId);
        return textAnswer(choiceBoundText(matched?.title ?? ""));
      }
    }
    // Ask once — the answer is carried back via `session_state`.
    return textAnswer(askChoiceText(binding.lists.map((list) => list.title)), {
      [ALICE_AWAITING_CHOICE_KEY]: true,
    });
  }
  // Skeleton router (T52 adds grocery intents on the bound list): the user
  // is resolved and the bound list passed the membership guard above.
  return textAnswer(FALLBACK_TEXT);
}

/**
 * Unlinked (or invalid-token) private intent: the link card alone when the
 * surface supports it — never together with `response` — otherwise a
 * graceful text message, never the card (`auth/make-skill`). The pending
 * utterance is saved to `session_state` for post-link replay.
 */
function needLink(body: AliceRequest, rawCommand: string | undefined): AliceResponse {
  if (!supportsAccountLinking(body)) {
    return textAnswer(NO_LINKING_SURFACE_TEXT);
  }
  const pending = (rawCommand ?? "").trim();
  return linkCardAnswer(pending === "" ? undefined : { [ALICE_PENDING_COMMAND_KEY]: pending });
}
