import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { ReminderScheduler } from "./scheduler";

const CHANNEL = "payments";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Adaptador nativo: notificaciones locales con expo-notifications, sin push ni servidor. */
export const notificationScheduler: ReminderScheduler = {
  available: true,
  async ensurePermission() {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Pagos",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  },
  async pending(prefix) {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.map((n) => n.identifier).filter((id) => id.startsWith(prefix));
  },
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  async schedule(r) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(r.at.year, r.at.month - 1, r.at.day, r.hour),
        channelId: CHANNEL,
      },
    });
  },
};
