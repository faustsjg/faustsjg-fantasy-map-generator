import { beforeEach, describe, expect, it, vi } from "vitest";
import { evolveRoutes } from "./route-evolution";

const route = (i: number, group: string, cells: number[], extra = {}) => ({
  i,
  group,
  feature: 1,
  points: cells.map(cellId => [cellId, cellId, cellId]),
  ...extra
});

describe("evolveRoutes", () => {
  let connect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    connect = vi.fn();
    globalThis.Routes = { sync: vi.fn(), connect, generateName: vi.fn(() => "New Road") } as any;
    globalThis.options = { year: 1000 } as any;
    globalThis.pack = {
      states: [{ i: 0 }],
      burgs: [{ i: 0 }],
      routes: [],
      cells: { burg: [] }
    } as any;
  });

  describe("roads to capitals", () => {
    beforeEach(() => {
      pack.routes = [route(0, "roads", [1, 2, 3])] as any;
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }] as any;
      pack.burgs = [{ i: 0 }, { i: 1, cell: 9 }] as any;
    });

    it("builds a named road from an established capital to the nearest road cell", () => {
      const built = route(1, "roads", [9, 8, 3]);
      connect.mockReturnValue(built);

      evolveRoutes(new Set([1]));

      expect(connect).toHaveBeenCalledTimes(1);
      const [cellId, group, isExit] = connect.mock.calls[0];
      expect(cellId).toBe(9);
      expect(group).toBe("roads");
      expect(isExit(3)).toBe(true);
      expect(isExit(7)).toBe(false);
      expect(built).toMatchObject({ name: "New Road", capitalBurg: 1, capitalYear: 1000 });
    });

    it("waits until a capital has held its status for a second era", () => {
      evolveRoutes(new Set());
      expect(connect).not.toHaveBeenCalled();
    });

    it("lets a later capital join a road built for an earlier one in the same era", () => {
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }, { i: 2, capital: 2 }] as any;
      pack.burgs = [{ i: 0 }, { i: 1, cell: 9 }, { i: 2, cell: 20 }] as any;
      connect.mockReturnValueOnce(route(1, "roads", [9, 8, 3])).mockReturnValueOnce(undefined);

      evolveRoutes(new Set([1, 2]));

      const isExitForSecond = connect.mock.calls[1][2];
      expect(isExitForSecond(8)).toBe(true);
    });

    it("leaves a capital already on a road alone", () => {
      pack.burgs = [{ i: 0 }, { i: 1, cell: 2 }] as any;
      evolveRoutes(new Set([1]));
      expect(connect).not.toHaveBeenCalled();
    });

    it("skips removed states and does nothing on a map with no roads at all", () => {
      pack.routes = [route(0, "trails", [1, 2, 3])] as any;
      evolveRoutes(new Set([1]));
      expect(connect).not.toHaveBeenCalled();

      pack.routes = [route(0, "roads", [1, 2, 3])] as any;
      pack.states = [{ i: 0 }, { i: 1, capital: 1, removed: true }] as any;
      evolveRoutes(new Set([1]));
      expect(connect).not.toHaveBeenCalled();
    });

    it("survives a capital with no road reachable by land", () => {
      connect.mockReturnValue(undefined);
      expect(() => evolveRoutes(new Set([1]))).not.toThrow();
      expect(pack.routes).toHaveLength(1);
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

    it("stays a road while another road still ends on it", () => {
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "roads", [9, 8, 3], { capitalBurg: 1, capitalYear: 700 }),
        route(2, "roads", [15, 14, 8])
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

    it("restores a decayed road when its burg becomes an established capital again", () => {
      pack.states = [{ i: 0 }, { i: 1, capital: 1 }] as any;
      pack.routes = [
        route(0, "roads", [1, 2, 3]),
        route(1, "trails", [9, 8, 3], { capitalBurg: 1, capitalYear: 100 })
      ] as any;
      evolveRoutes(new Set([1]));
      expect(connect).not.toHaveBeenCalled();
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
