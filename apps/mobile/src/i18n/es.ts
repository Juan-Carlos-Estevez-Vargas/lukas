/** Textos en español (Colombia). Es la fuente de verdad: las demás lenguas deben tener las mismas claves. */
export const es = {
  "app.name": "Lukas",
  "tabs.summary": "Resumen",
  "tabs.transactions": "Movimientos",
  "tabs.budgets": "Presupuestos",
  "tabs.settings": "Ajustes",
  "signIn.title": "Entra a Lukas",
  "signIn.subtitle": "Te enviamos un código de 6 dígitos a tu correo. Sin contraseñas.",
  "signIn.email": "Correo electrónico",
  "signIn.sendCode": "Enviar código",
  "signIn.code": "Código de 6 dígitos",
  "signIn.codeSentTo": "Escribe el código que enviamos a {email}.",
  "signIn.verify": "Entrar",
  "signIn.changeEmail": "Usar otro correo",
  "signIn.invalidEmail": "Revisa el correo; parece incompleto.",
  "signIn.invalidCode": "El código no es válido o ya venció.",
  "signIn.tooMany": "Demasiados intentos. Espera {seconds} segundos.",
  "signIn.network": "No pudimos conectar con Lukas. Revisa tu conexión.",
  "summary.empty": "Aún no tienes movimientos. Aquí verás tu saldo y tus gastos del mes.",
  "transactions.empty": "Tus ingresos y gastos aparecerán aquí.",
  "budgets.empty": "Crea tu primer presupuesto para controlar tus gastos.",
  "settings.signOut": "Cerrar sesión",
  "settings.version": "Versión {version}",
} as const;

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;
