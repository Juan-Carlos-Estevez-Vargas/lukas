import { describe, expect, it } from "vitest";
import { captchaUrl, parseCaptchaMessage } from "./captcha-core";

describe("captcha", () => {
  it("arma la URL de la página con la llave y el idioma", () => {
    expect(captchaUrl("https://lukas.pages.dev/", "0x4AAAAAAAAAAAAAAA", "es")).toBe(
      "https://lukas.pages.dev/captcha/turnstile?sitekey=0x4AAAAAAAAAAAAAAA&lang=es",
    );
  });

  it("solo acepta mensajes de la página del captcha", () => {
    const token = "aaaa.bbbb.cccc";
    expect(parseCaptchaMessage(JSON.stringify({ type: "token", token }))).toEqual({
      type: "token",
      token,
    });
    expect(parseCaptchaMessage({ type: "token", token })).toEqual({ type: "token", token });
    expect(parseCaptchaMessage({ type: "expired" })).toEqual({ type: "expired" });
    expect(parseCaptchaMessage({ type: "error", code: 110200 })).toEqual({
      type: "error",
      code: "110200",
    });
    expect(parseCaptchaMessage({ type: "token", token: "<script>" })).toBeNull();
    expect(parseCaptchaMessage({ type: "token", token: 1 })).toBeNull();
    expect(parseCaptchaMessage("no es json")).toBeNull();
    expect(parseCaptchaMessage(null)).toBeNull();
    expect(parseCaptchaMessage({ type: "otro" })).toBeNull();
  });
});
