import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMONER_ARCHETYPES } from "./characters-generator";

function makeBurg(overrides: Record<string, unknown> = {}) {
  return { i: 1, name: "Testburg", x: 0, y: 0, cell: 1, culture: 1, population: 40, removed: false, ...overrides };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return { i: 1, name: "Testland", culture: 1, capital: 1, formName: "Kingdom", removed: false, ...overrides };
}

function makeProvince(overrides: Record<string, unknown> = {}) {
  return {
    i: 1,
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
    return {
      i: 0,
      name: "OldRuler",
      burg: 1,
      culture: 1,
      role: "King of Testland",
      importance: "notable",
      dynasty: "House of Old",
      state: 1,
      spouse: "OldSpouse",
      children: ["Heir1", "Heir2"],
      ...overrides
    };
  }

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

  it("hands the crown to the recorded heir when succession triggers, keeping the same dynasty", () => {
    Math.random = () => 0; // succession always triggers

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", capital: 1, lock: true, diplomacy: ["x", "x"] })],
      guilds: [],
      characters: [makePriorRuler()],
      cultures: [null, { i: 1, name: "Testculture" }]
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
});
