/**
 * Presupuesto de rendimiento del APK (FIN-118). El CI falla si el arranque en frío (mediana)
 * pasa de 1,5 s o si el APK crece más de la cuenta. Lógica pura; la medición está en measure.ts.
 */
export interface PerfBudget {
  readonly startupMs: number;
  readonly apkBytes: number;
}

export const BUDGET: PerfBudget = {
  startupMs: 1500,
  // APK de una sola arquitectura (x86_64 en el emulador), como lo que descarga cada teléfono.
  apkBytes: 45 * 1024 * 1024,
};

/** `TotalTime` de `am start -W`: hasta el primer cuadro de la actividad, en milisegundos. */
export const parseTotalTime = (output: string): number | null => {
  const match = /^TotalTime:\s*(\d+)\s*$/m.exec(output);
  return match ? Number(match[1]) : null;
};

export const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error("No hay mediciones");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[mid - 1] as number) + upper) / 2);
};

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export interface PerfReport {
  readonly ok: boolean;
  /** Resumen en Markdown para el resumen del job. */
  readonly markdown: string;
}

export const evaluate = (
  measured: { readonly startupMs: readonly number[]; readonly apkBytes: number },
  budget: PerfBudget = BUDGET,
): PerfReport => {
  const startup = median(measured.startupMs);
  const startupOk = startup <= budget.startupMs;
  const sizeOk = measured.apkBytes <= budget.apkBytes;
  const mark = (ok: boolean) => (ok ? "✅" : "❌");
  const markdown = [
    "### Presupuesto de rendimiento",
    "",
    "| Métrica | Medido | Límite | |",
    "| --- | --- | --- | --- |",
    `| Arranque en frío (mediana de ${measured.startupMs.length}) | ${startup} ms | ${budget.startupMs} ms | ${mark(startupOk)} |`,
    `| Tamaño del APK | ${mb(measured.apkBytes)} | ${mb(budget.apkBytes)} | ${mark(sizeOk)} |`,
    "",
    `Arranques: ${measured.startupMs.join(", ")} ms.`,
  ].join("\n");
  return { ok: startupOk && sizeOk, markdown };
};
