import { describe, expect, it, vi } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import {
  createTelemetry,
  firstTime,
  installId,
  noTelemetry,
  setTelemetryEnabled,
  telemetryEnabled,
} from "./telemetry";

const config = {
  sentryDsn: "https://llave@o1.ingest.sentry.io/42",
  posthogKey: "phc_prueba",
  posthogHost: "https://eu.i.posthog.com/",
  release: "0.5.0",
  environment: "staging",
  platform: "android",
};

const ok = (body: unknown = {}) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body)));
const call = (f: ReturnType<typeof ok>, i = 0) => {
  const [url, init] = f.mock.calls[i] ?? ["", {}];
  return { url, body: String(init?.body ?? "") };
};

describe("telemetría de la app", () => {
  it("reporta errores a Sentry limpios de datos personales", async () => {
    const fetchImpl = ok();
    await createTelemetry(config, "inst-1", fetchImpl).report(
      new Error("no guardó el gasto de ana@lukas.co"),
      "/movement/new?monto=45900",
    );
    const { url, body } = call(fetchImpl);
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(body).toContain("[correo]");
    expect(body).not.toMatch(/ana@|45900|inst-1/);
  });

  it("manda eventos anónimos a PostHog con propiedades limpias", async () => {
    const fetchImpl = ok();
    await createTelemetry(config, "inst-1", fetchImpl).track("movement_created", {
      kind: "expense",
      note: "ana@lukas.co",
    });
    const { url, body } = call(fetchImpl);
    expect(url).toBe("https://eu.i.posthog.com/capture/");
    const sent = JSON.parse(body);
    expect(sent).toMatchObject({
      api_key: "phc_prueba",
      event: "movement_created",
      distinct_id: "inst-1",
      properties: {
        kind: "expense",
        note: "[correo]",
        $process_person_profile: false,
        platform: "android",
        app_version: "0.5.0",
      },
    });
  });

  it("lee las feature flags y tolera respuestas raras", async () => {
    const flags = await createTelemetry(
      config,
      "inst-1",
      ok({ featureFlags: { nuevo_inicio: true, variante: "b", apagada: false, texto: "false" } }),
    ).flags();
    expect(flags).toEqual({ nuevo_inicio: true, variante: true, apagada: false, texto: false });
    expect(await createTelemetry(config, "i", ok({ nada: 1 })).flags()).toEqual({});
    const broken = vi.fn(async () => new Response("no es json"));
    expect(await createTelemetry(config, "i", broken).flags()).toEqual({});
  });

  it("sin llaves no llama a nadie y si la red falla no revienta", async () => {
    const fetchImpl = ok();
    const off = createTelemetry({ ...config, sentryDsn: "", posthogKey: "" }, "i", fetchImpl);
    await off.report(new Error("x"));
    await off.track("app_opened");
    expect(await off.flags()).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
    const down = createTelemetry(config, "i", async () => {
      throw new TypeError("sin red");
    });
    await expect(down.report("x")).resolves.toBeUndefined();
    await expect(down.track("app_opened")).resolves.toBeUndefined();
    expect(await down.flags()).toEqual({});
    await expect(noTelemetry.report("x")).resolves.toBeUndefined();
    await expect(noTelemetry.track("app_opened")).resolves.toBeUndefined();
    expect(await noTelemetry.flags()).toEqual({});
  });

  it("guarda la preferencia, el id de instalación y los primeros eventos", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    expect(await telemetryEnabled(db)).toBe(true);
    await setTelemetryEnabled(db, false);
    expect(await telemetryEnabled(db)).toBe(false);
    await setTelemetryEnabled(db, true);
    expect(await telemetryEnabled(db)).toBe(true);
    const id = await installId(db, () => "id-1");
    expect(id).toBe("id-1");
    expect(await installId(db, () => "id-2")).toBe("id-1");
    expect(await firstTime(db, "first_movement")).toBe(true);
    expect(await firstTime(db, "first_movement")).toBe(false);
    expect(await firstTime(db, "signed_in")).toBe(true);
  });
});
