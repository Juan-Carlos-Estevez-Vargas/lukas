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
import { civilDate } from "../accounts/credit-card";
import { useBudgetAlerts } from "../budgets/use-budget-alerts";
import { newId } from "../data/ids";
import { useLocalDatabase } from "../data/provider";
import { useI18n } from "../i18n/i18n";
import { notificationScheduler } from "../reminders/notifications";
import { postDueRecurring } from "./recurring";
import { type RecurringTexts, syncRecurringReminders } from "./recurring-reminders";

interface RecurringState {
  /** Cambia cada vez que se registran recurrentes: las pantallas lo usan para recargar. */
  readonly version: number;
  /** Ids de recurrentes que no se pudieron registrar en la última pasada. */
  readonly failed: readonly string[];
  /** Registra lo vencido y reprograma los avisos (después de crear o cambiar uno). */
  refresh(): void;
}

const RecurringContext = createContext<RecurringState>({
  version: 0,
  failed: [],
  refresh: () => undefined,
});

/** Al abrir la app o volver a ella, registra los recurrentes vencidos y deja sus avisos. */
export function RecurringProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const { t } = useI18n();
  const budgets = useBudgetAlerts();
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState<readonly string[]>([]);

  const texts = useCallback<RecurringTexts>(
    (r) => ({
      title: t("reminder.recurring.title", { name: r.name }),
      body: t(r.autoPost ? "reminder.recurring.auto" : "reminder.recurring.confirm"),
    }),
    [t],
  );

  const refresh = useCallback(() => {
    if (database.status !== "ready") return;
    const now = new Date();
    void (async () => {
      const run = await postDueRecurring(database.db, civilDate(now), { newId, now: () => now });
      setFailed(run.failed);
      if (run.posted > 0) {
        setVersion((v) => v + 1);
        budgets.check();
      }
      await syncRecurringReminders(database.db, notificationScheduler, now, texts);
    })().catch(() => undefined);
  }, [database, texts, budgets]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(() => ({ version, failed, refresh }), [version, failed, refresh]);
  return <RecurringContext.Provider value={value}>{children}</RecurringContext.Provider>;
}

export const useRecurring = (): RecurringState => useContext(RecurringContext);
