import { z } from "zod";
import { parseTelegramIntent } from "./botDialog";

/**
 * Action-extraction seam (docs/TELEGRAM_PLAN.md → §7, T66): JEV is a decision
 * model, not a chat LLM — it classifies the ACTION with calibrated
 * confidence but emits no text, so product NAMES always come from the
 * deterministic splitter (`splitItems`). A future chat-LLM extractor
 * (OpenAI-compatible `/chat/completions` + `json_schema`) implements this
 * same interface — switching backends never touches webhook/dialog/services.
 */
export type TelegramAction = "add" | "list" | "buy" | "unbuy" | "unknown";

export type ExtractedAction = { action: TelegramAction; confidence: number };

export interface ActionExtractor {
  extractAction(text: string): Promise<ExtractedAction>;
}

/** Pure deterministic classification (Alice NLU + EN verbs, T63). */
export class DeterministicExtractor implements ActionExtractor {
  async extractAction(text: string): Promise<ExtractedAction> {
    const intent = parseTelegramIntent(text);
    return { action: intent.kind, confidence: intent.kind === "unknown" ? 0 : 1 };
  }
}

const TELEGRAM_ACTIONS = ["add", "list", "buy", "unbuy", "unknown"] as const;

function isTelegramAction(value: string): value is TelegramAction {
  return (TELEGRAM_ACTIONS as readonly string[]).includes(value);
}

const jevAnswerSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().optional(),
  })
  .passthrough();

const jevResponseSchema = z
  .object({
    answers: z.object({ action: jevAnswerSchema }).passthrough(),
  })
  .passthrough();

export type JevFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type JevExtractorOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: JevFetch;
};

const ACTION_QUESTION = {
  type: "choice",
  instructions: "Which grocery action does this chat message request?",
  criteria: {
    add: "Asks to add groceries: buy/add/купи/добавь, or a bare product list (milk, bread / молоко, хлеб).",
    list: "Asks what to buy: what to buy/show list/что купить/список.",
    buy: "Marks items as bought: bought/done/купили/куплено.",
    unbuy: "Returns items to the shopping list: unbuy/верни/снова в покупки.",
    unknown: "Anything else: greetings, chatter, questions, jokes.",
  },
} as const;

/**
 * TypeSafe JEV decision client over plain HTTPS (no SDK, per repo lean-deps
 * rule): one `choice` question per unknown message. ANY failure (network,
 * timeout, non-ok, schema drift, unknown label) degrades to
 * `{ action: "unknown", confidence: 0 }` — the caller clarifies, never 500s.
 */
export class JevExtractor implements ActionExtractor {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: JevFetch;

  constructor(options: JevExtractorOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extractAction(text: string): Promise<ExtractedAction> {
    const unknown = { action: "unknown", confidence: 0 } as const;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          state: { message: text },
          questions: { action: ACTION_QUESTION },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return { ...unknown };
      const parsed = jevResponseSchema.safeParse(await response.json());
      if (!parsed.success) return { ...unknown };
      const answer = parsed.data.answers.action;
      if (!isTelegramAction(answer.choice)) return { ...unknown };
      return { action: answer.choice, confidence: answer.confidence ?? 0 };
    } catch {
      return { ...unknown };
    } finally {
      clearTimeout(timer);
    }
  }
}
