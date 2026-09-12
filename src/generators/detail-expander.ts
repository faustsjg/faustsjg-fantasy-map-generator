// Regenerates the world at a higher cell density while keeping the current heightmap's shape.
import { mean, quadtree } from "d3";
import { ErasePipeline } from "@/generators/generation-pipeline";
import { ensureEl, isWater, SEA_LEVEL } from "@/utils";
import type { Point } from "./voronoi";

// Same table the "Points number" sliders already use (public/modules/ui/options.js's cellsDensityMap)
export const CELLS_DENSITY_MAP: Record<number, number> = {
  1: 1000,
  2: 2000,
  3: 5000,
  4: 10000,
  5: 20000,
  6: 30000,
  7: 40000,
  8: 50000,
  9: 60000,
  10: 70000,
  11: 80000,
  12: 90000,
  13: 100000
};

/**
 * Scale a flat count (cultures, states) up by the same sublinear rate getTownsNumber already
 * uses for burgs, so a denser world doesn't keep the exact same handful of cultures/states.
 */
export function scaledCount(current: number, oldCells: number, newCells: number, max: number): number {
  const growth = (newCells / oldCells) ** 0.35;
  return Math.min(Math.round(current * growth), max);
}

class DetailExpanderModule {
  /**
   * Resample the terrain onto a denser grid (same coastline, finer resolution), then rebuild
   * everything downstream (cultures, burgs, states, biomes, rivers, religions, provinces,
   * markets...) fresh against it - the same "erase" pipeline the Heightmap Editor already runs
   * after a manual heightmap edit. More populated cells means more towns/cultures/states on
   * their own, since those generators already scale their target counts off the populated cell
   * count; this only widens that count, it never touches the macro land/sea shape.
   */
  async process(densityLevel: number, erosion: boolean): Promise<void> {
    const cellsInput = ensureEl<HTMLInputElement>("pointsInput");
    const oldCells = Number(cellsInput.dataset.cells) || grid.points.length;
    const newCells = CELLS_DENSITY_MAP[densityLevel] ?? CELLS_DENSITY_MAP[13];
    cellsInput.value = String(densityLevel);
    cellsInput.dataset.cells = String(newCells);

    const oldPoints = grid.points;
    const oldHeights = grid.cells.h;

    grid = Grid.generate(seed, graphWidth, graphHeight);
    this.resampleHeightmap(oldPoints, oldHeights);
    this.scaleUpCulturesAndStates(oldCells, newCells);

    pack.cultures = [];
    pack.burgs = [];
    pack.states = [];
    pack.provinces = [];
    pack.religions = [];
    pack.relief = [];

    await ErasePipeline.run({ erosion });
  }

  // burgs/towns already scale their own target count off the populated cell count (see
  // getTownsNumber in burgs-generator.ts); cultures and states don't - they're a flat count read
  // straight off their input - so grow those inputs too, at the same sublinear rate the town
  // count formula uses, or a denser world would keep the same handful of cultures/states forever
  private scaleUpCulturesAndStates(oldCells: number, newCells: number): void {
    const culturesInput = ensureEl<HTMLInputElement>("culturesInput");
    const culturesMax = Number(culturesInput.max) || Number.POSITIVE_INFINITY;
    const newCulturesCount = scaledCount(Number(culturesInput.value), oldCells, newCells, culturesMax);
    culturesInput.value = String(newCulturesCount);
    ensureEl<HTMLInputElement>("culturesOutput").value = String(newCulturesCount);

    const statesNumber = ensureEl<HTMLInputElement>("statesNumber");
    const statesMax = Number(statesNumber.max) || Number.POSITIVE_INFINITY;
    const newStatesCount = scaledCount(Number(statesNumber.value), oldCells, newCells, statesMax);
    statesNumber.value = String(newStatesCount);
  }

  private resampleHeightmap(oldPoints: Point[], oldHeights: Uint8Array): void {
    const oldTree = quadtree(oldPoints.map(([x, y], i): [number, number, number] => [x, y, i]));
    const heights = new Uint8Array(grid.points.length);

    grid.points.forEach(([x, y]: Point, i: number) => {
      const nearest = oldTree.find(x, y, Infinity)?.[2];
      heights[i] = nearest !== undefined ? oldHeights[nearest] : 0;
    });

    grid.cells.h = heights;
    this.smoothHeightmap();
  }

  // resampling from a sparser grid leaves flat plateaus at the old cell boundaries; average each
  // cell with its neighbors so the extra resolution reads as terrain, not a mosaic
  private smoothHeightmap(): void {
    grid.cells.h.forEach((height: number, cellId: number) => {
      const heights = [height, ...grid.cells.c[cellId].map((c: number) => grid.cells.h[c])];
      const meanHeight = mean(heights) as number;
      grid.cells.h[cellId] = isWater(cellId, grid)
        ? Math.min(meanHeight, SEA_LEVEL - 1)
        : Math.max(meanHeight, SEA_LEVEL);
    });
  }
}

export const DetailExpander = new DetailExpanderModule();
