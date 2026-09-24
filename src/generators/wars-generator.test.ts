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

  it("keeps a locked province through a full collapse, leaving the defender as a diminished rump state", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 5, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }, { i: 3, cell: 3, state: 2 }],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1 }), // attacker's own province
        makeProvince({ i: 2, state: 2 }), // the capital's own province, borders the attacker
        makeProvince({ i: 3, state: 2, lock: true }) // locked, isolated - not even up for consideration
      ],
      cells: { i: [0, 1, 2, 3], c: [[], [2], [1], []], state: [0, 1, 2, 2], province: [0, 1, 2, 3] }
    } as any;

    Wars.resolveCampaigns();

    // the capital's province falls, exactly as an unlocked defender's would
    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.burgs[2].state).toBe(1);
    // the locked province never changes hands, even though the state around it collapsed
    expect(globalThis.pack.provinces[3].state).toBe(2);
    expect(globalThis.pack.burgs[3].state).toBe(2);
    expect(globalThis.pack.cells.state[3]).toBe(2);
    // it still owns that one province, so it's diminished, not erased
    expect(defender.removed).toBeFalsy();
    expect(attacker.fullName).not.toContain("absorbed");
    // and it moves its capital to the burg it still holds, instead of pointing at the attacker's
    expect(defender.capital).toBe(3);
    expect((defender as any).center).toBe(3);
    expect(globalThis.pack.burgs[3].capital).toBe(1);
    expect(globalThis.pack.burgs[2].capital).toBe(0);
  });

  it("leaves a locked burg behind as an enclave of the defender when its province is annexed", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [
        0 as any,
        { i: 1, cell: 1, state: 1 },
        { i: 2, cell: 4, state: 2 }, // defender's capital, in the interior province
        { i: 3, cell: 3, state: 2, lock: true }, // locked, inside the bordering province
        { i: 4, cell: 2, state: 2 } // the bordering province's own (unlocked) seat
      ],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1 }),
        makeProvince({ i: 2, state: 2, burg: 4 }), // borders the attacker
        makeProvince({ i: 3, state: 2, burg: 2 })
      ],
      cells: {
        i: [0, 1, 2, 3, 4],
        c: [[], [2], [1, 3], [2, 4], [3]],
        state: [0, 1, 2, 2, 2],
        province: [0, 1, 2, 2, 3]
      }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.burgs[4].state).toBe(1);
    // the locked burg's cell stays with the defender, detached from the now-foreign province
    expect(globalThis.pack.burgs[3].state).toBe(2);
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 1, 1, 2, 2]);
    expect(globalThis.pack.cells.province[3]).toBe(0);
  });

  it("never takes a province whose seat burg is locked", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 10, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [
        0 as any,
        { i: 1, cell: 1, state: 1 },
        { i: 2, cell: 4, state: 2 },
        { i: 3, cell: 2, state: 2, lock: true }
      ],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1 }),
        makeProvince({ i: 2, state: 2, burg: 3 }), // borders the attacker, but its seat burg is locked
        makeProvince({ i: 3, state: 2 }) // also borders the attacker, unlocked
      ],
      cells: { i: [0, 1, 2, 3], c: [[], [2, 3], [1], [1]], state: [0, 1, 2, 2], province: [0, 1, 2, 3] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(globalThis.pack.burgs[3].state).toBe(2);
    expect(globalThis.pack.provinces[3].state).toBe(1);
  });

  it("keeps a defender alive as a rump state when only a locked burg survives its collapse", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({ i: 2, name: "Smallland", area: 5, expansionism: 1, capital: 2, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [
        0 as any,
        { i: 1, cell: 1, state: 1 },
        { i: 2, cell: 2, state: 2 },
        { i: 3, cell: 3, state: 2, lock: true }
      ],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2, burg: 2 })],
      cells: { i: [0, 1, 2, 3], c: [[], [2], [1, 3], [2]], state: [0, 1, 2, 2], province: [0, 1, 2, 2] }
    } as any;

    Wars.resolveCampaigns();

    // its only province (and capital) fell, but the locked burg held on
    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.burgs[3].state).toBe(2);
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 1, 1, 2]);
    expect(defender.removed).toBeFalsy();
    expect(attacker.fullName).not.toContain("absorbed");
    // the locked burg becomes the rump state's new capital
    expect(defender.capital).toBe(3);
    expect(globalThis.pack.burgs[3].capital).toBe(1);
  });

  it("leaves a userLocked defender fully untouched, even when it would otherwise be fully absorbed", () => {
    const attacker = makeState({ i: 1, campaigns: [{ name: "War", start: 1000, attacker: 1, defender: 2 }] });
    const defender = makeState({
      i: 2,
      name: "Smallland",
      area: 5,
      expansionism: 1,
      capital: 2,
      campaigns: [],
      userLocked: true
    });

    globalThis.pack = {
      states: [0 as any, attacker, defender],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 }), makeProvince({ i: 2, state: 2 })],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], state: [0, 1, 2], province: [0, 1, 2] }
    } as any;

    Wars.resolveCampaigns();

    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(globalThis.pack.burgs[2].state).toBe(2);
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 1, 2]);
    expect(defender.removed).toBeFalsy();
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("skips an individually locked border province and takes another unlocked one instead", () => {
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
        makeProvince({ i: 2, state: 2, lock: true }), // borders the attacker (cell 2 - cell 1), but locked
        makeProvince({ i: 3, state: 2 }) // also borders the attacker (cell 3 - cell 1), unlocked
      ],
      cells: {
        i: [0, 1, 2, 3],
        c: [[], [2, 3], [1], [1]],
        state: [0, 1, 2, 2],
        province: [0, 1, 2, 3]
      }
    } as any;

    Wars.resolveCampaigns();

    // the locked province is excluded from the border set entirely, so the unlocked one is taken
    expect(globalThis.pack.provinces[2].state).toBe(2);
    expect(globalThis.pack.provinces[2].annexedYear).toBeUndefined();
    expect(globalThis.pack.provinces[3].state).toBe(1);
    expect(globalThis.pack.provinces[3].annexedYear).toBe(1000);
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

  it("combines every defender fully absorbed in the same resolveCampaigns() call into one annotation", () => {
    const attacker = makeState({
      i: 1,
      campaigns: [
        { name: "War1", start: 1000, attacker: 1, defender: 2 },
        { name: "War2", start: 1000, attacker: 1, defender: 3 }
      ]
    });
    const defender2 = makeState({ i: 2, name: "Smallland", area: 5, expansionism: 1, capital: 2, campaigns: [] });
    const defender3 = makeState({ i: 3, name: "Tinyland", area: 5, expansionism: 1, capital: 3, campaigns: [] });

    globalThis.pack = {
      states: [0 as any, attacker, defender2, defender3],
      burgs: [0 as any, { i: 1, cell: 1, state: 1 }, { i: 2, cell: 2, state: 2 }, { i: 3, cell: 3, state: 3 }],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1 }),
        makeProvince({ i: 2, state: 2 }),
        makeProvince({ i: 3, state: 3 })
      ],
      cells: { i: [0, 1, 2, 3], c: [[], [2, 3], [1], [1]], state: [0, 1, 2, 3], province: [0, 1, 2, 3] }
    } as any;

    Wars.resolveCampaigns();

    expect(defender2.removed).toBe(true);
    expect(defender3.removed).toBe(true);
    // both absorptions happened in this one call - neither should be lost to the other overwriting it
    expect(attacker.fullName).toBe("Bigland (absorbed Smallland, absorbed Tinyland)");
    expect(collectStatistics).toHaveBeenCalledTimes(1);
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
