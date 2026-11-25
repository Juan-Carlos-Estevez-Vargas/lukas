import { log } from "../../http/request-context";

export type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

/** Puerto de envío de correo. El proveedor real (Resend) se conecta detrás de esta interfaz. */
export interface Mailer {
  sendOtp(input: { to: string; code: string; purpose: OtpPurpose }): Promise<void>;
}

/**
 * Mailer para desarrollo local: registra el código en la consola en vez de enviarlo.
 * Nunca se usa fuera de `development`, porque el código daría acceso a la cuenta.
 */
export const consoleMailer: Mailer = {
  sendOtp: async ({ to, code, purpose }) => {
    log("info", "dev_otp", { to, code, purpose });
  },
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SUBJECTS: Record<OtpPurpose, string> = {
  "sign-in": "Tu código para entrar a Lukas",
  "email-verification": "Confirma tu correo en Lukas",
  "forget-password": "Tu código para recuperar el acceso a Lukas",
  "change-email": "Confirma tu nuevo correo en Lukas",
};

/** Texto y HTML del correo con el código. El código son solo dígitos: no hace falta escaparlo. */
export const otpEmail = (code: string, purpose: OtpPurpose) => {
  const lines = [
    `Tu código es ${code}.`,
    "Vence en 5 minutos y sirve una sola vez.",
    "Si no lo pediste, ignora este correo: nadie puede entrar sin el código.",
    "Lukas nunca te pedirá este código por teléfono, chat ni redes sociales.",
  ];
  return {
    subject: SUBJECTS[purpose],
    text: lines.join("\n\n"),
    html: [
      '<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">',
      "<p>Tu código es:</p>",
      `<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>`,
      ...lines.slice(1).map((line) => `<p>${line}</p>`),
      "</div>",
    ].join(""),
  };
};

/**
 * Resend por HTTP (plan gratis: 3 000 correos al mes). Sin dominio propio, Resend solo entrega al
 * correo del dueño de la cuenta; con dominio verificado entrega a cualquiera (`docs/correo.md`).
 * Nunca registra el destinatario ni el código.
 */
export const resendMailer = (
  apiKey: string,
  from: string,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Mailer => ({
  sendOtp: async ({ to, code, purpose }) => {
    const { subject, text, html } = otpEmail(code, purpose);
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      log("error", "mail_failed", { provider: "resend", status: response.status, purpose });
      throw new Error(`Resend respondió ${response.status}`);
    }
  },
});
