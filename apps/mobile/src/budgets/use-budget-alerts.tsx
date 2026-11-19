import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { civilDate } from "../accounts/credit-card";
import { newId } from "../data/ids";
import { useLocalDatabase } from "../data/provider";
import { useI18n } from "../i18n/i18n";
import { notificationScheduler } from "../reminders/notifications";
import { type BudgetAlertTexts, notifyBudgetAlerts } from "./budget-alerts";

interface BudgetAlerts {
  /** Revisa los presupuestos después de registrar algo. */
  check(): void;
}

const BudgetAlertsContext = createContext<BudgetAlerts>({ check: () => undefined });

/** Avisa al pasar el 80 % y el 100 % de un presupuesto: al registrar y al abrir la app. */
export function BudgetAlertsProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const { t } = useI18n();

  const texts = useCallback<BudgetAlertTexts>(
    ({ view, level }) => {
      const name = view.category?.name ?? t("budgets.general");
      return {
        title: t("budgets.alert.title", { name }),
        body:
          level === "over"
            ? t("budgets.alert.over")
            : t("budgets.alert.warning", { percent: String(view.status.percent) }),
      };
    },
    [t],
  );

  const check = useCallback(() => {
    if (database.status !== "ready") return;
    const now = new Date();
    void notifyBudgetAlerts(
      database.db,
      notificationScheduler,
      civilDate(now),
      { newId, now: () => now },
      texts,
    ).catch(() => undefined);
  }, [database, texts]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const value = useMemo(() => ({ check }), [check]);
  return <BudgetAlertsContext.Provider value={value}>{children}</BudgetAlertsContext.Provider>;
}

export const useBudgetAlerts = (): BudgetAlerts => useContext(BudgetAlertsContext);
