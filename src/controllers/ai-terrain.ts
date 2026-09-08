import { pointer } from "d3";
import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import { formatTerrainDsl, parseTerrainDsl, type TerrainBounds } from "@/generators/terrain-dsl";
import { findEl, minmax } from "../utils";

// How far, in % of map width/height, the clicked point's editable window
// extends in each direction — this is what "the ranges come from wherever
// the user clicked" means in practice: the AI can only place terrain inside
// this window, whatever coordinates it writes into the DSL.
const CLICK_RADIUS_PERCENT = 12;

// stopMapPlacement() only clears .pressed off buttons inside #addFeature;
// this button lives in the general Tools list, so it must unpress itself.
function stop(): void {
  stopMapPlacement();
  findEl("addAiTerrain")?.classList.remove("pressed");
}

function toggle(): void {
  if (findEl("addAiTerrain")?.classList.contains("pressed")) {
    stop();
    return;
  }

  toggleMapPlacement("addAiTerrain", onMapClick, "Click on the map to pick where the AI-generated terrain appears");
}

function boundsAroundPoint(xPercent: number, yPercent: number): TerrainBounds {
  return {
    xMin: Math.round(minmax(xPercent - CLICK_RADIUS_PERCENT, 0, 100)),
    xMax: Math.round(minmax(xPercent + CLICK_RADIUS_PERCENT, 0, 100)),
    yMin: Math.round(minmax(yPercent - CLICK_RADIUS_PERCENT, 0, 100)),
    yMax: Math.round(minmax(yPercent + CLICK_RADIUS_PERCENT, 0, 100))
  };
}

function onMapClick(event: MouseEvent): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  const xPercent = (point[0] / graphWidth) * 100;
  const yPercent = (point[1] / graphHeight) * 100;
  const bounds = boundsAroundPoint(xPercent, yPercent);

  stop();
  void Controllers.AiGenerator.open({
    instructions: buildInstructions(bounds),
    placeholder:
      'Describe the terrain, e.g. "a narrow strait like the Bosphorus" or "a bigger sea in the middle, like the Aegean"',
    onApply: result => onApply(result, bounds)
  });
}

function buildInstructions(bounds: TerrainBounds): string {
  return `You are writing lines for the Fantasy Map Generator's heightmap DSL — not a natural-language description, not code, just these lines. The next message describes what terrain is wanted; translate it into DSL, nothing else.

Format: one instruction per line, exactly 5 space-separated fields: "Tool count height rangeX rangeY".
Tools: Hill, Pit, Range, Trough, Strait, Mask, Invert, Add, Multiply, Smooth.
- count and height accept a number or a "min-max" range (e.g. "1" or "20-30").
- rangeX and rangeY are percentages of the map (0-100) as a "min-max" pair, and must stay within ${bounds.xMin}-${bounds.xMax} (rangeX) and ${bounds.yMin}-${bounds.yMax} (rangeY) — that is the area the user clicked.
- Strait: "Strait width direction 0 0" where direction is "vertical" or "horizontal".
- Mask: "Mask power 0 0 0". Smooth: "Smooth factor 0 0 0".
- Invert: "Invert probability axes 0 0" where axes is "both", "x", or "y".
- Add/Multiply: "Add amount selector 0 0" where selector is "all", "land", or a height range like "50-100".

There is no dedicated sea/lake/bay tool: land is height >= 20, water is below
it, so carve one out with Pit (a low height, e.g. "Pit 1 5-15 rangeX rangeY")
or lower an area with Multiply/Add and a height-range selector below 20.

Output ONLY the DSL lines, nothing else — no explanation, no restating the
request, no markdown code fences, no commentary before or after any line.
Every line must start with one of the exact tool names above. At most 10
lines.`;
}

function onApply(result: string, bounds: TerrainBounds): void {
  const { steps, rejected } = parseTerrainDsl(result, bounds);

  if (!steps.length) {
    const reasons = rejected.map(r => r.reason).join("; ");
    tip(`No valid terrain instructions found${reasons ? `: ${reasons}` : ""}`, true, "error", 6000);
    return;
  }

  window.HeightmapGenerator.setGraph(grid);
  for (const step of steps) {
    window.HeightmapGenerator.addStep(step.tool, step.a2, step.a3, step.a4, step.a5);
  }
  grid.cells.h = window.HeightmapGenerator.heights!;

  for (const i of pack.cells.i) {
    pack.cells.h[i] = grid.cells.h[pack.cells.g[i]];
  }

  // Save the validated DSL, not the model's raw text, so the map stays
  // reproducible from the file alone without ever calling AI again.
  pack.aiTerrainEdits = pack.aiTerrainEdits ?? [];
  pack.aiTerrainEdits.push(formatTerrainDsl(steps));

  Layers.draw("heightmap", "ocean", "landmass", "lakes", "coastline");
  refreshEditors();

  const message =
    rejected.length > 0
      ? `Applied ${steps.length} terrain step(s); ${rejected.length} line(s) were rejected and ignored.`
      : `Applied ${steps.length} terrain step(s).`;
  tip(message, true, "success", 6000);
}

export const AiTerrain = { toggle };
