import { reloadAppAsync } from "expo";
import { getRandomBytes } from "expo-crypto";
import { useState } from "react";
import { ScrollView } from "react-native";
import { backupFileName, createBackup, restoreBackup } from "../../src/backup/backup";
import { BackupError } from "../../src/backup/crypto";
import { movementsCsv } from "../../src/backup/csv";
import { backupFiles } from "../../src/backup/files";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { markStep } from "../../src/tutorial/tutorial";

type Busy = "backup" | "restore" | "csv" | null;

const errorKey = (error: unknown): MessageKey =>
  error instanceof BackupError ? `backup.error.${error.code}` : "backup.error.generic";

/** Respaldo cifrado, restauración y exportación a CSV. */
export default function Backup() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const db = database.status === "ready" && backupFiles.available ? database.db : null;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const run = async (kind: Busy, work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(kind);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ text: done, error: false });
    } catch (error) {
      setMessage({ text: t(errorKey(error)), error: true });
    } finally {
      setBusy(null);
    }
  };

  const backup = () =>
    run("backup", async () => {
      if (password !== confirm) return t("backup.mismatch");
      const now = new Date();
      const contents = await createBackup(db, password, getRandomBytes, now);
      await backupFiles.share(backupFileName(now, "lukas"), contents, "application/json");
      await markStep(db, "backup").catch(() => undefined);
      setPassword("");
      setConfirm("");
      return t("backup.done");
    });

  const pick = () =>
    run("restore", async () => {
      const text = await backupFiles.pick();
      setFile(text);
      return text ? t("backup.picked") : null;
    });

  const restore = () =>
    run("restore", async () => {
      if (!file) return null;
      const rows = await restoreBackup(db, file, restorePassword);
      setFile(null);
      setRestorePassword("");
      // Todo cambió: se recarga la app para que cada pantalla lea los datos restaurados.
      setTimeout(() => void reloadAppAsync("Respaldo restaurado"), 1500);
      return t("backup.restored", { rows: String(rows) });
    });

  const csv = () =>
    run("csv", async () => {
      const contents = await movementsCsv(db, {
        headers: [
          t("csv.date"),
          t("csv.kind"),
          t("csv.account"),
          t("csv.category"),
          t("csv.merchant"),
          t("csv.note"),
          t("csv.amount"),
          t("csv.currency"),
          t("csv.tags"),
        ],
        kinds: {
          expense: t("list.kind.expense"),
          income: t("list.kind.income"),
          transfer: t("list.kind.transfer"),
          adjustment: t("list.kind.adjustment"),
        },
      });
      await backupFiles.share(backupFileName(new Date(), "csv"), contents, "text/csv");
      return null;
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{t("backup.title")}</Title>
        <Body muted>{t("backup.body")}</Body>
        <Field
          label={t("backup.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        <Field
          label={t("backup.confirm")}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        <Button
          label={busy === "backup" ? t("backup.creating") : t("backup.create")}
          busy={busy === "backup"}
          onPress={() => void backup()}
        />

        <Title>{t("backup.restoreTitle")}</Title>
        <Body muted>{t("backup.restoreWarning")}</Body>
        <Button label={t("backup.pick")} variant="plain" onPress={() => void pick()} />
        {file ? (
          <>
            <Field
              label={t("backup.password")}
              value={restorePassword}
              onChangeText={setRestorePassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <Button
              label={busy === "restore" ? t("backup.restoring") : t("backup.restore")}
              busy={busy === "restore"}
              onPress={() => void restore()}
            />
          </>
        ) : null}

        <Title>{t("backup.csvTitle")}</Title>
        <Body muted>{t("backup.csvBody")}</Body>
        <Button
          label={t("backup.csv")}
          variant="plain"
          busy={busy === "csv"}
          onPress={() => void csv()}
        />
        {message ? (
          <Body {...(message.error ? { tone: "error" as const } : {})}>{message.text}</Body>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
