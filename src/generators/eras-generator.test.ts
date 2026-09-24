import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { survivalChance } from "./eras-generator";

// ErasModule's own tests are about state locking and name drift, not dynasty succession (that's
// covered in characters-generator.test.ts) - stub it out so these tests don't need a full
// Names/pack.characters fixture just to avoid crashing.
vi.mock("./characters-generator", () => ({
  Characters: { applySuccession: vi.fn() }
}));

// gauss() is backed by d3's randomNormal, which uses rejection sampling internally - with
// Math.random forced to a constant below (the usual trick to make every P() call deterministic),
// that sampling spins forever instead of terminating. Stub it to just return its own "expected"
// (mean) argument, exactly like wars-generator.test.ts does for the same reason - deterministic,
// and each test can still override it with mockReturnValueOnce/mockImplementation as needed.
vi.mock("@/utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@/utils")>();
  return { ...actual, gauss: vi.fn((expected: number) => expected) };
});

// Rebellions.resolve() runs for real here (not mocked) and its secede() builds a real heraldic
// design via Emblems.generate() when a province actually breaks away - which internally
// rejection-samples a few "pick again if it collides" tinctures (getTincture/replaceTincture in
// emblems-generator.ts). Fine with real Math.random, but this file pins Math.random to a constant
// (0.045) below, so a "random" reroll would return the exact same value forever, hanging the loop.
// This file isn't testing heraldry, so stub it the same way it already stubs out gauss() above.
vi.mock("@/generators/emblems-generator", () => ({
  Emblems: { generate: vi.fn(() => ({ t1: "or" })) }
}));

describe("survivalChance", () => {
  it("gives the dominant state in a two-state world a high but capped chance", () => {
    expect(survivalChance(90, 100, 2)).toBe(0.9);
  });

  it("gives a tiny state a low but non-zero chance, never below the floor", () => {
    // share 0.001, count 5 -> 0.001 * 5 * 0.6 = 0.003, clamped up to the 0.05 floor
    expect(survivalChance(1, 1000, 5)).toBe(0.05);
  });

  it("scales with relative share for a mid-size state", () => {
    // share 0.25, count 4 -> 0.25 * 4 * 0.6 = 0.6
    expect(survivalChance(25, 100, 4)).toBeCloseTo(0.6, 5);
  });

  it("returns 0 when there is no settled area or no states", () => {
    expect(survivalChance(0, 0, 4)).toBe(0);
    expect(survivalChance(10, 100, 0)).toBe(0);
  });

  it("lets a strong military push survival past the pure area-based ceiling", () => {
    // area alone caps at 0.9 (share 0.9, count 2); 3x the average garrison adds the full +0.3 bonus
    expect(survivalChance(90, 100, 2, 3)).toBe(0.95);
  });

  it("lets a weak military pull survival below what area alone would give", () => {
    // share 0.25, count 4 -> 0.6 unclamped; no army at all (ratio 0) subtracts the full 0.15
    expect(survivalChance(25, 100, 4, 0)).toBeCloseTo(0.45, 5);
  });

  it("has no effect when militaryRatio is omitted or exactly average (1)", () => {
    expect(survivalChance(25, 100, 4)).toBe(survivalChance(25, 100, 4, 1));
  });
});

describe("ErasModule.generate", () => {
  let ErasModule: any;
  let regenerate: ReturnType<typeof vi.fn>;
  let applySuccession: any;

  beforeEach(async () => {
    vi.resetModules();

    // P() delegates to Math.random() internally (it's a real import, not a stubbable global) -
    // 0.045 sits just below every probability an existing test relies on succeeding (survivalChance's
    // own floor is 0.05, the next-smallest anywhere in this file), so P(probability >= 0.05) is still
    // deterministically true everywhere it used to be, but the rare Great Pandemic roll (~3.9%/era at
    // the default 100 years/era) deterministically does NOT fire by default - tests that specifically
    // want it to fire override this with their own mockReturnValue(0).
    // CAUTION: this only holds for yearsPerEra up to ~115 - the pandemic's per-era chance grows with
    // yearsPerEra (1 - (1 - 0.0004) ** yearsPerEra), and crosses 0.045 around 115 years/era. A test
    // calling ErasModule.generate() with a longer era span than that would need its own explicit
    // pandemic-suppressing mock, or it'll intermittently pick up an unwanted pandemic.
    vi.spyOn(Math, "random").mockReturnValue(0.045);

    globalThis.window = globalThis.window || ({} as any);
    regenerate = vi.fn();
    globalThis.window.States = { regenerate, getFullName: (s: any) => s.name, collectStatistics: vi.fn() } as any;
    // growPopulation() recomputes each burg's icon-size group (defineGroup()) every era - this
    // file is about population/succession math, not burg-group thresholds, so stub it a no-op
    globalThis.window.Burgs = { defineGroup: vi.fn() } as any;

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      states: [
        { i: 0, name: "Neutrals" },
        { i: 1, name: "Big", area: 90, culture: 0, pollTax: 0 },
        { i: 2, name: "Small", area: 10, culture: 0, pollTax: 0 }
      ],
      burgs: [
        { i: 0 },
        { i: 1, capital: 1, population: 20, cell: 1, state: 1 },
        { i: 2, capital: 0, population: 1, cell: 3, state: 2 }
      ],
      cells: {
        i: [0, 1, 2, 3],
        state: [0, 1, 1, 2],
        burg: [0, 1, 0, 2],
        h: [0, 50, 50, 50],
        area: [0, 10, 10, 10],
        s: [0, 10, 10, 10],
        pop: [0, 5, 5, 5],
        culture: [0, 0, 0, 0]
      },
      provinces: []
    } as any;

    await import("./eras-generator");
    ErasModule = (globalThis as any).window.Eras;
    // the mocked module instance persists across vi.resetModules() calls, so re-resolve it (to
    // stay bound to whatever eras-generator itself resolved) and clear its call history
    applySuccession = (await import("./characters-generator")).Characters.applySuccession;
    applySuccession.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns nothing and leaves options.year untouched for eraCount < 1", () => {
    const eras = ErasModule.generate(0, 100);
    expect(eras).toEqual([]);
    expect(regenerate).not.toHaveBeenCalled();
    expect(globalThis.options.year).toBe(1000);
  });

  it("takes an immediate snapshot for a single era without calling regenerate", () => {
    const eras = ErasModule.generate(1, 100);
    expect(eras).toHaveLength(1);
    expect(eras[0].year).toBe(1000);
    expect(eras[0].cellsState).toEqual([0, 1, 1, 2]);
    expect(regenerate).not.toHaveBeenCalled();
    expect(globalThis.pack.eras).toBe(eras);
  });

  it("snapshots pack.provinces/cells.province per era, not just states/cellsState", () => {
    globalThis.pack.provinces = [0, { i: 1, name: "Homeshire" }] as any;
    globalThis.pack.cells.province = [0, 1, 1, 1] as any;

    // States.regenerate() also rebuilds provinces every era it succeeds (Provinces.regenerate) -
    // simulate that side effect so the snapshot has something new to actually capture
    regenerate.mockImplementation(() => {
      globalThis.pack.provinces = [0, { i: 1, name: "Splitshire" }, { i: 2, name: "Homeshire" }] as any;
      globalThis.pack.cells.province = [0, 1, 1, 2] as any;
      return {};
    });

    const eras = ErasModule.generate(2, 100);

    expect(eras[0].provinces).toEqual([0, { i: 1, name: "Homeshire" }]);
    expect(eras[0].cellsProvince).toEqual([0, 1, 1, 1]);
    expect(eras[1].provinces).toEqual([0, { i: 1, name: "Splitshire" }, { i: 2, name: "Homeshire" }]);
    expect(eras[1].cellsProvince).toEqual([0, 1, 1, 2]);
  });

  it("snapshots pack.burgs per era, capturing this era's own pruning/renaming/capital changes", () => {
    // era 1's applySuccession() prunes burg 2 (population 1, non-capital, P(0.15) forced true) and
    // drifts names - the snapshot must reflect burg 2 as still present (unpruned) in era 0, and
    // removed in era 1, not whatever pack.burgs ends up looking like after every era has run
    const eras = ErasModule.generate(2, 100);

    expect(eras[0].burgs.find((b: any) => b.i === 2)?.removed).toBeFalsy();
    expect(eras[1].burgs.find((b: any) => b.i === 2)?.removed).toBe(true);
    // the live pack.burgs array is the same one that was cloned into era 1, not a shared reference
    expect(eras[1].burgs).not.toBe(globalThis.pack.burgs);
  });

  it("advances the year and calls States.regenerate once per extra era", () => {
    const eras = ErasModule.generate(3, 50);
    expect(eras.map((e: any) => e.year)).toEqual([1000, 1050, 1100]);
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it("calls Characters.applySuccession once per extra era, after States.regenerate, with the era length", () => {
    ErasModule.generate(3, 50);
    expect(applySuccession).toHaveBeenCalledTimes(2);
    expect(applySuccession).toHaveBeenCalledWith(50);
  });

  it("stops generating further eras once States.regenerate reports every state locked, without advancing options.year for that attempt", () => {
    regenerate.mockReturnValueOnce({}).mockReturnValueOnce({ error: "Unable to regenerate as all states are locked" });

    const eras = ErasModule.generate(4, 50);

    // era 0 (immediate snapshot) + era 1 (regenerate succeeded) - era 2's regenerate failed, so
    // generation stops there instead of pushing a stale 3rd/4th era
    expect(eras.map((e: any) => e.year)).toEqual([1000, 1050]);
    expect(regenerate).toHaveBeenCalledTimes(2);
    // options.year should reflect only the eras actually generated, not the failed attempt
    expect(globalThis.options.year).toBe(1050);
    // the failed era never regenerated, so nothing downstream should run for it either
    expect(applySuccession).toHaveBeenCalledTimes(1);
  });

  it("rolls back applySuccession()'s in-place state/burg mutations when regenerate() aborts, leaving no trace of an era that never happened", () => {
    regenerate.mockReturnValueOnce({ error: "Unable to regenerate as all states are locked" });

    const eras = ErasModule.generate(2, 50);

    expect(eras).toHaveLength(1); // only the initial snapshot - the one attempted era never completed
    expect(globalThis.options.year).toBe(1000);
    // applySuccession() locked both states and removed the small non-capital burg before
    // regenerate() ever ran and aborted - all of that must be undone, not left dangling
    expect(globalThis.pack.states[1].lock).toBeUndefined();
    expect(globalThis.pack.states[2].lock).toBeUndefined();
    expect(globalThis.pack.burgs[2].removed).toBeUndefined();
  });

  it("locks every state when P() always succeeds, so all survive into the next era", () => {
    ErasModule.generate(2, 100);
    // both non-neutral states get evaluated for survival; with P() forced true both are locked
    expect(globalThis.pack.states[1].lock).toBe(true);
    expect(globalThis.pack.states[2].lock).toBe(true);
    // neutral state (i: 0) is never touched
    expect(globalThis.pack.states[0].lock).toBeUndefined();
  });

  it("keeps a user-locked state's lock true even when the survival roll would have failed", () => {
    globalThis.pack.states[1].lock = true;
    globalThis.pack.states[1].userLocked = true;
    // force every P() call to fail this once, overriding the beforeEach's always-succeed stub -
    // if applySuccession() rerolled state 1 despite userLocked, this would flip it to false
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    ErasModule.generate(2, 100);

    expect(globalThis.pack.states[1].lock).toBe(true);
    // the non-userLocked sibling still rerolls every era as before, and loses on a forced-fail roll
    expect(globalThis.pack.states[2].lock).toBe(false);
  });

  it("never removes a capital burg regardless of population", () => {
    ErasModule.generate(2, 100);
    const capital = globalThis.pack.burgs.find((b: any) => b.capital);
    expect(capital?.removed).toBeUndefined();
  });

  it("clears cells.burg for a pruned burg's cell, not just burg.removed", () => {
    // burg 2 (population 1, non-capital) is the one P(0.15) forced true prunes; its cell (3) must
    // stop pointing at it, or other systems reading cells.burg as "is there a burg here" (province
    // generation's own burg check, load.ts's data-integrity pass) would treat it as still standing
    ErasModule.generate(2, 100);
    expect(globalThis.pack.burgs[2].removed).toBe(true);
    expect(globalThis.pack.cells.burg[3]).toBe(0);
    // the surviving capital's own cell must be untouched
    expect(globalThis.pack.cells.burg[1]).toBe(1);
  });

  it("never abandons a province's seat burg, even a small non-capital one that would otherwise be pruned", () => {
    // burg 2 (population 1, non-capital) is pruned in the test above - but here it seats a province
    globalThis.pack.provinces = [0 as any, { i: 1, state: 2, burg: 2, name: "Smallshire" }];
    ErasModule.generate(2, 100);
    expect(globalThis.pack.burgs[2].removed).toBeUndefined();
    expect(globalThis.pack.cells.burg[3]).toBe(2);
  });

  it("never abandons a locked burg, even a small non-capital one that would otherwise be pruned", () => {
    globalThis.pack.burgs[2].lock = true; // population 1, non-capital - pruned in the test above
    ErasModule.generate(2, 100);
    expect(globalThis.pack.burgs[2].removed).toBeUndefined();
    expect(globalThis.pack.cells.burg[3]).toBe(2);
  });

  it("mutates a surviving state's name and keeps fullName in sync, when P() always succeeds", () => {
    ErasModule.generate(2, 100);
    // "Small" contains "ll", a rule toponym-drift always applies when it matches
    expect(globalThis.pack.states[2].name).toBe("Smal");
    expect(globalThis.pack.states[2].fullName).toBe("Smal");
  });

  it("mutates a surviving burg's name, capitals included, when P() always succeeds", () => {
    globalThis.pack.burgs[1].name = "Small Port"; // the capital burg
    ErasModule.generate(2, 100);
    expect(globalThis.pack.burgs[1].name).toBe("Smal Port");
  });

  it("never drifts the name of a user-locked state, even when P() always succeeds", () => {
    globalThis.pack.states[2].lock = true;
    globalThis.pack.states[2].userLocked = true;
    ErasModule.generate(2, 100);
    // "Small" would drift to "Smal" (see the test above) if it weren't locked
    expect(globalThis.pack.states[2].name).toBe("Small");
  });

  it("never drifts the name of a locked burg, even when P() always succeeds", () => {
    globalThis.pack.burgs[1].name = "Small Port";
    globalThis.pack.burgs[1].lock = true;
    ErasModule.generate(2, 100);
    expect(globalThis.pack.burgs[1].name).toBe("Small Port");
  });

  it("leaves names and locks untouched when P() always fails", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    ErasModule.generate(2, 100);
    expect(globalThis.pack.states[1].lock).toBe(false);
    expect(globalThis.pack.states[2].lock).toBe(false);
    expect(globalThis.pack.states[1].name).toBe("Big");
    expect(globalThis.pack.states[2].name).toBe("Small");
  });

  it("lets a well-garrisoned state survive while an equally-sized, undefended one doesn't", () => {
    // both states have the same area/share (0.6 area-based chance each) - only military differs
    globalThis.pack.states[1] = { i: 1, name: "Big", area: 50, culture: 0, military: [{ t: 100 }] } as any;
    globalThis.pack.states[2] = { i: 2, name: "Small", area: 50, culture: 0 } as any; // no army at all
    vi.spyOn(Math, "random").mockReturnValue(0.5); // between Small's 0.45 and Big's 0.75

    ErasModule.generate(2, 100);

    expect(globalThis.pack.states[1].lock).toBe(true);
    expect(globalThis.pack.states[2].lock).toBe(false);
  });

  it("grows rural population faster than urban, each by its own compounded per-year rate", () => {
    ErasModule.generate(2, 100);

    // gauss() is stubbed to return its own mean - rural 0.3%/year, urban 0.15%/year, both
    // compounded over the era's 100 years
    const ruralFactor = (1 + 0.3 / 100) ** 100;
    const urbanFactor = (1 + 0.15 / 100) ** 100;
    expect(globalThis.pack.cells.pop[1]).toBeCloseTo(5 * ruralFactor, 2);
    expect(globalThis.pack.burgs[1].population).toBeCloseTo(20 * urbanFactor, 1);
  });

  it("applies war-devastation population loss instead of growth for a province annexed this era", () => {
    // burg 1 sits on cell 1, which this province covers - cell 2 (same state, no province link)
    // is left out on purpose, to prove only the actually-annexed province's population takes the hit
    globalThis.pack.provinces = [0, { i: 1, state: 1, removed: false, annexedYear: 1100, burg: 1 }] as any;
    globalThis.pack.cells.province = [0, 1, 0, 0] as any;

    ErasModule.generate(2, 100); // options.year becomes 1000 + 100 = 1100, matching annexedYear above

    // gauss() stubbed to its own mean - war retention mean is 0.72 (72% kept, 28% lost to war and
    // the disease that follows it), overriding growth entirely rather than combining with it
    expect(globalThis.pack.cells.pop[1]).toBeCloseTo(5 * 0.72, 3);
    expect(globalThis.pack.burgs[1].population).toBeCloseTo(20 * 0.72, 3);
    // cell 2 has no province link, so it grows normally instead of taking the war penalty
    const ruralFactor = (1 + 0.3 / 100) ** 100;
    expect(globalThis.pack.cells.pop[2]).toBeCloseTo(5 * ruralFactor, 2);
  });

  it("assimilates a province's culture once it's spent long enough under foreign rule", () => {
    globalThis.pack.states[1].culture = 5;
    globalThis.pack.burgs[1].culture = 5; // the state's own capital, already matching
    globalThis.pack.burgs[2].culture = 9; // the conquered province's own (foreign) culture
    globalThis.pack.burgs[2].population = 10; // kept well above the small-burg pruning threshold
    // 350 years under foreign rule already, before this era even starts - well past the 300-year minimum
    globalThis.pack.provinces = [0, { i: 1, state: 1, removed: false, burg: 2, annexedYear: 1000 - 350 }] as any;
    globalThis.pack.cells.province = [0, 0, 0, 1] as any;
    globalThis.pack.cells.culture = [0, 5, 5, 9] as any;

    ErasModule.generate(2, 100);

    expect(globalThis.pack.burgs[2].culture).toBe(5);
    expect(globalThis.pack.cells.culture[3]).toBe(5);
  });

  it("does not assimilate a province annexed too recently", () => {
    globalThis.pack.states[1].culture = 5;
    globalThis.pack.burgs[1].culture = 5;
    globalThis.pack.burgs[2].culture = 9;
    globalThis.pack.burgs[2].population = 10; // kept well above the small-burg pruning threshold
    // only 50 years under foreign rule by the time this era runs (1100 - 1050) - short of the 300-year minimum
    globalThis.pack.provinces = [0, { i: 1, state: 1, removed: false, burg: 2, annexedYear: 1050 }] as any;
    globalThis.pack.cells.province = [0, 0, 0, 1] as any;
    globalThis.pack.cells.culture = [0, 5, 5, 9] as any;

    ErasModule.generate(2, 100);

    expect(globalThis.pack.burgs[2].culture).toBe(9);
    expect(globalThis.pack.cells.culture[3]).toBe(9);
  });

  it("triggers a subsistence crisis once a state's population presses against its own carrying-capacity ceiling", () => {
    // repeated growth (rural 0.3%/year, compounded over 100 years each era) eventually pushes
    // state 1 up against the ceiling generate() captured at the very start (3x its starting
    // population) - once close enough, a subsistence crisis should fire and knock it back down
    const eras = ErasModule.generate(8, 100);

    const crisisEras = eras.filter((e: any) =>
      e.epidemicEvents.some((line: string) => line.includes("subsistence crisis"))
    );
    expect(crisisEras.length).toBeGreaterThan(0);
  });

  it("triggers a great pandemic that starts at a port state and spreads to its neighbors at reduced severity", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // this test wants every roll, including the rare pandemic, to fire

    globalThis.pack.burgs[1].port = 1; // state 1's capital is the only port - must become the epicenter
    globalThis.pack.states[1].neighbors = [2];
    globalThis.pack.states[2].neighbors = [1];

    const eras = ErasModule.generate(2, 100);

    const pandemicLine = eras[1].epidemicEvents.find((line: string) => line.includes("pandemic"));
    expect(pandemicLine).toContain("Big"); // fullName falls back to name; "Big" is state 1's fixture name
    expect(pandemicLine).toContain("spreads to 1 neighboring realm");

    // gauss() stubbed to its own mean (0.6 retention); state 1 (the epicenter, hop 0) takes the
    // full hit, state 2 (one hop out) is blended toward "no loss" by the spread falloff (0.7)
    const ruralFactor = (1 + 0.3 / 100) ** 100;
    expect(globalThis.pack.cells.pop[1]).toBeCloseTo(5 * ruralFactor * 0.6, 2);
    const state2Retention = 1 - (1 - 0.6) * 0.7;
    expect(globalThis.pack.cells.pop[3]).toBeCloseTo(5 * ruralFactor * state2Retention, 2);
  });
});
