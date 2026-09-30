import { z } from "zod";

// --- Alice webhook protocol 1.0 (docs/ALICE_PLAN.md → §1) ---
// Refs: `alice/doc/ru/request`, `alice/doc/ru/response`, `auth/make-skill`.
// Schemas validate the boundary (unknown Yandex fields pass through); the
// response schema additionally enforces `start_account_linking`-vs-`response`
// mutual exclusivity (both together is an invalid response).

export const ALICE_PROTOCOL_VERSION = "1.0" as const;

/** Yandex caps `text`/`tts` at 1024 chars each (docs/ALICE_PLAN.md → §1). */
export const ALICE_MAX_TEXT_LENGTH = 1024;

/**
 * Post-link event type: after the user links the account, Yandex sends a
 * request of this type WITHOUT `request.command` (docs/ALICE_PLAN.md → §2.7).
 * Matched case-insensitively; both the CamelCase and snake_case spellings
 * are accepted because the exact wire spelling is unverified offline.
 */
export const ALICE_LINK_COMPLETE_TYPES = [
  "accountlinkingcompleteevent",
  "account_linking_complete_event",
] as const;

/** `session_state` key carrying the utterance saved before the link card. */
export const ALICE_PENDING_COMMAND_KEY = "alice_pending_command";

/** `session_state` flag marking the ask-once list-choice turn. */
export const ALICE_AWAITING_CHOICE_KEY = "alice_awaiting_choice";

const aliceInterfacesSchema = z
  .object({ account_linking: z.object({}).passthrough().optional() })
  .passthrough();

const aliceMetaSchema = z
  .object({
    locale: z.string().optional(),
    timezone: z.string().optional(),
    interfaces: aliceInterfacesSchema.optional(),
  })
  .passthrough();

const aliceSessionUserSchema = z
  .object({ user_id: z.string().optional(), access_token: z.string().optional() })
  .passthrough();

const aliceSessionSchema = z
  .object({
    session_id: z.string().min(1),
    message_id: z.number().optional(),
    skill_id: z.string().min(1),
    application: z.object({ application_id: z.string().optional() }).passthrough().optional(),
    user: aliceSessionUserSchema.optional(),
    new: z.boolean().optional(),
  })
  .passthrough();

const aliceNluSchema = z
  .object({ tokens: z.array(z.string()).optional(), entities: z.array(z.unknown()).optional() })
  .passthrough();

const aliceRequestBodySchema = z
  .object({
    type: z.string().min(1),
    command: z.string().optional(),
    original_utterance: z.string().optional(),
    payload: z.unknown().optional(),
    nlu: aliceNluSchema.optional(),
  })
  .passthrough();

const aliceStateBucketSchema = z.record(z.string(), z.unknown());

export const aliceRequestSchema = z
  .object({
    meta: aliceMetaSchema,
    session: aliceSessionSchema,
    request: aliceRequestBodySchema,
    state: z
      .object({
        session: aliceStateBucketSchema.optional(),
        user: aliceStateBucketSchema.optional(),
        application: aliceStateBucketSchema.optional(),
      })
      .passthrough()
      .optional(),
    version: z.literal(ALICE_PROTOCOL_VERSION),
  })
  .passthrough();

export type AliceRequest = z.infer<typeof aliceRequestSchema>;

const aliceButtonSchema = z.object({
  title: z.string().max(64),
  payload: z.unknown().optional(),
  url: z.string().max(1024).optional(),
  hide: z.boolean().optional(),
});

const aliceResponseBodySchema = z.object({
  text: z.string().min(1).max(ALICE_MAX_TEXT_LENGTH),
  tts: z.string().max(ALICE_MAX_TEXT_LENGTH).optional(),
  buttons: z.array(aliceButtonSchema).optional(),
  end_session: z.boolean(),
});

export const aliceResponseSchema = z
  .object({
    response: aliceResponseBodySchema.optional(),
    start_account_linking: z.object({}).passthrough().optional(),
    session_state: aliceStateBucketSchema.optional(),
    user_state_update: aliceStateBucketSchema.optional(),
    version: z.literal(ALICE_PROTOCOL_VERSION),
  })
  .superRefine((value, ctx) => {
    const hasResponse = value.response !== undefined;
    const hasLinkCard = value.start_account_linking !== undefined;
    if (hasResponse === hasLinkCard) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of response / start_account_linking must be present",
      });
    }
  });

export type AliceResponse = z.infer<typeof aliceResponseSchema>;

/** True when the request is the post-link event (no `command` expected). */
export function isLinkCompleteEvent(request: Pick<AliceRequest["request"], "type">): boolean {
  const normalized = request.type.toLowerCase().replaceAll("_", "");
  return (ALICE_LINK_COMPLETE_TYPES as readonly string[]).some(
    (known) => known.replaceAll("_", "") === normalized,
  );
}

/** True when the surface supports the link card (`auth/make-skill`). */
export function supportsAccountLinking(request: AliceRequest): boolean {
  return request.meta.interfaces?.account_linking !== undefined;
}

/** Builds a spoken-text answer (`tts` mirrors `text`; T52 adds stress marks). */
export function textAnswer(text: string, sessionState?: Record<string, unknown>): AliceResponse {
  const clipped = text.slice(0, ALICE_MAX_TEXT_LENGTH);
  return aliceResponseSchema.parse({
    response: { text: clipped, tts: clipped, end_session: false },
    ...(sessionState === undefined ? {} : { session_state: sessionState }),
    version: ALICE_PROTOCOL_VERSION,
  });
}

/**
 * Builds the link card. It is sent ALONE — never together with `response`
 * (both together is an invalid response; `auth/make-skill`).
 */
export function linkCardAnswer(sessionState?: Record<string, unknown>): AliceResponse {
  return aliceResponseSchema.parse({
    start_account_linking: {},
    ...(sessionState === undefined ? {} : { session_state: sessionState }),
    version: ALICE_PROTOCOL_VERSION,
  });
}
