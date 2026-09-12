// The AI Terrain influence-area preview, drawn on #debug while the tool is active — mirrors
// brush-circle.ts's pattern, but as a rectangle sized in % of the map, matching the DSL bounds
// the click will actually produce (never a separately-computed approximation).
import type { TerrainBounds } from "@/generators/terrain-dsl";

export function moveInfluenceBox(bounds: TerrainBounds): void {
  const x = (bounds.xMin / 100) * graphWidth;
  const y = (bounds.yMin / 100) * graphHeight;
  const width = ((bounds.xMax - bounds.xMin) / 100) * graphWidth;
  const height = ((bounds.yMax - bounds.yMin) / 100) * graphHeight;

  const box = document.getElementById("terrainInfluenceBox");
  if (!box) {
    const html = /* html */ `<rect id="terrainInfluenceBox" x="${x}" y="${y}" width="${width}" height="${height}"></rect>`;
    document.getElementById("debug")?.insertAdjacentHTML("afterbegin", html);
    return;
  }

  box.setAttribute("x", String(x));
  box.setAttribute("y", String(y));
  box.setAttribute("width", String(width));
  box.setAttribute("height", String(height));
}

export function removeInfluenceBox(): void {
  document.getElementById("terrainInfluenceBox")?.remove();
}
