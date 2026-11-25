/** Errores que la interfaz sabe explicar al usuario. */
export type AuthError =
  | { readonly kind: "invalid" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }
  | { readonly kind: "network" }
  | { readonly kind: "unexpected"; readonly status: number };

export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AuthError };

export interface Me {
  readonly userId: string;
  readonly sessionId: string;
}

export interface AuthClient {
  /** `captchaToken` es el token de Turnstile cuando la API lo exige. */
  sendCode(email: string, captchaToken?: string | null): Promise<AuthResult<void>>;
  /** Devuelve el token bearer de la sesión nueva. */
  verifyCode(email: string, code: string): Promise<AuthResult<string>>;
  me(token: string): Promise<AuthResult<Me | null>>;
  signOut(token: string): Promise<AuthResult<void>>;
  /**
   * Borra la cuenta y todos sus datos del servidor. Con una sesión de más de un día la API responde
   * `invalid`: hay que volver a entrar con el código y repetir.
   */
  deleteAccount(token: string): Promise<AuthResult<void>>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const errorFrom = (res: Response): AuthError => {
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    return {
      kind: "rate_limited",
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
    };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: "invalid" };
  return { kind: "unexpected", status: res.status };
};

/**
 * Cliente de autenticación sobre la API (Better Auth en `/v1/auth`). En el móvil la sesión viaja
 * como `Authorization: Bearer`; el token se guarda cifrado en el dispositivo, nunca en texto plano.
 */
export const createAuthClient = (baseUrl: string, fetchImpl: Fetch = fetch): AuthClient => {
  const call = async (path: string, init: RequestInit): Promise<AuthResult<Response>> => {
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, init);
      return res.ok ? { ok: true, value: res } : { ok: false, error: errorFrom(res) };
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
  };
  const json = (body: unknown, token?: string): RequestInit => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return {
    sendCode: async (email, captchaToken) => {
      const init = json({ email, type: "sign-in" });
      const res = await call("/v1/auth/email-otp/send-verification-otp", {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          ...(captchaToken ? { "x-captcha-response": captchaToken } : {}),
        },
      });
      return res.ok ? { ok: true, value: undefined } : res;
    },
    verifyCode: async (email, code) => {
      const res = await call("/v1/auth/sign-in/email-otp", json({ email, otp: code }));
      if (!res.ok) return res;
      const token = res.value.headers.get("set-auth-token");
      return token
        ? { ok: true, value: token }
        : { ok: false, error: { kind: "unexpected", status: res.value.status } };
    },
    me: async (token) => {
      const res = await call("/v1/me", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) return { ok: true, value: (await res.value.json()) as Me };
      // Una sesión vencida o revocada no es un error: simplemente no hay usuario.
      return res.error.kind === "invalid" ? { ok: true, value: null } : res;
    },
    signOut: async (token) => {
      const res = await call("/v1/auth/sign-out", json({}, token));
      return res.ok ? { ok: true, value: undefined } : res;
    },
    deleteAccount: async (token) => {
      const res = await call("/v1/auth/delete-user", json({}, token));
      return res.ok ? { ok: true, value: undefined } : res;
    },
  };
};

/** Validación local mínima antes de pedir un código; la definitiva la hace la API. */
export const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

export const isSixDigitCode = (value: string): boolean => /^\d{6}$/.test(value);
