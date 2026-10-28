import { log } from "../../http/request-context";

export type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

/** Puerto de envío de correo. El proveedor real (p. ej. Resend) se conecta detrás de esta interfaz. */
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
