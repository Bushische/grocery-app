import { z } from "zod";

/**
 * Minimal Telegram Bot API shapes (docs/TELEGRAM_PLAN.md → §7). Server-only:
 * updates arrive from Telegram, never from our clients, so these schemas live
 * here — NOT in `packages/shared`. Only `message.text` is ever acted on;
 * everything else is acked silently.
 */
const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional().default(false),
});

const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  text: z.string().optional(),
  // Quoted message for `/command`-as-reply (T65): with privacy ON this is how
  // a product list reaches the bot — the reply carries a `/command`, the
  // plain-text list arrives attached here. Never nested further by Telegram.
  reply_to_message: z
    .object({
      from: telegramUserSchema.optional(),
      text: z.string().optional(),
    })
    .optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: telegramMessageSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramChatType = z.infer<typeof telegramChatSchema>["type"];
