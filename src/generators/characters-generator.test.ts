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

  it("forms a marriage alliance between two rulers when the roll succeeds", () => {
    Math.random = () => 0; // marriage roll always succeeds

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
    const king = globalThis.pack.characters!.find((c: any) => c.role === "King of Kingland");
    const duke = globalThis.pack.characters!.find((c: any) => c.role === "Duke of Dukeland");
    expect(duke!.spouseState).toBe(king!.state);
    expect(king!.spouseState).toBe(duke!.state);
    expect(duke!.spouse).toBe(king!.name);
    expect(king!.spouse).toBe(duke!.name);
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
      expect(character.spouseState).toBeUndefined();
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
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const nobleA = globalThis.pack.characters!.find((c: any) => c.province === 1);
    const nobleB = globalThis.pack.characters!.find((c: any) => c.province === 2);
    expect(nobleB!.spouseProvince).toBe(1);
    expect(nobleA!.spouseProvince).toBe(2);
    expect(nobleB!.spouse).toBe(nobleA!.name);
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
    expect(nobleA!.spouseProvince).toBeUndefined();
    expect(nobleB!.spouseProvince).toBeUndefined();
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
      spouseState: 2,
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
      spouse: "RulerA",
      spouseState: 1,
      children: ["BHeir"] // has its own heir - never goes extinct
    };

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, state: 1 }), makeBurg({ i: 2, state: 2 })],
      states: [
        0 as any,
        makeState({ i: 1, name: "Kingland", formName: "Kingdom", capital: 1, lock: true, diplomacy: ["x", "x", "x"] }),
        makeState({ i: 2, name: "Dukeland", formName: "Duchy", capital: 2, lock: true, diplomacy: ["x", "x", "x"] })
      ],
      guilds: [],
      provinces: [],
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

    const survivorRuler = globalThis.pack.characters!.find((c: any) => c.state === 2 && !c.removed);
    expect(survivorRuler!.name).toBe("BHeir");
    expect(survivorRuler!.role).toContain("uniting the crown of Kingland");

    const stillClaimsState1 = globalThis.pack.characters!.some((c: any) => c.state === 1 && !c.removed);
    expect(stillClaimsState1).toBe(false);
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
      spouse: "NobleB",
      spouseProvince: 2
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
      spouse: "NobleA",
      spouseProvince: 1,
      children: ["BHeir"] // has its own heir - never goes extinct
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
});
