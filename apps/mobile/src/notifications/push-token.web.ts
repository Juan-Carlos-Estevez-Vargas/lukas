import type { PushTokenSource } from "./weekly";

/** En la web no hay avisos push (la PWA no los usa todavía). */
export const pushTokenSource: PushTokenSource = {
  available: false,
  token: async () => null,
};
