import { describe, expect, it } from "vitest";
import { allOf, anyOf, not, spec } from "./specification";

describe("Specification", () => {
  const even = spec<number>((n) => n % 2 === 0);
  const big = spec<number>((n) => n > 10);

  it("combina con and, or y not", () => {
    expect(allOf(even, big).isSatisfiedBy(12)).toBe(true);
    expect(allOf(even, big).isSatisfiedBy(4)).toBe(false);
    expect(anyOf(even, big).isSatisfiedBy(3)).toBe(false);
    expect(anyOf(even, big).isSatisfiedBy(11)).toBe(true);
    expect(not(even).isSatisfiedBy(3)).toBe(true);
    expect(allOf<number>().isSatisfiedBy(1)).toBe(true);
  });
});
