import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPath } from "@/utils";
import { evolveRoutes } from "./route-evolution";

vi.mock("@/utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@/utils")>();
  return { ...actual, findPath: vi.fn() };
});

const route = (i: number, group: string, cells: number[], extra = {}) => ({
  i,
  group,
  feature: 1,
  points: cells.map(cellId => [cellId, cellId, cellId]),
  ...extra
});

const cellsOf = (r: any) => r.points.map((p: number[]) => p[2]);
const byGroup = (group: string) => pack.routes.filter((r: any) => r.group === group).map(cellsOf);

describe("evolveRoutes", () => {
  const mockedFindPath = vi.mocked(findPath);

  beforeEach(() => {
    mockedFindPath.mockReset();
    globalThis.Routes = {
      sync: vi.fn(),
      buildLinks: vi.fn(() => ({})),
      getLandPathCost: vi.fn(),
      getNextId: vi.fn(() => Math.max(...pack.routes.map((r: any) => r.i)) + 1),
      generateName: vi.fn(() => "New Road")
    } as any;
    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      states: [{ i: 0 }],
      burgs: [{ i: 0 }],
      routes: [],
      cells: { burg: new Array(30).fill(0), f: new Array(30).fill(1), p: Array.from({ length: 30 }, (_, c) => [c, c]) }
    } as any;
  });

  describe("roads to capitals", () => {
    beforeEach(() => {
      // original road 1-2-3; capital burg 1 at cell 9
      pack.routes = [route(0, "roads", [1, 2, 3])] as any;
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }] as any;
      pack.burgs = [{ i: 0 }, { i: 1, cell: 9, x: 9, y: 9 }] as any;
      pack.cells.burg[9] = 1;
    });

    it("searches from an established capital to the nearest road cell", () => {
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      const [start, isExit] = mockedFindPath.mock.calls[0];
      expect(start).toBe(9);
      expect(isExit(3)).toBe(true);
      expect(isExit(7)).toBe(false);
    });

    it("builds a new named road where the way follows no trail", () => {
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      expect(pack.routes).toHaveLength(2);
      expect(pack.routes[1]).toMatchObject({ group: "roads", name: "New Road", capitalBurg: 1, capitalYear: 1000 });
      expect(cellsOf(pack.routes[1])).toEqual([9, 8, 3]);
      expect(pack.routes[1].points[0]).toEqual([9, 9, 9]);
    });

    it("promotes the stretch of a trail the way follows, keeping its name, and splits off the rest", () => {
      pack.routes.push(route(1, "trails", [20, 9, 8, 3, 21], { name: "Old Path" }) as any);
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      expect(byGroup("roads")).toEqual([
        [1, 2, 3],
        [9, 8, 3]
      ]);
      expect(byGroup("trails")).toEqual([
        [20, 9],
        [3, 21]
      ]);
      const promoted = pack.routes.find((r: any) => r.i === 1);
      expect(promoted).toMatchObject({ group: "roads", name: "Old Path", capitalBurg: 1 });
      expect(pack.routes.filter((r: any) => r.name === "Old Path")).toHaveLength(3);
      expect(Routes.generateName).not.toHaveBeenCalled();
    });

    it("promotes a trail followed in the opposite direction too", () => {
      pack.routes.push(route(1, "trails", [3, 8, 9], { name: "Old Path" }) as any);
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      expect(byGroup("roads")).toEqual([
        [1, 2, 3],
        [3, 8, 9]
      ]);
      expect(byGroup("trails")).toEqual([]);
    });

    it("mixes promoted and new stretches along one way", () => {
      pack.routes.push(route(1, "trails", [9, 8], { name: "Old Path" }) as any);
      mockedFindPath.mockReturnValue([9, 8, 7, 3]);
      evolveRoutes(new Set([1]));

      expect(byGroup("roads")).toEqual([
        [1, 2, 3],
        [9, 8],
        [8, 7, 3]
      ]);
      expect(pack.routes.filter((r: any) => r.capitalBurg === 1)).toHaveLength(2);
    });

    it("never promotes a locked trail", () => {
      pack.routes.push(route(1, "trails", [9, 8, 3], { lock: true }) as any);
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      expect(pack.routes[1].group).toBe("trails");
      expect(byGroup("roads")).toContainEqual([9, 8, 3]);
    });

    it("waits until a capital has held its status for a second era", () => {
      evolveRoutes(new Set());
      expect(mockedFindPath).not.toHaveBeenCalled();
    });

    it("lets a later capital join a road built for an earlier one in the same era", () => {
      pack.states.push({ i: 2, capital: 2 } as any);
      pack.burgs.push({ i: 2, cell: 20 } as any);
      mockedFindPath.mockReturnValueOnce([9, 8, 3]).mockReturnValueOnce(null);
      evolveRoutes(new Set([1, 2]));

      const isExitForSecond = mockedFindPath.mock.calls[1][1];
      expect(isExitForSecond(8)).toBe(true);
    });

    it("leaves a capital already on a road alone", () => {
      pack.burgs[1].cell = 2;
      evolveRoutes(new Set([1]));
      expect(mockedFindPath).not.toHaveBeenCalled();
    });

    it("skips removed states and does nothing on a map with no roads at all", () => {
      pack.routes = [route(0, "trails", [1, 2, 3])] as any;
      evolveRoutes(new Set([1]));
      expect(mockedFindPath).not.toHaveBeenCalled();

      pack.routes = [route(0, "roads", [1, 2, 3])] as any;
      pack.states = [{ i: 0 }, { i: 1, capital: 1, removed: true }] as any;
      evolveRoutes(new Set([1]));
      expect(mockedFindPath).not.toHaveBeenCalled();
    });

    it("survives a capital with no road reachable by land", () => {
      mockedFindPath.mockReturnValue(null);
      expect(() => evolveRoutes(new Set([1]))).not.toThrow();
      expect(pack.routes).toHaveLength(1);
    });

    it("rebuilds the cell links from the final network", () => {
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));
      expect(Routes.buildLinks).toHaveBeenLastCalledWith(pack.routes);
    });
  });

  describe("roads to former capitals", () => {
    beforeEach(() => {
      // burg 1 at cell 9 is no longer a capital; its road ends on the original network at cell 3
      pack.states = [{ i: 0 }] as any;
      pack.burgs = [{ i: 0 }, { i: 1, cell: 9 }] as any;
    });

    it("decays into a trail once the burg has not been a capital for long enough", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 700 })
      ] as any;
      evolveRoutes(new Set());
      expect(pack.routes[1].group).toBe("trails");
    });

    it("decays every stretch built or promoted for that burg together", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8], { capitalBurg: 1, capitalYear: 700 }),
        route(2, "roads", [8, 7, 3], { capitalBurg: 1, capitalYear: 700 })
      ] as any;
      evolveRoutes(new Set());
      expect(pack.routes.map((r: any) => r.group)).toEqual(["roads", "trails", "trails"]);
    });

    it("stays a road before that", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 800 })
      ] as any;
      evolveRoutes(new Set());
      expect(pack.routes[1].group).toBe("roads");
    });

    it("stays a road while its burg is still a capital, however old", () => {
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }] as any;
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 100 })
      ] as any;
      evolveRoutes(new Set([1]));
      expect(pack.routes[1]).toMatchObject({ group: "roads", capitalYear: 1000 });
    });

    it("stays a road while another capital's road still ends on it", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 700 }),
        route(2, "roads", [15, 14, 8], { capitalBurg: 2, capitalYear: 1000 })
      ] as any;
      evolveRoutes(new Set());
      expect(pack.routes[1].group).toBe("roads");
    });

    it("never decays the map's original roads or a locked one", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 100, lock: true })
      ] as any;
      evolveRoutes(new Set());
      expect(pack.routes.map((r: any) => r.group)).toEqual(["roads", "roads"]);
    });

    it("promotes its decayed road again when the burg becomes an established capital again", () => {
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }] as any;
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "trails", [9, 8, 3], { capitalBurg: 1, capitalYear: 100 })
      ] as any;
      mockedFindPath.mockReturnValue([9, 8, 3]);
      evolveRoutes(new Set([1]));

      expect(pack.routes).toHaveLength(2);
      expect(pack.routes[1]).toMatchObject({ group: "roads", capitalYear: 1000 });
    });
  });

  describe("roads to abandoned settlements", () => {
    beforeEach(() => {
      // burg 1 abandoned at cell 5, burg 2 alive at cell 6
      pack.burgs = [{ i: 0 }, { i: 1, cell: 5, removed: true }, { i: 2, cell: 6 }] as any;
    });

    it("turns a road that only reached abandoned settlements into a trail", () => {
      pack.routes = [route(0, "roads", [4, 5])] as any;
      evolveRoutes(new Set());
      expect(pack.routes[0].group).toBe("trails");
    });

    it("keeps a road that still reaches a living settlement", () => {
      pack.routes = [route(0, "roads", [5, 4, 6])] as any;
      evolveRoutes(new Set());
      expect(pack.routes[0].group).toBe("roads");
    });

    it("keeps a road segment between junctions that never touched a settlement", () => {
      pack.routes = [route(0, "roads", [10, 11, 12])] as any;
      evolveRoutes(new Set());
      expect(pack.routes[0].group).toBe("roads");
    });

    it("never changes a locked road", () => {
      pack.routes = [route(0, "roads", [4, 5], { lock: true })] as any;
      evolveRoutes(new Set());
      expect(pack.routes[0].group).toBe("roads");
    });

    it("does not treat a cell as abandoned when a living burg now stands on it", () => {
      pack.burgs = [{ i: 0 }, { i: 1, cell: 5, removed: true }, { i: 2, cell: 5 }] as any;
      pack.routes = [route(0, "roads", [4, 5])] as any;
      evolveRoutes(new Set());
      expect(pack.routes[0].group).toBe("roads");
    });
  });
});
