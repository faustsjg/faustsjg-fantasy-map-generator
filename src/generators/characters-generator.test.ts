import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMONER_ARCHETYPES } from "./characters-generator";

// trySplitRealm()'s Emblems.generate() call builds a real heraldic design, which internally
// rejection-samples a few "pick again if it collides" tinctures (getTincture/replaceTincture in
// emblems-generator.ts) - fine with real Math.random, but this file pins Math.random to a
// constant (0 or 0.99) to make P() deterministic, and a constant means every "random" reroll
// returns the exact same value forever, hanging the loop. These tests are about state-splitting
// logic, not heraldry, so stub it the same way eras-generator.test.ts stubs out gauss().
vi.mock("@/generators/emblems-generator", () => ({
  Emblems: { generate: vi.fn(() => ({ t1: "or" })) }
}));

function makeBurg(overrides: Record<string, unknown> = {}) {
  return { i: 1, name: "Testburg", x: 0, y: 0, cell: 1, culture: 1, population: 40, removed: false, ...overrides };
}

function makeState(overrides: Record<string, unknown> = {}) {
  const i = (overrides.i as number | undefined) ?? 1;
  return {
    i,
    persistentId: i, // defaults to match .i unless a test explicitly overrides it
    name: "Testland",
    culture: 1,
    capital: 1,
    formName: "Kingdom",
    removed: false,
    ...overrides
  };
}

function makeProvince(overrides: Record<string, unknown> = {}) {
  const i = (overrides.i as number | undefined) ?? 1;
  return {
    i,
    persistentId: i, // defaults to match .i unless a test explicitly overrides it
    state: 1,
    burg: 1,
    name: "Testshire",
    formName: "County",
    fullName: "Testshire County",
    removed: false,
    ...overrides
  };
}

describe("CharactersModule.generate", () => {
  let Characters: any;
  const originalRandom = Math.random;

  beforeEach(async () => {
    globalThis.Names = {
      getCulture: (culture: number) => `Person-${culture}`,
      getCultureShort: (culture: number) => `Short-${culture}`,
      getState: (name: string, culture: number) => `${name}Place-${culture}`
    } as any;
    const module = await import("./characters-generator");
    Characters = module.Characters;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it("creates a ruler for each state, named after the formName's title", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg()],
      states: [0 as any, makeState({ formName: "Kingdom" })],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const rulers = globalThis.pack.characters!.filter((c: any) => c.role.startsWith("King"));
    expect(rulers).toHaveLength(1);
    expect(rulers[0].role).toBe("King of Testland");
    expect(rulers[0].burg).toBe(1);
    expect(rulers[0].importance).toBe("notable");
    expect(rulers[0].dynasty).toBe("House of Short-1");
    expect(rulers[0].liege).toBeUndefined();
  });

  it("gives every notable character a starting age within a plausible young-adult range", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg()],
      states: [0 as any, makeState({ formName: "Kingdom" })],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }] // no base -> default 75-year human lifespan
    } as any;

    Characters.generate();
    const ruler = globalThis.pack.characters!.find((c: any) => c.importance === "notable");
    expect(ruler!.age).toBeGreaterThanOrEqual(11);
    expect(ruler!.age).toBeLessThanOrEqual(41);
  });

  it("links a vassal state's ruler to its suzerain's ruler as liege", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, diplomacy: ["x", "x", "Suzerain"] }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, diplomacy: ["x", "Vassal", "x"] })
      ],
      guilds: [],
      provinces: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const king = globalThis.pack.characters!.find((c: any) => c.role === "King of Kingland");
    const duke = globalThis.pack.characters!.find((c: any) => c.role === "Duke of Dukeland");
    expect(king).toBeDefined();
    expect(duke).toBeDefined();
    expect(duke!.liege).toBe(king!.i);
    expect(king!.liege).toBeUndefined();
  });

  it("forms a marriage alliance between two rulers when the roll succeeds", () => {
    Math.random = () => 0; // marriage roll always succeeds

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({
          i: 1,
          name: "Kingland",
          formName: "Kingdom",
          capital: 1,
          diplomacy: ["x", "x", "x"],
          neighbors: [2]
        }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, diplomacy: ["x", "x", "x"], neighbors: [1] })
      ],
      guilds: [],
      provinces: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const king = globalThis.pack.characters!.find((c: any) => c.role === "King of Kingland");
    const duke = globalThis.pack.characters!.find((c: any) => c.role === "Duke of Dukeland");
    expect(duke!.spouseStatePersistentId).toBe(king!.statePersistentId);
    expect(king!.spouseStatePersistentId).toBe(duke!.statePersistentId);
    expect(duke!.spouse).toBe(king!.name);
    expect(king!.spouse).toBe(duke!.name);
  });

  it("does not marry rulers of distant, unrelated states", () => {
    Math.random = () => 0; // marriage roll always succeeds, but no eligible candidate exists

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", capital: 1, diplomacy: ["x", "x", "x"], neighbors: [] }),
        makeState({ i: 2, name: "Dukeland", capital: 2, diplomacy: ["x", "x", "x"], neighbors: [] })
      ],
      guilds: [],
      provinces: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    for (const character of globalThis.pack.characters!) {
      expect(character.spouseStatePersistentId).toBeUndefined();
    }
  });

  it("marries rulers who are allies even when they aren't neighbors", () => {
    Math.random = () => 0; // marriage roll always succeeds

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", capital: 1, diplomacy: ["x", "x", "Ally"], neighbors: [] }),
        makeState({ i: 2, name: "Dukeland", capital: 2, diplomacy: ["x", "Ally", "x"], neighbors: [] })
      ],
      guilds: [],
      provinces: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const king = globalThis.pack.characters!.find((c: any) => c.state === 1);
    const duke = globalThis.pack.characters!.find((c: any) => c.state === 2);
    expect(duke!.spouseStatePersistentId).toBe(1);
    expect(king!.spouseStatePersistentId).toBe(2);
  });

  it("does not form a marriage alliance when the roll fails", () => {
    Math.random = () => 0.99; // marriage roll always fails

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      provinces: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    for (const character of globalThis.pack.characters!) {
      expect(character.spouseStatePersistentId).toBeUndefined();
    }
  });

  it("creates a provincial noble tied to its state's ruler as liege", () => {
    Math.random = () => 0.99; // never triggers founder-naming, keeps the province's own name

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [0 as any, makeProvince()],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const king = globalThis.pack.characters!.find((c: any) => c.role === "King of Testland");
    const noble = globalThis.pack.characters!.find((c: any) => c.role === "Count of Testshire");
    expect(noble).toBeDefined();
    expect(noble!.importance).toBe("notable");
    expect(noble!.liege).toBe(king!.i);
  });

  it("forms a marriage alliance between two nobles of the same state", () => {
    Math.random = () => 0; // marriage roll always succeeds

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [0 as any, makeState({ i: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Countyone", fullName: "Countyone County" }),
        makeProvince({ i: 2, state: 1, burg: 2, name: "Countytwo", fullName: "Countytwo County" })
      ],
      cells: { i: [0, 1, 2], c: [[], [2], [1]], province: [0, 1, 2] }, // cell 1 (county 1) borders cell 2 (county 2)
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const nobleA = globalThis.pack.characters!.find((c: any) => c.province === 1);
    const nobleB = globalThis.pack.characters!.find((c: any) => c.province === 2);
    expect(nobleB!.spouseProvincePersistentId).toBe(1);
    expect(nobleA!.spouseProvincePersistentId).toBe(2);
    expect(nobleB!.spouse).toBe(nobleA!.name);
  });

  it("does not marry nobles of non-adjacent counties in the same state", () => {
    Math.random = () => 0; // marriage roll always succeeds, but the counties don't border each other

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [0 as any, makeState({ i: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Countyone", fullName: "Countyone County" }),
        makeProvince({ i: 2, state: 1, burg: 2, name: "Countytwo", fullName: "Countytwo County" })
      ],
      cells: { i: [0, 1, 2], c: [[], [], []], province: [0, 1, 2] }, // no shared border
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const nobleA = globalThis.pack.characters!.find((c: any) => c.province === 1);
    const nobleB = globalThis.pack.characters!.find((c: any) => c.province === 2);
    expect(nobleA!.spouseProvincePersistentId).toBeUndefined();
    expect(nobleB!.spouseProvincePersistentId).toBeUndefined();
  });

  it("does not marry nobles across different states", () => {
    Math.random = () => 0; // marriage roll always succeeds, but no eligible same-state candidate

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      provinces: [0 as any, makeProvince({ i: 1, state: 1, burg: 1 }), makeProvince({ i: 2, state: 2, burg: 2 })],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const nobleA = globalThis.pack.characters!.find((c: any) => c.province === 1);
    const nobleB = globalThis.pack.characters!.find((c: any) => c.province === 2);
    expect(nobleA!.spouseProvincePersistentId).toBeUndefined();
    expect(nobleB!.spouseProvincePersistentId).toBeUndefined();
  });

  it("renames the province after its noble when the founder-naming roll succeeds", () => {
    Math.random = () => 0; // always triggers founder-naming

    const province = makeProvince();
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, formName: "Kingdom", capital: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [0 as any, province],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    // the noble's own generated name ("Person-1") becomes the root of the province's new name
    expect(province.name).toBe("Person-1Place-1");
    expect(province.fullName).toBe("Person-1Place-1 County");
    const noble = globalThis.pack.characters!.find((c: any) => c.role === "Count of Person-1Place-1");
    expect(noble).toBeDefined();
  });

  it("keeps the province's original name when the founder-naming roll fails", () => {
    Math.random = () => 0.99;

    const province = makeProvince();
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, formName: "Kingdom", capital: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [0 as any, province],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    expect(province.name).toBe("Testshire");
    expect(province.fullName).toBe("Testshire County");
  });

  it("falls back to a generic 'Ruler' title for an unmapped state form", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg()],
      states: [0 as any, makeState({ formName: "Some Exotic Form" })],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    expect(globalThis.pack.characters![0].role).toBe("Ruler of Testland");
  });

  it("skips a state whose capital burg no longer exists or is removed", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ removed: true })],
      states: [0 as any, makeState()],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    expect(globalThis.pack.characters!).toEqual([]);
  });

  it("creates a guild master for each guild, tied to the guild's burg and craft", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 1 })], // too small for commoners, isolates the assertion
      states: [0 as any],
      guilds: [{ i: 0, name: "Blacksmiths Guild of Testburg", burg: 1, culture: 1, craft: "Blacksmiths" }],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    expect(globalThis.pack.characters!).toHaveLength(1);
    expect(globalThis.pack.characters![0].role).toBe("Blacksmiths Guild Master");
    expect(globalThis.pack.characters![0].importance).toBe("notable");
  });

  it("gives no commoner characters to a burg too small to support one", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 1 })],
      states: [0 as any],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    expect(globalThis.pack.characters!).toEqual([]);
  });

  it("gives a large burg commoner characters, drawn from the known archetype list", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 300 })],
      states: [0 as any],
      guilds: [],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const commoners = globalThis.pack.characters!.filter((c: any) => c.importance === "common");
    expect(commoners.length).toBeGreaterThan(0);
    for (const commoner of commoners) {
      expect(COMMONER_ARCHETYPES).toContain(commoner.role);
      expect(commoner.burg).toBe(1);
      expect(commoner.dynasty).toBeUndefined();
    }
  });
});

describe("CharactersModule.applySuccession", () => {
  let Characters: any;
  const originalRandom = Math.random;

  function makePriorRuler(overrides: Record<string, unknown> = {}) {
    const state = (overrides.state as number | undefined) ?? 1;
    return {
      i: 0,
      name: "OldRuler",
      burg: 1,
      culture: 1,
      role: "King of Testland",
      importance: "notable",
      dynasty: "House of Old",
      state,
      statePersistentId: state, // defaults to match .state unless a test explicitly overrides it
      spouse: "OldSpouse",
      children: [
        { name: "Heir1", gender: "m" },
        { name: "Heir2", gender: "f" }
      ],
      ...overrides
    };
  }

  beforeEach(async () => {
    globalThis.Names = {
      getCulture: (culture: number) => `Person-${culture}`,
      getCultureShort: (culture: number) => `Short-${culture}`,
      getState: (name: string, culture: number) => `${name}Place-${culture}`
    } as any;
    globalThis.window = globalThis.window || ({} as any);
    globalThis.window.States = { collectStatistics: vi.fn() } as any;
    const module = await import("./characters-generator");
    Characters = module.Characters;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it("keeps the same ruler in place when the succession roll fails, refreshing only the role", () => {
    Math.random = () => 0.99; // succession never triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler()],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("OldRuler");
    expect(ruler!.dynasty).toBe("House of Old");
    expect(ruler!.role).toBe("King of Testland");
  });

  it("recognizes the same locked state across an era even when its .i gets renumbered", () => {
    // states-generator.ts's recreate() renumbers even LOCKED states each era (a locked state can
    // go from .i=7 to .i=6 with nothing else different) - a real, confirmed behavior. Succession
    // must key off persistentId, not .i, or a surviving ruler would wrongly look like a fresh reign
    Math.random = () => 0.99; // succession never triggers - the SAME ruler must still be recognized

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [
        0 as any,
        makeState({ i: 5, persistentId: 42, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })
      ],
      guilds: [],
      characters: [makePriorRuler({ state: 7, statePersistentId: 42 })], // last era this state was .i=7
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.statePersistentId === 42);
    expect(ruler!.name).toBe("OldRuler"); // recognized as the same ruler, not a fresh dynasty
    expect(ruler!.dynasty).toBe("House of Old");
    expect(ruler!.state).toBe(5); // reassigned to THIS era's .i, not left stuck on last era's 7
  });

  it("hands the crown to the recorded heir when succession triggers, keeping the same dynasty", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler()],
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("Heir1");
    expect(ruler!.dynasty).toBe("House of Old");
    expect(ruler!.role).toBe("King of Testland");
  });

  it("starts a fresh dynasty when succession triggers but no heir was ever recorded", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler({ children: undefined })],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("Person-1");
    expect(ruler!.dynasty).toBe("House of Short-1");
  });

  it("gives an unlocked (fallen) state a fresh ruler regardless of who ruled it before", () => {
    Math.random = () => 0.99; // would keep the old ruler in place, if the state were locked

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: false, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler()],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("Person-1");
    expect(ruler!.dynasty).toBe("House of Short-1");
  });

  it("clears a stale liege link when the state is no longer anyone's vassal", () => {
    Math.random = () => 0.99; // same ruler carries over unchanged, apart from liege

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler({ liege: 99 })], // stale index from a previous era's array
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.liege).toBeUndefined();
  });

  it("merges a childless dynasty into its spouse's crown on succession", () => {
    Math.random = () => 0; // succession always triggers for both states

    const priorA = makePriorRuler({
      i: 0,
      name: "RulerA",
      burg: 1,
      role: "King of Kingland",
      dynasty: "House A",
      state: 1,
      spouse: "RulerB",
      spouseStatePersistentId: 2,
      children: undefined // no heir - this line goes extinct, but it's married into state 2
    });
    const priorB = {
      i: 1,
      name: "RulerB",
      burg: 2,
      culture: 1,
      role: "Duke of Dukeland",
      importance: "notable",
      dynasty: "House B",
      state: 2,
      statePersistentId: 2,
      spouse: "RulerA",
      spouseStatePersistentId: 1,
      children: [{ name: "BHeir", gender: "m" }] // has its own heir - never goes extinct
    };

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, state: 1 }), makeBurg({ i: 2, state: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, lock: true, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, lock: true, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 })],
      characters: [priorA, priorB],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 2] },
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.states[1].removed).toBe(true);
    expect(globalThis.pack.states[2].removed).toBeFalsy();
    expect(globalThis.pack.states[2].fullName).toContain("united with Kingland");
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 2, 2, 2]);
    expect(globalThis.pack.burgs[1].state).toBe(2);
    expect(globalThis.pack.provinces[1].state).toBe(2);
    expect(globalThis.pack.provinces[1].annexedYear).toBe(1000); // newly under a foreign crown - a rebellion risk factor

    const survivorRuler = globalThis.pack.characters!.find((c: any) => c.state === 2 && !c.removed);
    expect(survivorRuler!.name).toBe("BHeir");
    expect(survivorRuler!.role).toContain("uniting the crown of Kingland");

    const stillClaimsState1 = globalThis.pack.characters!.some((c: any) => c.state === 1 && !c.removed);
    expect(stillClaimsState1).toBe(false);

    // territory moved between states - area/rural/urban must be refreshed for this era, or the
    // merged survivor's stats (and anything derived from them, like Eras.updateTreasuries()) stay stale
    expect(globalThis.window.States.collectStatistics).toHaveBeenCalledTimes(1);
  });

  it("does not merge a userLocked crown into its spouse's, leaving the marriage and both states untouched", () => {
    Math.random = () => 0; // succession would always trigger for both states if evaluated

    const priorA = makePriorRuler({
      i: 0,
      name: "RulerA",
      burg: 1,
      role: "King of Kingland",
      dynasty: "House A",
      state: 1,
      spouse: "RulerB",
      spouseStatePersistentId: 2,
      children: undefined // no heir - would go extinct and merge, if not for the lock below
    });
    const priorB = {
      i: 1,
      name: "RulerB",
      burg: 2,
      culture: 1,
      role: "Duke of Dukeland",
      importance: "notable",
      dynasty: "House B",
      state: 2,
      statePersistentId: 2,
      spouse: "RulerA",
      spouseStatePersistentId: 1,
      children: [{ name: "BHeir", gender: "m" }]
    };

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, state: 1 }), makeBurg({ i: 2, state: 2 })],
      states: [
        0 as any,
        makeState({
          i: 1,
          name: "Kingland",
          formName: "Kingdom",
          capital: 1,
          lock: true,
          userLocked: true,
          diplomacy: ["x", "x", "x"]
        }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, lock: true, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      provinces: [0 as any, makeProvince({ i: 1, state: 1 })],
      characters: [priorA, priorB],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 2] },
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.states[1].removed).toBeFalsy();
    expect(globalThis.pack.states[2].removed).toBeFalsy();
    expect(globalThis.pack.provinces[1].state).toBe(1); // territory never moved
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, 1, 1, 2]);
    // the childless ruler is left exactly as before - not removed, marriage tie intact
    expect(globalThis.pack.characters![0].removed).toBeFalsy();
  });

  it("still merges into the correct spouse's crown even after that state's .i was renumbered since the marriage was formed", () => {
    Math.random = () => 0; // succession always triggers

    // the marriage was formed some earlier era against a state that was .i=2 back then; states get
    // renumbered every era (States.recreate() does this even for locked/surviving states) - this era
    // that same state (still identified by persistentId 2) has been renumbered down to .i=5
    const priorA = makePriorRuler({
      i: 0,
      name: "RulerA",
      burg: 1,
      role: "King of Kingland",
      dynasty: "House A",
      state: 1,
      spouse: "RulerB",
      spouseStatePersistentId: 2,
      children: undefined
    });
    const priorB = {
      i: 1,
      name: "RulerB",
      burg: 2,
      culture: 1,
      role: "Duke of Dukeland",
      importance: "notable",
      dynasty: "House B",
      state: 5,
      statePersistentId: 2,
      spouse: "RulerA",
      spouseStatePersistentId: 1,
      children: [{ name: "BHeir", gender: "m" }]
    };

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      burgs: [
        0 as any,
        makeBurg({ i: 1, state: 1, cell: 1 }),
        0 as any,
        0 as any,
        0 as any,
        makeBurg({ i: 5, state: 5, cell: 2 })
      ],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, lock: true, diplomacy: ["x", "x"] }),
        0 as any,
        0 as any,
        0 as any,
        makeState({
          i: 5,
          persistentId: 2,
          name: "Dukeland",
          formName: "Duchy",
          capital: 5,
          lock: true,
          diplomacy: ["x", "x"]
        })
      ],
      guilds: [],
      provinces: [],
      characters: [priorA, priorB],
      cells: { i: [0, 1, 2], state: [0, 1, 5] },
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.states[1].removed).toBe(true);
    expect(globalThis.pack.states[5].removed).toBeFalsy();
    expect(globalThis.pack.states[5].fullName).toContain("united with Kingland");
  });

  it("combines two crowns absorbed by the same survivor in one era into a single annotation", () => {
    Math.random = () => 0; // succession always triggers for all three states

    const priorA = makePriorRuler({
      i: 0,
      name: "RulerA",
      burg: 1,
      role: "King of Kingland",
      dynasty: "House A",
      state: 1,
      spouse: "RulerSurvivor",
      spouseStatePersistentId: 3,
      children: undefined // no heir - goes extinct, married into the survivor
    });
    const priorB = makePriorRuler({
      i: 1,
      name: "RulerB",
      burg: 2,
      role: "Duke of Dukeland",
      dynasty: "House B",
      state: 2,
      spouse: "RulerSurvivor",
      spouseStatePersistentId: 3,
      children: undefined // no heir - also goes extinct, also married into the survivor
    });
    const priorSurvivor = {
      i: 2,
      name: "RulerSurvivor",
      burg: 3,
      culture: 1,
      role: "Grand Duke of Grandland",
      importance: "notable",
      dynasty: "House S",
      state: 3,
      statePersistentId: 3,
      spouse: "RulerA",
      children: [{ name: "SurvivorHeir", gender: "m" }] // has its own heir - never goes extinct
    };

    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, state: 1 }), makeBurg({ i: 2, state: 2 }), makeBurg({ i: 3, state: 3 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, lock: true }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, lock: true }),
        makeState({ i: 3, name: "Grandland", formName: "Grand Duchy", capital: 3, lock: true })
      ],
      guilds: [],
      provinces: [],
      characters: [priorA, priorB, priorSurvivor],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 2, 3] },
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.states[1].removed).toBe(true);
    expect(globalThis.pack.states[2].removed).toBe(true);
    expect(globalThis.pack.states[3].removed).toBeFalsy();
    // both mergers happened in this one era - neither should be lost to the other overwriting it
    expect(globalThis.pack.states[3].fullName).toBe("Grandland (united with Kingland, united with Dukeland)");
  });

  it("merges a childless county into its spouse's county on succession", () => {
    Math.random = () => 0; // succession always triggers for both nobles

    const priorA = {
      i: 0,
      name: "NobleA",
      burg: 1,
      culture: 1,
      role: "Count of Countyone",
      importance: "notable",
      dynasty: "House A",
      province: 1,
      provincePersistentId: 1,
      spouse: "NobleB",
      spouseProvincePersistentId: 2
      // no children - this line goes extinct, but it's married into county 2
    };
    const priorB = {
      i: 1,
      name: "NobleB",
      burg: 2,
      culture: 1,
      role: "Count of Countytwo",
      importance: "notable",
      dynasty: "House B",
      province: 2,
      provincePersistentId: 2,
      spouse: "NobleA",
      spouseProvincePersistentId: 1,
      children: [{ name: "BHeir", gender: "m" }] // has its own heir - never goes extinct
    };

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [0 as any, makeState({ i: 1, capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Countyone", fullName: "Countyone County" }),
        makeProvince({ i: 2, state: 1, burg: 2, name: "Countytwo", fullName: "Countytwo County" })
      ],
      characters: [priorA, priorB],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 1], province: [0, 1, 1, 2] },
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.provinces[1].removed).toBe(true);
    expect(globalThis.pack.provinces[2].removed).toBeFalsy();
    expect(globalThis.pack.provinces[2].fullName).toContain("united with Countyone");
    expect(Array.from(globalThis.pack.cells.province)).toEqual([0, 2, 2, 2]);

    const survivorNoble = globalThis.pack.characters!.find((c: any) => c.province === 2 && !c.removed);
    expect(survivorNoble!.name).toBe("BHeir");
    expect(survivorNoble!.role).toContain("uniting the county of Countyone");

    const stillClaimsProvince1 = globalThis.pack.characters!.some((c: any) => c.province === 1 && !c.removed);
    expect(stillClaimsProvince1).toBe(false);
  });

  it("gives long-lived species a much lower death chance than short-lived ones at the same age", () => {
    // fixed threshold between the elf's floor chance (0.03) and the goblin's ceiling chance (0.95)
    Math.random = () => 0.5;

    const elfRuler = {
      i: 0,
      name: "Elf",
      burg: 1,
      culture: 1,
      role: "King of Elfland",
      importance: "notable",
      dynasty: "House Elf",
      state: 1,
      statePersistentId: 1,
      age: 100, // well under half of a 700-year elven lifespan
      children: [{ name: "ElfHeir", gender: "m" }]
    };
    const goblinRuler = {
      i: 1,
      name: "Goblin",
      burg: 2,
      culture: 2,
      role: "King of Goblinland",
      importance: "notable",
      dynasty: "House Goblin",
      state: 2,
      statePersistentId: 2,
      age: 100, // well past a 40-year goblin lifespan
      children: [{ name: "GoblinHeir", gender: "m" }]
    };

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, culture: 1 }), makeBurg({ i: 2, culture: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Elfland", culture: 1, capital: 1, lock: true, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, name: "Goblinland", culture: 2, capital: 2, lock: true, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      characters: [elfRuler, goblinRuler],
      cultures: [null, { i: 1, name: "Elvish", base: 33 }, { i: 2, name: "Goblinoid", base: 36 }]
    } as any;

    Characters.applySuccession(1);

    const elf = globalThis.pack.characters!.find((c: any) => c.state === 1);
    const goblin = globalThis.pack.characters!.find((c: any) => c.state === 2);
    expect(elf!.name).toBe("Elf"); // still well within an elf's prime - unchanged
    expect(goblin!.name).toBe("GoblinHeir"); // a goblin this old has died and passed the crown on
  });

  it("lets a daughter-only line go extinct under agnatic (Salic-style) succession", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true })],
      guilds: [],
      characters: [makePriorRuler({ children: [{ name: "OnlyDaughter", gender: "f" }] })],
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).not.toBe("OnlyDaughter"); // agnatic law skips her - the line dies out
    expect(ruler!.dynasty).not.toBe("House of Old"); // a fresh, unrelated house rises instead
  });

  it("lets a younger son inherit ahead of an elder daughter under male-preference succession", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Tsardom", capital: 1, lock: true })],
      guilds: [],
      characters: [
        makePriorRuler({
          children: [
            { name: "ElderDaughter", gender: "f" },
            { name: "YoungerSon", gender: "m" }
          ]
        })
      ],
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "male-preference" } }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("YoungerSon");
  });

  it("lets the youngest child inherit under ultimogeniture, regardless of gender", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Testland", formName: "Khanate", form: "Monarchy", capital: 1, lock: true })
      ],
      guilds: [],
      characters: [
        makePriorRuler({
          children: [
            { name: "Eldest", gender: "m" },
            { name: "Youngest", gender: "f" }
          ]
        })
      ],
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "ultimogeniture" } }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("Youngest");
  });

  it("lets an elective succession pass to a daughter where agnatic succession would not", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Testland", formName: "Republic", form: "Republic", capital: 1, lock: true })
      ],
      guilds: [],
      characters: [makePriorRuler({ children: [{ name: "OnlyDaughter", gender: "f" }] })],
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Republic: "elective" } }]
    } as any;

    Characters.applySuccession(20);
    const ruler = globalThis.pack.characters!.find((c: any) => c.state === 1);
    expect(ruler!.name).toBe("OnlyDaughter");
    expect(ruler!.dynasty).toBe("House of Old"); // elected from the same family, not a stranger
  });

  it("splits the realm between siblings when a succession crisis occurs", () => {
    Math.random = () => 0; // succession triggers, and so does the crisis roll

    const priorRuler = makePriorRuler({
      children: [
        { name: "ElderSon", gender: "m" },
        { name: "YoungerSon", gender: "m" }
      ]
    });

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, cell: 1 }), makeBurg({ i: 2, cell: 3 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Homeshire", fullName: "Homeshire County" }),
        makeProvince({ i: 2, state: 1, burg: 2, name: "Splitshire", fullName: "Splitshire County" })
      ],
      characters: [priorRuler],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 1], province: [0, 1, 1, 2] },
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);

    const primaryRuler = globalThis.pack.characters!.find((c: any) => c.name === "ElderSon");
    const splinterRuler = globalThis.pack.characters!.find((c: any) => c.name === "YoungerSon");
    expect(primaryRuler).toBeDefined();
    expect(splinterRuler).toBeDefined();
    expect(splinterRuler!.dynasty).toBe(primaryRuler!.dynasty); // same house, a cadet branch
    expect(splinterRuler!.state).not.toBe(primaryRuler!.state);
    expect(primaryRuler!.role).toContain("realm divided among siblings");

    const newState = globalThis.pack.states.find((s: any) => s.i === splinterRuler!.state);
    expect(newState).toBeDefined();
    expect(newState!.name).toBe("Splitshire");
    expect(globalThis.pack.provinces[2].state).toBe(newState!.i);
    expect(globalThis.pack.provinces[1].state).toBe(primaryRuler!.state); // the original half stays put
    expect(Array.from(globalThis.pack.cells.state)).toEqual([0, primaryRuler!.state, primaryRuler!.state, newState!.i]);

    // territory moved to the new splinter state - area/rural/urban must be refreshed for this era,
    // or the parent state's stats stay inflated and the splinter's stay at 0
    expect(globalThis.window.States.collectStatistics).toHaveBeenCalledTimes(1);
  });

  it("never hands the capital's own province to the splinter, regardless of the provinces array's order", () => {
    Math.random = () => 0; // succession triggers, and so does the crisis roll

    const priorRuler = makePriorRuler({
      children: [
        { name: "ElderSon", gender: "m" },
        { name: "YoungerSon", gender: "m" }
      ]
    });

    // province array order reflects creation order (e.g. an older province annexed from a
    // neighbor in a past war), not current ownership - here the capital's own province
    // ("Homeshire", tied to the capital burg) sits AFTER the other province in the array, the
    // exact layout that used to make trySplitRealm() hand away the capital by mistake
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, cell: 1, state: 1 }), makeBurg({ i: 2, cell: 3, state: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 2, name: "Annexedshire", fullName: "Annexedshire County" }),
        makeProvince({ i: 2, state: 1, burg: 1, name: "Homeshire", fullName: "Homeshire County" })
      ],
      characters: [priorRuler],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 1], province: [0, 2, 1, 1] },
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);

    const primaryRuler = globalThis.pack.characters!.find((c: any) => c.name === "ElderSon");
    const splinterRuler = globalThis.pack.characters!.find((c: any) => c.name === "YoungerSon");
    expect(primaryRuler).toBeDefined();
    expect(splinterRuler).toBeDefined();

    // the capital's own province, and the capital burg itself, must stay with the primary ruler
    expect(globalThis.pack.provinces[2].state).toBe(primaryRuler!.state);
    expect(globalThis.pack.burgs[1].state).toBe(primaryRuler!.state);
    // the OTHER province is what gets carved off instead
    expect(globalThis.pack.provinces[1].state).not.toBe(primaryRuler!.state);
    expect(globalThis.pack.provinces[1].state).toBe(splinterRuler!.state);
  });

  it("does not split a userLocked realm, even when a succession crisis would otherwise trigger it", () => {
    Math.random = () => 0; // succession triggers, and the crisis roll would too, if evaluated

    const priorRuler = makePriorRuler({
      children: [
        { name: "ElderSon", gender: "m" },
        { name: "YoungerSon", gender: "m" }
      ]
    });

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, cell: 1 }), makeBurg({ i: 2, cell: 3 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true, userLocked: true })
      ],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Homeshire", fullName: "Homeshire County" }),
        makeProvince({ i: 2, state: 1, burg: 2, name: "Splitshire", fullName: "Splitshire County" })
      ],
      characters: [priorRuler],
      cells: { i: [0, 1, 2, 3], state: [0, 1, 1, 1], province: [0, 1, 1, 2] },
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);

    // no splinter state was created, and both provinces stayed with the one realm
    expect(globalThis.pack.states).toHaveLength(2);
    expect(globalThis.pack.provinces[1].state).toBe(1);
    expect(globalThis.pack.provinces[2].state).toBe(1);
    const splinterRuler = globalThis.pack.characters!.find((c: any) => c.name === "YoungerSon");
    expect(splinterRuler).toBeUndefined();
  });

  it("never carves away an individually locked province, splitting off an unlocked one instead", () => {
    Math.random = () => 0; // succession triggers, and so does the crisis roll

    const priorRuler = makePriorRuler({
      children: [
        { name: "ElderSon", gender: "m" },
        { name: "YoungerSon", gender: "m" }
      ]
    });

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, cell: 1 }), makeBurg({ i: 2, cell: 3 }), makeBurg({ i: 3, cell: 4 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true })],
      guilds: [],
      provinces: [
        0 as any,
        makeProvince({ i: 1, state: 1, burg: 1, name: "Homeshire", fullName: "Homeshire County" }), // capital
        makeProvince({ i: 2, state: 1, burg: 2, name: "Lockedshire", fullName: "Lockedshire County", lock: true }),
        makeProvince({ i: 3, state: 1, burg: 3, name: "Splitshire", fullName: "Splitshire County" })
      ],
      characters: [priorRuler],
      cells: { i: [0, 1, 2, 3, 4], state: [0, 1, 1, 1, 1], province: [0, 1, 1, 2, 3] },
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);

    const primaryRuler = globalThis.pack.characters!.find((c: any) => c.name === "ElderSon");
    const splinterRuler = globalThis.pack.characters!.find((c: any) => c.name === "YoungerSon");
    expect(splinterRuler).toBeDefined();

    // the locked province never leaves the parent state, even though it isn't the capital's own
    expect(globalThis.pack.provinces[2].state).toBe(primaryRuler!.state);
    // the unlocked province is what gets carved off instead
    expect(globalThis.pack.provinces[3].state).toBe(splinterRuler!.state);
  });

  it("does not split a realm with fewer than two provinces", () => {
    Math.random = () => 0; // succession triggers, and so would the crisis roll, if it could apply

    const priorRuler = makePriorRuler({
      children: [
        { name: "ElderSon", gender: "m" },
        { name: "YoungerSon", gender: "m" }
      ]
    });

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, lock: true })],
      guilds: [],
      provinces: [0 as any, makeProvince({ i: 1, state: 1, burg: 1 })],
      characters: [priorRuler],
      cells: { i: [0, 1], state: [0, 1], province: [0, 1] },
      cultures: [null, { i: 1, name: "Testculture", successionLawByForm: { Monarchy: "agnatic" } }]
    } as any;

    Characters.applySuccession(20);

    expect(globalThis.pack.states).toHaveLength(2); // no new state was created
    const primaryRuler = globalThis.pack.characters!.find((c: any) => c.name === "ElderSon");
    expect(primaryRuler!.role).not.toContain("divided");
    expect(globalThis.window.States.collectStatistics).not.toHaveBeenCalled(); // no territory moved
  });

  it("rolls a succession law once per culture and keeps it fixed afterward", () => {
    Math.random = () => 0; // would pick agnatic (first Monarchy weight), if it rolls at all

    const culture: any = { i: 1, name: "Testculture" };
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", form: "Monarchy", capital: 1, lock: true })],
      guilds: [],
      characters: [makePriorRuler({ children: [{ name: "OnlyDaughter", gender: "f" }] })],
      cultures: [null, culture]
    } as any;

    Characters.applySuccession(20);
    const firstLaw = culture.successionLawByForm.Monarchy;
    expect(firstLaw).toBe("agnatic");

    // a different Math.random on a later call must not re-roll an already-assigned culture+form
    Math.random = () => 0.99;
    Characters.applySuccession(20);
    expect(culture.successionLawByForm.Monarchy).toBe(firstLaw);
  });

  it("rolls succession law independently per state form, even within the same culture", () => {
    Math.random = () => 0; // would pick the first weighted option for whichever form is rolled

    const culture: any = { i: 1, name: "Testculture" };
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 }), makeBurg({ i: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", form: "Monarchy", capital: 1, lock: true, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, name: "Uniland", form: "Union", capital: 2, lock: true, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      characters: [
        makePriorRuler({ i: 0, state: 1, children: [{ name: "OnlyDaughter1", gender: "f" }] }),
        makePriorRuler({ i: 1, state: 2, children: [{ name: "OnlyDaughter2", gender: "f" }] })
      ],
      cultures: [null, culture]
    } as any;

    Characters.applySuccession(20);

    // Monarchy's first weight is agnatic, Union's is elective - a shared per-culture cache would
    // force one onto the other; each form must keep its own roll instead
    expect(culture.successionLawByForm.Monarchy).toBe("agnatic");
    expect(culture.successionLawByForm.Union).toBe("elective");
  });
});
