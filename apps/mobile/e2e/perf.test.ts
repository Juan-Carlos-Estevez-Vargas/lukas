import { describe, expect, it } from "vitest";
import { BUDGET, evaluate, median, parseTotalTime } from "./perf";

const AM_START = `Starting: Intent { cmp=co.lukas.app/.MainActivity }
Status: ok
LaunchState: COLD
Activity: co.lukas.app/.MainActivity
TotalTime: 812
WaitTime: 830
Complete
`;

describe("presupuesto de rendimiento", () => {
  it("lee TotalTime de am start -W", () => {
    expect(parseTotalTime(AM_START)).toBe(812);
    expect(parseTotalTime("Error: Activity not started")).toBeNull();
  });

  it("calcula la mediana", () => {
    expect(median([900, 700, 800])).toBe(800);
    expect(median([700, 800, 900, 1000])).toBe(850);
    expect(() => median([])).toThrow();
  });

  it("aprueba dentro del presupuesto", () => {
    const report = evaluate({ startupMs: [800, 900, 1000], apkBytes: 30 * 1024 * 1024 });
    expect(report.ok).toBe(true);
    expect(report.markdown).toContain("| 900 ms | 1500 ms | ✅ |");
    expect(report.markdown).toContain("30.0 MB");
  });

  it("falla si el arranque pasa de 1,5 s", () => {
    const report = evaluate({ startupMs: [1400, 1600, 1700], apkBytes: 1 });
    expect(report.ok).toBe(false);
    expect(report.markdown).toContain("| 1600 ms | 1500 ms | ❌ |");
  });

  it("falla si el APK pasa del límite", () => {
    expect(evaluate({ startupMs: [500], apkBytes: BUDGET.apkBytes + 1 }).ok).toBe(false);
  });
});
