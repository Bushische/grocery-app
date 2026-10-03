/**
 * Telegram Mini App bridge (docs/TELEGRAM_PLAN.md → §3): guarded access to
 * `window.Telegram.WebApp`. Everything here is read-only convenience — the
 * security decision (HMAC signature + freshness) happens server-side on every
 * `/auth/telegram/*` call; a missing bridge simply means "plain browser".
 */
export interface TelegramWebApp {
  /** Raw signed query string — the ONLY value the backend trusts (after validation). */
  initData: string;
  ready: () => void;
  expand: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Signed `initData`, or null outside Telegram / when Telegram provides none. */
export function getTelegramInitData(): string | null {
  const initData = getTelegramWebApp()?.initData;
  return initData ? initData : null;
}

/** Tells Telegram the Mini App is ready and asks for full height; no-op in browsers. */
export function notifyTelegramReady(): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;
  try {
    webApp.ready();
  } catch {
    // Older clients may miss methods — the app works without the handshake.
  }
  try {
    webApp.expand();
  } catch {
    // Same as above: never break the app on a bridge quirk.
  }
}
