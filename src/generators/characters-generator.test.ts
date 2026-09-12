import { beforeEach, describe, expect, it } from "vitest";
import { COMMONER_ARCHETYPES } from "./characters-generator";

function makeBurg(overrides: Record<string, unknown> = {}) {
  return { i: 1, name: "Testburg", x: 0, y: 0, cell: 1, culture: 1, population: 40, removed: false, ...overrides };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return { i: 1, name: "Testland", culture: 1, capital: 1, formName: "Kingdom", removed: false, ...overrides };
}

describe("CharactersModule.generate", () => {
  let Characters: any;

  beforeEach(async () => {
    globalThis.Names = {
      getCulture: (culture: number) => `Person-${culture}`,
      getCultureShort: (culture: number) => `Short-${culture}`
    } as any;
    const module = await import("./characters-generator");
    Characters = module.Characters;
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
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1 })],
      states: [0 as any, makeState({ i: 1, name: "Testland", formName: "Kingdom", capital: 1, diplomacy: ["x", "x"] })],
      guilds: [],
      provinces: [0 as any, { i: 1, state: 1, burg: 1, name: "Testshire", formName: "County", removed: false }],
      cultures: [null, { i: 1, name: "Testculture" }]
    } as any;

    Characters.generate();
    const king = globalThis.pack.characters!.find((c: any) => c.role === "King of Testland");
    const noble = globalThis.pack.characters!.find((c: any) => c.role === "Count of Testshire");
    expect(noble).toBeDefined();
    expect(noble!.importance).toBe("notable");
    expect(noble!.liege).toBe(king!.i);
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
