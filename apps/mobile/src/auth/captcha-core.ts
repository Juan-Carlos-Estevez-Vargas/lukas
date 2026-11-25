/** Ruta de la página del captcha en la web (`public/captcha/turnstile.html`). */
export const CAPTCHA_PATH = "/captcha/turnstile";

/** Nombre del canal por el que la ventana del captcha devuelve el token en la web. */
export const CAPTCHA_CHANNEL = "lukas-turnstile";

export function captchaUrl(base: string, siteKey: string, lang: string): string {
  const query = new URLSearchParams({ sitekey: siteKey, lang });
  return `${base.replace(/\/+$/, "")}${CAPTCHA_PATH}?${query.toString()}`;
}

export type CaptchaMessage =
  | { readonly type: "token"; readonly token: string }
  | { readonly type: "expired" }
  | { readonly type: "error"; readonly code: string };

/** Lee lo que manda la página del captcha; ignora cualquier otra cosa. */
export function parseCaptchaMessage(data: unknown): CaptchaMessage | null {
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.type === "token" && typeof m.token === "string" && /^[\w.:-]{10,4096}$/.test(m.token)) {
    return { type: "token", token: m.token };
  }
  if (m.type === "expired") return { type: "expired" };
  if (m.type === "error") return { type: "error", code: String(m.code ?? "") };
  return null;
}
