import type { ExpoConfig } from "expo/config";
import { describe, expect, it } from "vitest";
import {
  networkSecurityXml,
  PIN_EXPIRATION,
  PINNED_HOSTS,
  PINS,
  withNetworkSecurity,
} from "./network-security";

describe("pinning de certificados", () => {
  it("fija las raíces para los dominios de la API y no admite tráfico en claro", () => {
    const xml = networkSecurityXml();
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).not.toContain('src="user"');
    for (const host of PINNED_HOSTS) expect(xml).toContain(`>${host}</domain>`);
    expect(xml).toContain(`<pin-set expiration="${PIN_EXPIRATION}">`);
    expect(xml.match(/<pin digest="SHA-256">/g)).toHaveLength(PINS.length);
  });

  it("los pines son SHA-256 en base64, sin repetir, y hay respaldo de varias CAs", () => {
    const hashes = PINS.map((p) => p.sha256);
    for (const h of hashes) expect(Buffer.from(h, "base64")).toHaveLength(32);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(PINS.length).toBeGreaterThanOrEqual(4);
  });

  it("los pines vencen dentro de los próximos dos años para no olvidar renovarlos", () => {
    const days = (Date.parse(PIN_EXPIRATION) - Date.parse("2026-11-20")) / 86_400_000;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(731);
  });

  it("el cliente de desarrollo puede hablar con Metro en la red local", () => {
    expect(networkSecurityXml({ devClient: true })).toContain(
      '<base-config cleartextTrafficPermitted="true">',
    );
  });

  it("registra los mods de Android", () => {
    const config = withNetworkSecurity({ name: "Lukas", slug: "lukas" } as ExpoConfig, {});
    const mods = (config as ExpoConfig & { mods?: { android?: Record<string, unknown> } }).mods;
    expect(Object.keys(mods?.android ?? {})).toEqual(
      expect.arrayContaining(["dangerous", "manifest"]),
    );
  });
});
