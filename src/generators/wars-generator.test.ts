import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// gauss() is backed by d3's randomNormal, which uses rejection sampling internally - mocking
// Math.random to a constant (the usual trick elsewhere in this suite, to force deterministic P()
// outcomes) can make that sampling spin forever. Stub the export directly instead, so each test
// picks its own power-ratio threshold without ever touching Math.random.
vi.mock("@/utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@/utils")>();
  return { ...actual, gauss: vi.fn() };
});

import { gauss } from "@/utils";
import { Wars } from "./wars-generator";

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    i: 1,
    name: "Bigland",
    fullName: "Bigland",
    area: 1000,
    expansionism: 5,
    capital: 1,
    removed: false,
    campaigns: [],
    ...overrides
  };
}

function makeProvince(overrides: Record<string, unknown> = {}) {
  return { i: 1, state: 1, removed: false, ...overrides };
}

describe("WarsModule.resolveCampaigns", () => {
  let collectStatistics: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.options = { year: 1000 } as any;
    collectStatistics = vi.fn();
    globalThis.window = globalThis.window || ({} as any);
    globalThis.window.States = { collectStatistics } as any;
    (gauss as any).mockReturnValue(1); // low power-ratio threshold: attacker just needs to be stronger
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("annexes up to a third of the defender's bordering provinces, leaving the rest untouched", () => {
    const attacker = makeState({
      i: 1,
      campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }]
    });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 4, state: 2 }],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1 }),
        makeProvince({ i: 2, state: 2 }), // borders the attacker (via cell 2 - cell 1)
        makeProvince({ i: 3, state: 2 }), // also borders the attacker (via cell 3 - cell 1)
        makeProvince({ i: 4, state: 2 }) // interior - only touches province 3, never the attacker
      ],
      cells: {
        i: [0, 1, 2, 3, 4],
        c: [[], [2, 3], [1], [1, 4], [3]],
        state: [0, 1, 2, 2, 2],
        province: [0, 1, 2, 3, 4]
      }
    } as any;

    Wars.resolveCampaigns();

    // 2 bordering provinces, ceil(2/3) = 1 taken - the first one in iteration order
    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.provinces[2].annexedYear).toBe(1000); // freshly conquered - a rebellion risk factor
    expect(globalThis.pack.provinces[3].state).toBe(2);
    expect(globalThis.pack.provinces[3].annexedYear).toBeUndefined();
    expect(globalThis.pack.provinces[4].state).toBe(2);
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 1, 1, 2, 2]);
    expect(defender.removed).toBeFalsy();
    expect(collectStatistics).toHaveBeenCalledTimes(1);
  });

  it("fully absorbs the defender once its last province falls", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 5, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.burgs[2].state).toBe(1);
    expect(defender.removed).toBe(true);
    expect(attacker.fullName).toBe("Bigland (absorbed Smallland)");
  });

  it("replaces any earlier absorption/rebellion tag instead of piling a new one on top of it", () => {
    const attacker = makeState({
      i: 1,
      fullName: "Bigland (rebelled against Oldland) (absorbed Midland)", // simulates two prior eras' worth of tags
      campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }]
    });
    const defender = makeState({ i: 2, name: "Smallland", area: 5, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(attacker.fullName).toBe("Bigland (absorbed Smallland)");
  });

  it("does not take territory when the attacker isn't decisively stronger", () => {
    (gauss as any).mockReturnValue(10); // max threshold: attacker would need to be 10x the defender's power

    const attacker = makeState({
      i: 1,
      area: 20,
      expansionism: 1,
      campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }]
    });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(defender.removed).toBeFalsy();
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("does not take territory from a state it doesn't actually share a border with", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      // cell 1 and cell 2 list no neighbors - the two states don't actually touch
      cells: { i: [0, 1, 2], c: [[], [], []], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(defender.removed).toBeFalsy();
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("ignores lore campaigns that already carry an end year, resolving only live wars", () => {
    const attacker = makeState({
      i: 1,
      campaigns: [{ name: "The Old War", start: 900, end: 950, attacker: 1, defender: 2 }]
    });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("resolves a war once even though the same Campaign object sits in both sides' arrays", () => {
    const campaign = { name: "War", start: 1000, attacker: 1, defender: 2 };
    const attacker = makeState({ i: 1, campaigns: [campaign] });
    const defender = makeState({
      i: 2,
      name: "Smallland",
      area: 10,
      expansionism: 1,
      capital: 2,
      campaigns: [campaign] // same reference, exactly as states-generator.ts pushes it onto both sides
    });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(defender.removed).toBe(true);
    expect(collectStatistics).toHaveBeenCalledTimes(1);
  });
});
