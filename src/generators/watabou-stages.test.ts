import { describe, expect, it } from "vitest";
import { populationStage } from "./watabou-stages";

describe("populationStage", () => {
  it("keeps the same stage while the population drifts", () => {
    expect(populationStage(7)).toBe(8);
    expect(populationStage(8)).toBe(8);
    expect(populationStage(10)).toBe(8);
  });

  it("moves to the next stage once the population has roughly doubled", () => {
    expect(populationStage(12)).toBe(16);
    expect(populationStage(20)).toBe(16);
    expect(populationStage(23)).toBe(32);
  });

  it("works for hamlets below one thousand people too", () => {
    expect(populationStage(0.1)).toBe(0.125);
    expect(populationStage(0.4)).toBe(0.5);
  });

  it("leaves empty or missing populations alone", () => {
    expect(populationStage(0)).toBe(0);
    expect(populationStage(Number.NaN)).toBeNaN();
  });
});
