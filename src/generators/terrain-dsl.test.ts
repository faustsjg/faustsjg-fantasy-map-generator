import { describe, expect, it } from "vitest";
import { formatTerrainDsl, parseTerrainDsl, type TerrainBounds } from "./terrain-dsl";

const bounds: TerrainBounds = { xMin: 30, xMax: 60, yMin: 20, yMax: 50 };

describe("parseTerrainDsl", () => {
  it("accepts a well-formed Hill line unchanged", () => {
    const { steps, rejected } = parseTerrainDsl("Hill 1 90-100 40-50 30-40", bounds);
    expect(rejected).toEqual([]);
    expect(steps).toEqual([{ tool: "Hill", a2: "1", a3: "90-100", a4: "40-50", a5: "30-40" }]);
  });

  it("rejects an unknown tool", () => {
    const { steps, rejected } = parseTerrainDsl("Volcano 1 90 50 50", bounds);
    expect(steps).toEqual([]);
    expect(rejected).toEqual([{ line: "Volcano 1 90 50 50", reason: 'unknown tool "Volcano"' }]);
  });

  it("rejects a line that doesn't have exactly 5 fields", () => {
    const { steps, rejected } = parseTerrainDsl("Hill 1 90 50", bounds);
    expect(steps).toEqual([]);
    expect(rejected[0].reason).toMatch(/expected 5 fields/);
  });

  it("drops lines beyond the max line count", () => {
    const manyLines = Array.from({ length: 15 }, () => "Hill 1 50 45-55 45-55").join("\n");
    const { steps, rejected } = parseTerrainDsl(manyLines, bounds);
    expect(steps).toHaveLength(10);
    expect(rejected).toHaveLength(5);
    expect(rejected[0].reason).toMatch(/more than 10 lines/);
  });

  it("clamps rangeX/rangeY into the given bounds, this is the core safety property", () => {
    const { steps } = parseTerrainDsl("Hill 1 90 0-100 0-100", bounds);
    expect(steps[0].a4).toBe("30-60");
    expect(steps[0].a5).toBe("20-50");
  });

  it("clamps a single-point range to a lo-hi pair within bounds", () => {
    const { steps } = parseTerrainDsl("Hill 1 90 200 -50", bounds);
    expect(steps[0].a4).toBe("60-60"); // 200 clamped down to xMax
    expect(steps[0].a5).toBe("20-20"); // -50 clamped up to yMin
  });

  it("swaps a reversed range before clamping", () => {
    const { steps } = parseTerrainDsl("Hill 1 90 55-45 45-40", bounds);
    expect(steps[0].a4).toBe("45-55");
    expect(steps[0].a5).toBe("40-45");
  });

  it("clamps count above the max and rejects a non-numeric count", () => {
    const clamped = parseTerrainDsl("Hill 999 50 45-55 45-55", bounds);
    expect(clamped.steps[0].a2).toBe("20");

    const invalid = parseTerrainDsl("Hill abc 50 45-55 45-55", bounds);
    expect(invalid.steps).toEqual([]);
    expect(invalid.rejected[0].reason).toMatch(/invalid count/);
  });

  it("clamps height into 0-100", () => {
    const { steps } = parseTerrainDsl("Hill 1 500 45-55 45-55", bounds);
    expect(steps[0].a3).toBe("100");
  });

  it("validates Strait direction and rejects an invalid one", () => {
    const valid = parseTerrainDsl("Strait 2 vertical 0 0", bounds);
    expect(valid.steps).toEqual([{ tool: "Strait", a2: "2", a3: "vertical", a4: "0", a5: "0" }]);

    const invalid = parseTerrainDsl("Strait 2 diagonal 0 0", bounds);
    expect(invalid.steps).toEqual([]);
    expect(invalid.rejected[0].reason).toMatch(/invalid direction/);
  });

  it("clamps Mask power into -10..10", () => {
    const { steps } = parseTerrainDsl("Mask 999 0 0 0", bounds);
    expect(steps[0].a2).toBe("10");
  });

  it("validates Invert axes and clamps probability into 0..1", () => {
    const { steps } = parseTerrainDsl("Invert 5 both 0 0", bounds);
    expect(steps[0].a2).toBe("1");
    expect(steps[0].a3).toBe("both");

    const invalid = parseTerrainDsl("Invert 0.5 diagonal 0 0", bounds);
    expect(invalid.rejected[0].reason).toMatch(/invalid axes/);
  });

  it("accepts Add/Multiply with the all/land selectors untouched", () => {
    const { steps } = parseTerrainDsl("Add 7 all 0 0", bounds);
    expect(steps[0]).toEqual({ tool: "Add", a2: "7", a3: "all", a4: "0", a5: "0" });
  });

  it("clamps a numeric Add/Multiply selector as a 0-100 range, independent of the click bounds", () => {
    const { steps } = parseTerrainDsl("Multiply 5 200-300 0 0", bounds);
    // Add/Multiply selectors are a height range (0-100), not a map-position range,
    // so they are clamped to 0-100 rather than to the click bounds.
    expect(steps[0].a3).toBe("100-100");
  });

  it("clamps Add amount into -50..50 and Multiply amount into 0..2", () => {
    const add = parseTerrainDsl("Add 999 all 0 0", bounds);
    expect(add.steps[0].a2).toBe("50");

    const multiply = parseTerrainDsl("Multiply 999 land 0 0", bounds);
    expect(multiply.steps[0].a2).toBe("2");
  });

  it("clamps Smooth factor into 0..10", () => {
    const { steps } = parseTerrainDsl("Smooth 999 0 0 0", bounds);
    expect(steps[0].a2).toBe("10");
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const { steps } = parseTerrainDsl("\n  Hill 1 90 45-55 45-55  \n\n", bounds);
    expect(steps).toHaveLength(1);
  });

  it("strips markdown code fence lines instead of rejecting them", () => {
    const { steps, rejected } = parseTerrainDsl("```\nHill 1 90 45-55 45-55\n```", bounds);
    expect(steps).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it("strips a leading bullet or numbered-list marker before parsing a line", () => {
    const { steps } = parseTerrainDsl("- Hill 1 90 45-55 45-55\n2) Smooth 3 0 0 0", bounds);
    expect(steps).toHaveLength(2);
    expect(steps[0].tool).toBe("Hill");
    expect(steps[1].tool).toBe("Smooth");
  });

  it("uses the first 5 fields of a line that has a trailing comment", () => {
    const { steps, rejected } = parseTerrainDsl("Hill 1 90 40-50 30-40 // a central hill", bounds);
    expect(rejected).toEqual([]);
    expect(steps).toEqual([{ tool: "Hill", a2: "1", a3: "90", a4: "40-50", a5: "30-40" }]);
  });
});

describe("formatTerrainDsl", () => {
  it("reserializes validated steps back to the canonical DSL text", () => {
    const { steps } = parseTerrainDsl("Hill 1 90-100 0-100 0-100\nSmooth 3 0 0 0", bounds);
    expect(formatTerrainDsl(steps)).toBe("Hill 1 90-100 30-60 20-50\nSmooth 3 0 0 0");
  });
});
