import { compareVersions } from "@/services/versioning";

// This fork keeps its own map data (eras, AI Terrain edits) in the same line-per-field .map format
// as Azgaar's, but far past Azgaar's own fields. Azgaar appends each new field at the next free
// index, so a field of ours placed right after its last one gets a second meaning with the next
// upstream release - eras at 52 collided with Azgaar's journeys, added at 52 in 1.149.3.
export const ERAS_FIELD = 100;
export const AI_TERRAIN_EDITS_FIELD = 101;

// maps this fork saved before it took Azgaar's 1.149.3 kept eras at 52 and AI Terrain edits at 53,
// where Azgaar's own maps of that age have nothing
const LEGACY_LAYOUT_BEFORE = "1.149.3";

export function getForkFieldIndices(mapVersion: string): { eras: number; aiTerrainEdits: number; isLegacy: boolean } {
  const isLegacy = compareVersions(mapVersion, LEGACY_LAYOUT_BEFORE).isOlder;
  return isLegacy
    ? { eras: 52, aiTerrainEdits: 53, isLegacy }
    : { eras: ERAS_FIELD, aiTerrainEdits: AI_TERRAIN_EDITS_FIELD, isLegacy };
}
