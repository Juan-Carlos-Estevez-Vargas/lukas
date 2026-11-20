import { type EventSubscription, requireOptionalNativeModule } from "expo";
import type { PostedNotification } from "./notification";

/** El módulo nativo `modules/notification-reader` (solo Android). */
export interface NotificationReader {
  hasAccess(): boolean;
  openSettings(): void;
  allowedApps(): string[];
  setAllowedApps(apps: string[]): void;
  /** Devuelve lo que llegó desde la última vez y vacía la cola. */
  drain(): PostedNotification[];
  addListener(event: "onNotification", listener: () => void): EventSubscription;
}

/** `null` en la web y en iOS, que no dejan leer notificaciones de otras apps. */
export const notificationReader: NotificationReader | null =
  requireOptionalNativeModule<NotificationReader>("LukasNotifications");
