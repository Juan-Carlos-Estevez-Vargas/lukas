/** Un aviso para un teléfono. */
export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  /** Pantalla que abre al tocarlo. */
  readonly url?: string;
}

/** Puerto de envío de avisos push. */
export interface PushSender {
  /** Envía y devuelve los tokens que el servicio dio por muertos (app desinstalada). */
  send(messages: readonly PushMessage[]): Promise<{ readonly dead: readonly string[] }>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** El servicio de Expo acepta hasta 100 mensajes por petición. */
const BATCH = 100;

interface Ticket {
  status?: string;
  details?: { error?: string };
}

/** Servicio push de Expo (gratis). Con `accessToken` se exige el token de acceso del proyecto. */
export function expoPushSender(fetchImpl: Fetch = fetch, accessToken?: string): PushSender {
  return {
    async send(messages) {
      const dead: string[] = [];
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH);
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.to,
              title: m.title,
              body: m.body,
              sound: "default",
              ...(m.url ? { data: { url: m.url } } : {}),
            })),
          ),
        });
        if (!res.ok) throw new Error(`Expo push respondió ${res.status}`);
        const json = (await res.json()) as { data?: Ticket[] };
        (json.data ?? []).forEach((ticket, index) => {
          const to = batch[index]?.to;
          if (to && ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
            dead.push(to);
          }
        });
      }
      return { dead };
    },
  };
}
