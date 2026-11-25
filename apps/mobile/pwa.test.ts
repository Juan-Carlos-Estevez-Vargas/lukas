/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pub = join(import.meta.dirname, "public");
const headers = readFileSync(join(pub, "_headers"), "utf8");
const csp = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? "";
const manifest = JSON.parse(readFileSync(join(pub, "manifest.webmanifest"), "utf8")) as {
  display: string;
  start_url: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

describe("PWA", () => {
  it("aísla el origen como lo exige SQLite en la web, también en Safari", () => {
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
  });

  it("la CSP permite el wasm y el worker de SQLite sin abrir eval ni orígenes ajenos", () => {
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:;");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("la página del captcha sale del aislamiento solo con su propia CSP", () => {
    const rule = headers.split("\n/captcha/*\n")[1]?.split("\n\n")[0] ?? "";
    expect(rule).toContain("! Content-Security-Policy");
    expect(rule).toContain("! Cross-Origin-Embedder-Policy");
    const own = /Content-Security-Policy: (.+)/.exec(rule)?.[1] ?? "";
    expect(own).toContain("default-src 'none'");
    expect(own).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(own).toContain("frame-src https://challenges.cloudflare.com;");
    expect(own).not.toMatch(/script-src[^;]*unsafe/);
    const page = readFileSync(join(pub, "captcha", "turnstile.html"), "utf8");
    expect(page).toContain('src="/captcha/turnstile.js"');
    expect(page).not.toMatch(/<script>(?!<\/script>)/);
  });

  it("el manifest se instala como app y sus íconos existen", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(
      expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]),
    );
    for (const icon of manifest.icons) expect(existsSync(join(pub, icon.src))).toBe(true);
  });

  it("la página trae lo que Safari necesita para «Agregar a inicio»", () => {
    const html = readFileSync(join(pub, "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(existsSync(join(pub, "icons/apple-touch-icon.png"))).toBe(true);
  });
});
