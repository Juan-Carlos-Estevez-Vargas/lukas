/**
 * Mide el arranque en frío y el tamaño del APK en el emulador del CI y aplica el presupuesto.
 * Uso: node e2e/measure.ts <ruta del APK>   (Node 22 ejecuta TypeScript sin compilar)
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { evaluate, parseTotalTime } from "./perf.ts";

const PACKAGE = "co.lukas.app";
const RUNS = 7;

const adb = (...args: string[]): string => execFileSync("adb", args, { encoding: "utf8" });

const coldStart = (): number => {
  adb("shell", "am", "force-stop", PACKAGE);
  // Sin `-S` no hay garantía de proceso nuevo; con force-stop antes, cada arranque es en frío.
  const out = adb("shell", "am", "start", "-W", "-S", "-n", `${PACKAGE}/.MainActivity`);
  const ms = parseTotalTime(out);
  if (ms === null) throw new Error(`No se pudo medir el arranque:\n${out}`);
  return ms;
};

const apk = process.argv[2];
if (!apk) throw new Error("Falta la ruta del APK");

// El primer arranque compila y prepara la app; no cuenta.
coldStart();
const startupMs = Array.from({ length: RUNS }, coldStart);
const report = evaluate({ startupMs, apkBytes: statSync(apk).size });

console.log(report.markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.markdown}\n`);
if (!report.ok) process.exitCode = 1;
