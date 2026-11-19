import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { createTranslator, resolveLocale } from "./translator";

describe("idioma", () => {
  it("usa el primer idioma soportado del dispositivo", () => {
    expect(resolveLocale(["fr-FR", "en-US", "es-CO"])).toBe("en");
    expect(resolveLocale(["es-CO"])).toBe("es");
    expect(resolveLocale(["EN"])).toBe("en");
  });

  it("cae en español si no hay ninguno soportado", () => {
    expect(resolveLocale(["pt-BR", null, undefined])).toBe("es");
    expect(resolveLocale([])).toBe("es");
  });
});

describe("traductor", () => {
  it("traduce e interpola parámetros", () => {
    const t = createTranslator("es");
    expect(t("tabs.summary")).toBe("Resumen");
    expect(t("signIn.codeSentTo", { email: "ana@lukas.co" })).toBe(
      "Escribe el código que enviamos a ana@lukas.co.",
    );
    expect(createTranslator("en")("signIn.tooMany", { seconds: 60 })).toBe(
      "Too many attempts. Wait 60 seconds.",
    );
  });

  it("deja visible un marcador sin valor", () => {
    expect(createTranslator("es")("settings.version")).toBe("Versión {version}");
  });

  it("inglés tiene exactamente las mismas claves que español", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(Object.values(en).every((text) => text.trim().length > 0)).toBe(true);
  });
});
