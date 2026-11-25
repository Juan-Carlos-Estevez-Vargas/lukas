import { type Href, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Body, Button } from "../components/ui";
import { e2eMode } from "../config";
import type { SqlConnection } from "../data/sql";
import { Card } from "../home/home-cards";
import type { MessageKey } from "../i18n/es";
import { useI18n } from "../i18n/i18n";
import { useAppLock } from "../lock/app-lock";
import {
  hideChecklist,
  markTipSeen,
  readTutorial,
  type TutorialProgress,
  type TutorialStep,
  type TutorialTip,
  tutorialProgress,
} from "./tutorial";

/** A dónde lleva cada paso de "Primeros pasos". */
export const STEP_ROUTES: Record<TutorialStep, Href> = {
  movement: "/movement/new",
  budget: "/budgets/new",
  goal: "/goals/new",
  recurring: "/recurring/new",
  lock: "/(tabs)/settings",
  backup: "/backup",
};

/**
 * "Primeros pasos" en el Resumen: seis tareas cortas que enseñan la app usándola. Se recalcula
 * cuando cambia `reload` y desaparece al terminar o al ocultarla.
 */
export function FirstStepsCard({
  db,
  reload,
}: {
  readonly db: SqlConnection;
  readonly reload: number;
}) {
  const { t } = useI18n();
  const lock = useAppLock();
  const lockOn = lock.status !== "off" && lock.status !== "checking";
  const [progress, setProgress] = useState<TutorialProgress | null>(null);

  const load = useCallback(async () => {
    if (reload < 0) return;
    setProgress(await tutorialProgress(db, { lockOn }));
  }, [db, lockOn, reload]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  // En la build de e2e no se muestra: los flujos de Maestro esperan las pantallas sin tarjetas extra.
  if (e2eMode || !progress?.visible) return null;
  return (
    <Card title={t("tutorial.title", { done: progress.done, total: progress.total })}>
      {progress.steps.map(({ step, done }) => (
        <Pressable
          key={step}
          accessibilityRole="button"
          accessibilityState={{ checked: done }}
          onPress={() => router.push(STEP_ROUTES[step])}
          style={{ minHeight: 44, justifyContent: "center" }}
          testID={`tutorial-step-${step}`}
        >
          <Body muted={done}>
            {`${done ? "✓" : "○"} ${t(`tutorial.step.${step}` as MessageKey)}`}
          </Body>
        </Pressable>
      ))}
      {progress.next ? (
        <Body muted>{t(`tutorial.hint.${progress.next}` as MessageKey)}</Body>
      ) : null}
      <Button
        label={t("tutorial.hide")}
        variant="plain"
        onPress={() => void hideChecklist(db).then(load)}
      />
    </Card>
  );
}

/** Consejo de una pantalla: se muestra una sola vez, hasta tocar "Entendido". */
export function TipCard({
  db,
  tip,
}: {
  readonly db: SqlConnection | null;
  readonly tip: TutorialTip;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!db) return;
    let active = true;
    void readTutorial(db)
      .then((s) => {
        if (active) setShow(!s.seenTips.includes(tip));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [db, tip]);

  if (e2eMode || !db || !show) return null;
  return (
    <Card title={t("tutorial.tipTitle")}>
      <Body>{t(`tutorial.tip.${tip}` as MessageKey)}</Body>
      <Button
        label={t("tutorial.gotIt")}
        variant="plain"
        onPress={() => {
          setShow(false);
          void markTipSeen(db, tip).catch(() => undefined);
        }}
      />
    </Card>
  );
}
