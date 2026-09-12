import { beforeEach, describe, expect, it } from "vitest";

function makeBurg(overrides: Record<string, unknown> = {}) {
  return {
    i: 1,
    name: "Testburg",
    x: 0,
    y: 0,
    cell: 1,
    culture: 1,
    population: 40,
    production: [],
    removed: false,
    ...overrides
  };
}

describe("GuildsModule.generate", () => {
  let Guilds: any;

  beforeEach(async () => {
    const module = await import("./guilds-generator");
    Guilds = module.Guilds;
  });

  it("creates no guild for a burg too small to support one", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 1 })],
      cultures: [null, { i: 1, type: "Generic" }],
      goods: []
    } as any;

    Guilds.generate();
    expect(globalThis.pack.guilds!).toEqual([]);
  });

  it("gives a trade-oriented culture (Naval) more guilds than a Generic one at the same population", () => {
    const population = 200;

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, culture: 1, population })],
      cultures: [null, { i: 1, type: "Generic" }],
      goods: []
    } as any;
    Guilds.generate();
    const genericCount = globalThis.pack.guilds!.length;

    globalThis.pack = {
      burgs: [0 as any, makeBurg({ i: 1, culture: 1, population })],
      cultures: [null, { i: 1, type: "Naval" }],
      goods: []
    } as any;
    Guilds.generate();
    const navalCount = globalThis.pack.guilds!.length;

    expect(navalCount).toBeGreaterThan(genericCount);
  });

  it("names the guild after the burg's top-produced good, using a known craft label", () => {
    globalThis.pack = {
      burgs: [
        0 as any,
        makeBurg({
          i: 1,
          population: 60,
          production: [
            { goodId: 5, units: 100, recipe: [] }, // MfgRecord
            { goodId: 9, units: 10, recipe: [] }
          ]
        })
      ],
      cultures: [null, { i: 1, type: "Generic" }],
      goods: [null, null, null, null, null, { i: 5, name: "Iron" }, null, null, null, { i: 9, name: "Wine" }]
    } as any;

    Guilds.generate();
    const guilds = globalThis.pack.guilds!;
    expect(guilds.length).toBeGreaterThan(0);
    expect(guilds[0].craft).toBe("Blacksmiths");
    expect(guilds[0].goodId).toBe(5);
    expect(guilds[0].name).toContain("Testburg");
  });

  it("falls back to a generic Merchants guild when there's no production data", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 50, production: [] })],
      cultures: [null, { i: 1, type: "Generic" }],
      goods: []
    } as any;

    Guilds.generate();
    const guilds = globalThis.pack.guilds!;
    expect(guilds.length).toBeGreaterThan(0);
    expect(guilds.every((g: any) => g.craft === "Merchants")).toBe(true);
    expect(guilds.every((g: any) => g.goodId === undefined)).toBe(true);
  });

  it("uses a '<Good> Traders' fallback label for a good with no dedicated craft name", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 60, production: [{ goodId: 1, units: 50, recipe: [] }] })],
      cultures: [null, { i: 1, type: "Generic" }],
      goods: [null, { i: 1, name: "Elephants" }]
    } as any;

    Guilds.generate();
    expect(globalThis.pack.guilds![0].craft).toBe("Elephants Traders");
  });

  it("skips removed burgs", () => {
    globalThis.pack = {
      burgs: [0 as any, makeBurg({ population: 200, removed: true })],
      cultures: [null, { i: 1, type: "Naval" }],
      goods: []
    } as any;

    Guilds.generate();
    expect(globalThis.pack.guilds!).toEqual([]);
  });
});
