import { describe, expect, it } from "vitest";
import {
  cleanProperties,
  parseDsn,
  scrubText,
  scrubUrl,
  sentryEnvelope,
  sentryRequest,
} from "./telemetry";

describe("telemetría sin datos personales", () => {
  it("limpia correos, tarjetas, celulares, tokens y números largos", () => {
    const dirty =
      "falló ana@lukas.co con 4111 1111 1111 1111, cel +57 300 123 4567, cédula 1.020.304.050, Bearer abc.def y eyJa.eyJb.c1";
    const clean = scrubText(dirty);
    expect(clean).not.toMatch(/ana@|4111|300 123|1\.020|abc\.def|eyJa/);
    expect(clean).toContain("[correo]");
    expect(clean).toContain("[tarjeta]");
    expect(clean).toContain("[celular]");
    expect(clean).toContain("[número]");
    expect(clean).toContain("Bearer [token]");
    expect(scrubText("x".repeat(600))).toHaveLength(500);
    expect(scrubText("Error 404 en /cuentas")).toBe("Error 404 en /cuentas");
  });

  it("quita query y fragmento de las rutas", () => {
    expect(scrubUrl("/v1/auth/verify?email=ana@lukas.co#x")).toBe("/v1/auth/verify");
    expect(scrubUrl("")).toBe("");
  });

  it("lee DSN válidos y rechaza el resto", () => {
    expect(parseDsn("https://abc123@o1.ingest.us.sentry.io/4507")).toEqual({
      origin: "https://o1.ingest.us.sentry.io",
      publicKey: "abc123",
      projectId: "4507",
    });
    expect(parseDsn("http://abc@sentry.io/1")).toBeNull();
    expect(parseDsn("https://sentry.io/1")).toBeNull();
    expect(parseDsn("https://abc@sentry.io/proyecto")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("arma el sobre de Sentry sin usuario ni datos personales", () => {
    const dsn = parseDsn("https://abc@o1.ingest.sentry.io/42");
    if (!dsn) throw new Error("dsn");
    const error = new TypeError("No se pudo guardar el gasto de ana@lukas.co");
    const envelope = sentryEnvelope(
      error,
      {
        service: "mobile",
        release: "0.5.0",
        environment: "staging",
        where: "/movement/new?amount=45900",
        platform: "android",
        requestId: "r1",
      },
      new Date("2026-11-25T12:00:00Z"),
      (bytes) => bytes.fill(7),
    );
    const [header, item, body] = envelope.split("\n").map((l) => JSON.parse(l));
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(item).toEqual({ type: "event" });
    expect(body.exception.values[0]).toMatchObject({
      type: "TypeError",
      value: "No se pudo guardar el gasto de [correo]",
    });
    expect(body.tags).toEqual({ service: "mobile", platform: "android", where: "/movement/new" });
    expect(body.extra).toEqual({ requestId: "r1" });
    expect(body.user).toBeUndefined();
    expect(envelope).not.toContain("ana@");
    expect(envelope).not.toContain("45900");

    const plain = sentryEnvelope(
      "texto",
      { service: "api", release: "1", environment: "dev" },
      new Date(),
    );
    expect(JSON.parse(plain.split("\n")[2] ?? "{}").exception.values[0].value).toBe("texto");
    const odd = sentryEnvelope(
      { raro: true },
      { service: "api", release: "1", environment: "dev" },
      new Date(),
    );
    expect(JSON.parse(odd.split("\n")[2] ?? "{}").exception.values[0].value).toBe("Error");

    expect(sentryRequest(dsn, "lukas-api/1")).toEqual({
      url: "https://o1.ingest.sentry.io/api/42/envelope/",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=abc, sentry_client=lukas-api/1",
      },
    });
  });

  it("solo deja propiedades cortas con nombres simples", () => {
    expect(
      cleanProperties({
        plan: "premium",
        count: 3,
        "Correo Persona": "ana@lukas.co",
        source: "ana@lukas.co",
        ok: true,
      }),
    ).toEqual({ plan: "premium", count: 3, source: "[correo]", ok: true });
    expect(cleanProperties()).toEqual({});
  });
});
