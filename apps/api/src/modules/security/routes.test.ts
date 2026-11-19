import { describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { testEnv } from "../../test/env";
import { SECURITY_TXT } from "./routes";

describe("GET /.well-known/security.txt", () => {
  it("publica el contacto y una fecha de vencimiento válida (RFC 9116)", async () => {
    const res = await createApp().request("/.well-known/security.txt", {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe(SECURITY_TXT);
    expect(body).toMatch(/^Contact: https:\/\//m);
    const expires = /^Expires: (.+)$/m.exec(body)?.[1];
    expect(Number.isNaN(Date.parse(expires ?? ""))).toBe(false);
  });
});
