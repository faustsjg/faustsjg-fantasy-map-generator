import { describe, expect, it } from "vitest";
import { CELLS_DENSITY_MAP, scaledCount } from "./detail-expander";

describe("CELLS_DENSITY_MAP", () => {
  it("is monotonically increasing across its 13 levels", () => {
    const values = Object.keys(CELLS_DENSITY_MAP)
      .map(Number)
      .sort((a, b) => a - b)
      .map(level => CELLS_DENSITY_MAP[level]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });
});

describe("scaledCount", () => {
  it("leaves the count unchanged when density doesn't grow", () => {
    expect(scaledCount(12, 10000, 10000, 100)).toBe(12);
  });

  it("grows the count sublinearly with density, not 1:1", () => {
    const result = scaledCount(10, 10000, 60000, 100);
    // 6x density should grow the count, but nowhere near 6x (60)
    expect(result).toBeGreaterThan(10);
    expect(result).toBeLessThan(30);
  });

  it("never exceeds the given max", () => {
    expect(scaledCount(90, 10000, 100000, 100)).toBeLessThanOrEqual(100);
  });

  it("rounds to a whole number", () => {
    expect(Number.isInteger(scaledCount(11, 10000, 45000, 999))).toBe(true);
  });
});
