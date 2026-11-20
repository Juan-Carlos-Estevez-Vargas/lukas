import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

/** Solo rutas internas: un aviso nunca abre una URL externa. */
const internal = (url: unknown): url is string =>
  typeof url === "string" && /^\/[a-z0-9/_()-]*$/i.test(url);

/** Al tocar un aviso push (p. ej. el resumen del domingo) abre la pantalla que trae. */
export function usePushLinks() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url: unknown = response.notification.request.content.data?.url;
      if (internal(url)) router.push(url as never);
    });
    return () => sub.remove();
  }, []);
}
