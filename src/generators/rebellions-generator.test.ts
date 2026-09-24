import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rebellions } from "./rebellions-generator";

// secede()'s Emblems.generate() call builds a real heraldic design, which internally
// rejection-samples a few "pick again if it collides" tinctures (getTincture/replaceTincture in
// emblems-generator.ts) - fine with real Math.random, but this file pins Math.random to a
// constant (0.10) to make P() deterministic, and a constant means every "random" reroll returns
// the exact same value forever, hanging the loop. These tests are about rebellion/unrest logic,
// not heraldry, so stub it the same way eras-generator.test.ts stubs out gauss().
vi.mock("@/generators/emblems-generator", () => ({
  Emblems: { generate: vi.fn(() => ({ t1: "or" })) }
}));

// The "far province" (province 2) sits at the same spot, culture and landmass as the capital by
// default in every test - each test tweaks exactly one factor to isolate its effect. Math.random
// is pinned at 0.10 throughout: below the baseline chance (0.01) it would never trigger, but low
// enough that adding any single bonus (culture 0.10, distance 0.10, landmass 0.20, fresh
// annexation 0.25) always tips P() over the fixed threshold - a clean way to prove each bonus
// actually contributes, without needing to read the private formula directly.
function makePack(
  overrides: {
    province2Culture?: number;
    province2X?: number;
    province2F?: number;
    province2AnnexedYear?: number;
    province2Count?: number; // set to 1 to test the "single-province state" bail-out
    realmMilitary?: { t: number }[];
    rival?: { area: number; military?: { t: number }[] }; // a second state, purely to shift the era's average garrison
  } = {}
) {
  const provinces: any[] = [
    0 as any,
    { i: 1, state: 1, burg: 1, name: "Capitalshire", removed: false } // the capital's own province
  ];

  if (overrides.province2Count !== 1) {
    provinces.push({
      i: 2,
      state: 1,
      burg: 2,
      name: "Farshire",
      removed: false,
      annexedYear: overrides.province2AnnexedYear
    });
  }

  const states: any[] = [
    0 as any,
    {
      i: 1,
      name: "Realm",
      fullName: "Kingdom of Realm",
      area: 100, // typicalRadius = sqrt(100) = 10
      expansionism: 1,
      capital: 1,
      culture: 5,
      coa: {},
      formName: "Kingdom",
      salesTax: 0.1,
      pollTax: 0.1,
      treasury: 0,
      removed: false,
      military: overrides.realmMilitary
    }
  ];
  if (overrides.rival) {
    // capital 0 means no burg backs it (pack.burgs[0] is the dummy slot) - the rival is only
    // there to shift the era's average garrison, and is skipped by Rebellions' own per-state loop
    states.push({
      i: 2,
      name: "Rival",
      area: overrides.rival.area,
      expansionism: 1,
      capital: 0,
      culture: 5,
      coa: {},
      formName: "Kingdom",
      salesTax: 0.1,
      pollTax: 0.1,
      treasury: 0,
      removed: false,
      military: overrides.rival.military
    });
  }

  return {
    states,
    burgs: [
      0 as any,
      { i: 1, x: 0, y: 0, cell: 1, culture: 5, state: 1 }, // capital
      { i: 2, x: overrides.province2X ?? 0, y: 0, cell: 2, culture: overrides.province2Culture ?? 5, state: 1 }
    ],
    provinces,
    cells: {
      i: [0, 1, 2],
      province: [0, 1, 2],
      f: [0, 1, overrides.province2F ?? 1],
      state: [0, 1, 1]
    }
  } as any;
}

describe("RebellionsModule.resolve", () => {
  let collectStatistics: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.options = { year: 1000 } as any;
    collectStatistics = vi.fn();
    globalThis.window = globalThis.window || ({} as any);
    globalThis.window.States = { collectStatistics } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not secede at the baseline chance, with no unrest factor present", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // 0.10 >= base 0.01
    globalThis.pack = makePack();

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("secedes once a culture mismatch pushes the chance past the threshold", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // base(0.01) + culture(0.10) = 0.11 > 0.10
    globalThis.pack = makePack({ province2Culture: 9 });

    Rebellions.resolve();

    const rebelState = globalThis.pack.states[2];
    expect(rebelState).toBeDefined();
    expect(globalThis.pack.provinces[2].state).toBe(rebelState.i);
    expect(rebelState.fullName).toContain("rebelled against Realm");
    expect(collectStatistics).toHaveBeenCalledTimes(1);
  });

  it("secedes once distance from the capital, relative to realm size, pushes past the threshold", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // base(0.01) + max distance(0.10) = 0.11 > 0.10
    globalThis.pack = makePack({ province2X: 25 }); // 2.5x the typical radius (10)

    Rebellions.resolve();

    expect(globalThis.pack.states).toHaveLength(3);
    expect(globalThis.pack.provinces[2].state).toBe(2);
  });

  it("secedes once it sits on a different landmass than the capital", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // base(0.01) + island(0.20) = 0.21 > 0.10
    globalThis.pack = makePack({ province2F: 2 }); // capital is on landmass 1

    Rebellions.resolve();

    expect(globalThis.pack.states).toHaveLength(3);
    expect(globalThis.pack.provinces[2].state).toBe(2);
  });

  it("secedes once it was annexed this very era", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // base(0.01) + fresh annexation(0.25) = 0.26 > 0.10
    globalThis.pack = makePack({ province2AnnexedYear: 1000 }); // annexed at the current year - 0 years ago

    Rebellions.resolve();

    expect(globalThis.pack.states).toHaveLength(3);
    expect(globalThis.pack.provinces[2].state).toBe(2);
  });

  it("decays the recent-annexation bonus over time - too old to tip the threshold alone", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2); // base(0.01) + fully-decayed annexation(~0) = 0.01 < 0.20
    globalThis.pack = makePack({ province2AnnexedYear: 700 }); // 300 years ago, past the 150-year decay window

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
  });

  it("never lets the capital's own province rebel, no matter how high the chance", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() always succeeds - province 2 secedes, but province 1 (the capital's) must not
    globalThis.pack = makePack();

    Rebellions.resolve();

    expect(globalThis.pack.provinces[1].state).toBe(1); // capital's own province, untouched
    expect(globalThis.pack.states[1].removed).toBeFalsy();
  });

  it("never lets a locked province secede, even at a chance that would otherwise always succeed", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() always succeeds if evaluated
    globalThis.pack = makePack();
    globalThis.pack.provinces[2].lock = true;

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("never lets any province of a userLocked state secede, even at a chance that would otherwise always succeed", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() always succeeds if evaluated
    globalThis.pack = makePack();
    globalThis.pack.states[1].userLocked = true;

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("never lets a province secede when its seat burg is locked", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() always succeeds if evaluated
    globalThis.pack = makePack();
    globalThis.pack.burgs[2].lock = true; // province 2's seat

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
  });

  it("leaves a locked burg behind as an enclave of the crown when its province secedes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() always succeeds
    globalThis.pack = makePack();
    // a second, locked burg inside province 2 (not its seat)
    globalThis.pack.burgs.push({ i: 3, x: 0, y: 0, cell: 3, culture: 5, state: 1, lock: true } as any);
    globalThis.pack.cells = { i: [0, 1, 2, 3], province: [0, 1, 2, 2], f: [0, 1, 1, 1], state: [0, 1, 1, 1] } as any;

    Rebellions.resolve();

    const rebelState = globalThis.pack.states[2];
    expect(globalThis.pack.provinces[2].state).toBe(rebelState.i);
    expect(globalThis.pack.cells.state[2]).toBe(rebelState.i);
    // the locked burg stays with the crown, detached from the seceded province
    expect(globalThis.pack.cells.state[3]).toBe(1);
    expect(globalThis.pack.burgs[3].state).toBe(1);
    expect(globalThis.pack.cells.province[3]).toBe(0);
  });

  it("does not evaluate a state with fewer than two provinces", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // P() would always succeed if it were even called
    globalThis.pack = makePack({ province2Count: 1 });

    Rebellions.resolve();

    expect(globalThis.pack.states).toHaveLength(2);
    expect(collectStatistics).not.toHaveBeenCalled();
  });

  it("does not secede when the roll fails even with every bonus stacked", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    globalThis.pack = makePack({ province2Culture: 9, province2X: 25, province2F: 2, province2AnnexedYear: 1000 });

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1);
    expect(globalThis.pack.states).toHaveLength(2);
  });

  it("dampens even a fully-stacked unrest chance for a heavily garrisoned state", () => {
    // undampened, every bonus stacked would be 0.01+0.10+0.10+0.20+0.25 = 0.66 (clamped to the 0.65
    // ceiling if dampening were neutral). Rival has no army at all, so Realm's garrison (troops/area
    // = 1) is the only one counted twice as much as the era average (0.5) - the highest ratio two
    // states can produce (2), giving dampening 1-(2-1)*0.4=0.6 and a final chance of 0.66*0.6=0.396
    vi.spyOn(Math, "random").mockReturnValue(0.5); // between the dampened 0.396 and the undampened 0.65 ceiling
    globalThis.pack = makePack({
      province2Culture: 9,
      province2X: 25,
      province2F: 2,
      province2AnnexedYear: 1000,
      realmMilitary: [{ t: 100 }], // troops/area = 100/100 = 1
      rival: { area: 100 } // no military at all - troops/area = 0
    });

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(1); // did not secede - the garrison held it together
    expect(globalThis.pack.states).toHaveLength(3); // Realm + Rival only, no rebel state created
  });

  it("raises unrest for an undefended state relative to a well-armed rival", () => {
    // baseline-only chance is 0.01, which alone would never trigger at random()=0.012. Realm has no
    // army at all while Rival is well garrisoned, pulling Realm's ratio to 0 and the dampening to
    // 1-(0-1)*0.4=1.4: 0.01*1.4=0.014 - just enough to tip it
    vi.spyOn(Math, "random").mockReturnValue(0.012);
    globalThis.pack = makePack({
      rival: { area: 100, military: [{ t: 100 }] } // Realm has no military field at all
    });

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).toBe(3); // seceded into a new state (pushed after Rival, at index 3)
    expect(globalThis.pack.states).toHaveLength(4);
  });

  it("secedes an isolated province but not an equally-far, equally-culture-matched embedded one", () => {
    // P2 borders only foreign (state 2) provinces - 0 same-state neighbors. P3 borders P1 and P4,
    // both state 1 - 2 same-state neighbors. Average across every province on the map (P1..P6) is
    // 4/6 ≈ 0.667, so P2's ratio is 0 (full +0.04 isolation bonus) and P3's is 3 (clamped to no
    // bonus at all, at or above average). Neither has any other unrest factor present.
    vi.spyOn(Math, "random").mockReturnValue(0.03); // P2: base(0.01)+isolation(0.04)=0.05 > 0.03; P3: base(0.01) < 0.03
    globalThis.pack = {
      states: [
        0 as any,
        {
          i: 1,
          name: "Realm",
          fullName: "Kingdom of Realm",
          area: 100,
          expansionism: 1,
          capital: 1,
          culture: 5,
          coa: {},
          formName: "Kingdom",
          salesTax: 0.1,
          pollTax: 0.1,
          treasury: 0,
          removed: false
        },
        {
          i: 2,
          name: "Foreign",
          fullName: "Kingdom of Foreign",
          area: 100,
          expansionism: 1,
          capital: 5,
          culture: 5,
          coa: {},
          formName: "Kingdom",
          salesTax: 0.1,
          pollTax: 0.1,
          treasury: 0,
          removed: false
        }
      ],
      burgs: [
        0 as any,
        { i: 1, x: 0, y: 0, cell: 1, culture: 5, state: 1 }, // Realm's capital
        { i: 2, x: 0, y: 0, cell: 2, culture: 5, state: 1 }, // isolated - all-foreign neighbors
        { i: 3, x: 0, y: 0, cell: 3, culture: 5, state: 1 }, // embedded - all-same-state neighbors
        { i: 4, x: 0, y: 0, cell: 4, culture: 5, state: 1 },
        { i: 5, x: 0, y: 0, cell: 5, culture: 5, state: 2 }, // Foreign's capital
        { i: 6, x: 0, y: 0, cell: 6, culture: 5, state: 2 }
      ],
      provinces: [
        0 as any,
        { i: 1, state: 1, burg: 1, name: "Capitalshire", removed: false },
        { i: 2, state: 1, burg: 2, name: "Isolshire", removed: false },
        { i: 3, state: 1, burg: 3, name: "Coreshire", removed: false },
        { i: 4, state: 1, burg: 4, name: "Coreshire2", removed: false },
        { i: 5, state: 2, burg: 5, name: "Otherland", removed: false },
        { i: 6, state: 2, burg: 6, name: "Otherland2", removed: false }
      ],
      cells: {
        i: [0, 1, 2, 3, 4, 5, 6],
        c: [[], [3], [5, 6], [1, 4], [3], [2], [2]],
        province: [0, 1, 2, 3, 4, 5, 6],
        state: [0, 1, 1, 1, 1, 2, 2],
        f: [0, 1, 1, 1, 1, 1, 1]
      }
    } as any;

    Rebellions.resolve();

    expect(globalThis.pack.provinces[2].state).not.toBe(1); // isolated - seceded
    expect(globalThis.pack.provinces[3].state).toBe(1); // deeply embedded - stayed put
  });

  it("reassigns the seceding province's cells and burgs, and clears its annexedYear", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    globalThis.pack = makePack({ province2Culture: 9, province2AnnexedYear: 1000 });

    Rebellions.resolve();

    const rebelState = globalThis.pack.states[2];
    expect(globalThis.pack.cells.state[2]).toBe(rebelState.i);
    expect(globalThis.pack.burgs[2].state).toBe(rebelState.i);
    expect(globalThis.pack.provinces[2].annexedYear).toBeUndefined();
    expect(rebelState.capital).toBe(2); // the seceding province's own seat burg
  });
});
