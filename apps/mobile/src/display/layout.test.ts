import { describe, expect, it } from "vitest";
import { DESKTOP_MIN_WIDTH, isDesktop } from "./layout";

describe("diseño de escritorio", () => {
  it("solo aplica desde el ancho mínimo", () => {
    expect(isDesktop(390)).toBe(false);
    expect(isDesktop(DESKTOP_MIN_WIDTH - 1)).toBe(false);
    expect(isDesktop(DESKTOP_MIN_WIDTH)).toBe(true);
    expect(isDesktop(1440)).toBe(true);
  });
});
