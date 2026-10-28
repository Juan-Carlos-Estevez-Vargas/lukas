import { describe, expect, it } from "vitest";
import { andThen, err, map, mapErr, ok, unwrapOr } from "./result";

describe("Result", () => {
  it("map transforma solo el valor exitoso", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err("x"), (n: number) => n * 3)).toEqual(err("x"));
  });

  it("mapErr transforma solo el error", () => {
    expect(mapErr(err("x"), (e) => e.toUpperCase())).toEqual(err("X"));
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
  });

  it("andThen encadena operaciones que pueden fallar", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("impar"));
    expect(andThen(ok(8), half)).toEqual(ok(4));
    expect(andThen(ok(3), half)).toEqual(err("impar"));
    expect(andThen(err("antes"), half)).toEqual(err("antes"));
  });

  it("unwrapOr devuelve el respaldo en caso de error", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err("x"), 0)).toBe(0);
  });
});
