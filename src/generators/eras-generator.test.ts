import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { survivalChance } from "./eras-generator";

// ErasModule's own tests are about state locking and name drift, not dynasty succession (that's
// covered in characters-generator.test.ts) - stub it out so these tests don't need a full
// Names/pack.characters fixture just to avoid crashing.
vi.mock("./characters-generator", () => ({
  Characters: { applySuccession: vi.fn() }
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

    // P() delegates to Math.random() internally (it's a real import, not a
    // stubbable global) — forcing random() to 0 makes every P(probability > 0)
    // call deterministically true, since survivalChance never returns exactly 0.
    vi.spyOn(Math, "random").mockReturnValue(0);

    globalThis.window = globalThis.window || ({} as any);
    regenerate = vi.fn();
    globalThis.window.States = { regenerate, getFullName: (s: any) => s.name } as any;

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      states: [
        { i: 0, name: "Neutrals" },
        { i: 1, name: "Big", area: 90, culture: 0 },
        { i: 2, name: "Small", area: 10, culture: 0 }
      ],
      burgs: [
        { i: 0 },
        { i: 1, capital: 1, population: 20, cell: 1 },
        { i: 2, capital: 0, population: 1, cell: 3 }
      ],
      cells: { state: [0, 1, 1, 2], burg: [0, 1, 0, 2] }
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
});
