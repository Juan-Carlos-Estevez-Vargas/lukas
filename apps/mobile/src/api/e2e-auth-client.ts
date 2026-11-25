import { type AuthClient, isSixDigitCode, looksLikeEmail } from "./auth-client";

/** Código que acepta el build de e2e. Solo existe en ese build; la API real nunca lo acepta. */
export const E2E_CODE = "123456";
const TOKEN = "e2e-session";

/**
 * Autenticación de mentira para las pruebas de extremo a extremo: el emulador del CI no tiene
 * correo ni API, así que el flujo de entrada se recorre sin red. Nunca se usa fuera de `e2eMode`.
 */
export const e2eAuthClient = (): AuthClient => ({
  sendCode: async (email) =>
    looksLikeEmail(email)
      ? { ok: true, value: undefined }
      : { ok: false, error: { kind: "invalid" } },
  verifyCode: async (_email, code) =>
    isSixDigitCode(code) && code === E2E_CODE
      ? { ok: true, value: TOKEN }
      : { ok: false, error: { kind: "invalid" } },
  me: async (token) => ({
    ok: true,
    value: token === TOKEN ? { userId: "e2e-user", sessionId: "e2e-session" } : null,
  }),
  signOut: async () => ({ ok: true, value: undefined }),
  deleteAccount: async () => ({ ok: true, value: undefined }),
});
