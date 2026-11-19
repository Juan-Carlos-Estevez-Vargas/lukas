import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";
import { useLocalDatabase } from "../data/provider";
import { useI18n } from "../i18n/i18n";
import {
  cardRemindersEnabled,
  type ReminderTexts,
  setCardRemindersEnabled,
  syncCardReminders,
} from "./card-reminders";
import { notificationScheduler } from "./notifications";

interface CardReminders {
  readonly available: boolean;
  readonly enabled: boolean;
  /** Enciende o apaga los avisos. Devuelve `false` si el teléfono negó el permiso. */
  setEnabled(on: boolean): Promise<boolean>;
  /** Recalcula los avisos después de cambiar una tarjeta o sus movimientos. */
  resync(): void;
}

const CardRemindersContext = createContext<CardReminders>({
  available: false,
  enabled: false,
  setEnabled: async () => false,
  resync: () => undefined,
});

export function CardRemindersProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const { t } = useI18n();
  const [enabled, setState] = useState(false);

  const texts = useCallback<ReminderTexts>(
    (card, days) => ({
      title: t("reminder.title", { card: card.name }),
      body: days === 0 ? t("reminder.today") : t("reminder.days", { days: String(days) }),
    }),
    [t],
  );

  const resync = useCallback(() => {
    if (database.status !== "ready") return;
    void syncCardReminders(database.db, notificationScheduler, new Date(), texts).catch(
      () => undefined,
    );
  }, [database, texts]);

  useEffect(() => {
    if (database.status !== "ready") return;
    void cardRemindersEnabled(database.db).then(setState);
    resync();
    // Al volver a la app, las fechas pudieron cambiar (pasó el corte o se registró un pago).
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") resync();
    });
    return () => sub.remove();
  }, [database, resync]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (database.status !== "ready") return false;
      if (on && !(await notificationScheduler.ensurePermission())) return false;
      await setCardRemindersEnabled(database.db, on);
      setState(on);
      resync();
      return true;
    },
    [database, resync],
  );

  const value = useMemo(
    () => ({ available: notificationScheduler.available, enabled, setEnabled, resync }),
    [enabled, setEnabled, resync],
  );
  return <CardRemindersContext.Provider value={value}>{children}</CardRemindersContext.Provider>;
}

export const useCardReminders = (): CardReminders => useContext(CardRemindersContext);
