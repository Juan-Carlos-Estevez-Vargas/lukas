import { describe, expect, it } from "vitest";
import {
  cleanFeedback,
  FEEDBACK_MAX_LENGTH,
  isFeedbackKind,
  maskCardNumbers,
  passesLuhn,
} from "./feedback";

describe("comentarios de la beta", () => {
  it("reconoce los tipos", () => {
    expect(isFeedbackKind("bug")).toBe(true);
    expect(isFeedbackKind("queja")).toBe(false);
  });

  it("valida el dígito de control", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(passesLuhn("4111111111111112")).toBe(false);
    expect(passesLuhn("")).toBe(false);
  });

  it("tapa las tarjetas pero deja montos, cédulas y celulares", () => {
    expect(maskCardNumbers("mi visa 4111 1111 1111 1111 no carga")).toBe(
      "mi visa [tarjeta] no carga",
    );
    expect(maskCardNumbers("la 5500-0000-0000-0004 tampoco")).toBe("la [tarjeta] tampoco");
    expect(maskCardNumbers("gasté 1200000 y mi cel es 3001234567")).toBe(
      "gasté 1200000 y mi cel es 3001234567",
    );
    // 16 dígitos que no pasan Luhn: no es una tarjeta.
    expect(maskCardNumbers("ref 1234567812345678")).toBe("ref 1234567812345678");
  });

  it("limpia el texto y rechaza lo muy corto o muy largo", () => {
    expect(cleanFeedback("  No abre\n\n\n\nel resumen  ")).toBe("No abre\n\nel resumen");
    expect(cleanFeedback(" hola ")).toBeNull();
    expect(cleanFeedback("a".repeat(FEEDBACK_MAX_LENGTH + 1))).toBeNull();
    expect(cleanFeedback("pagué con 4111111111111111")).toBe("pagué con [tarjeta]");
  });
});
