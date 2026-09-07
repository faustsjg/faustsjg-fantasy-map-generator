// Validates and sanitizes AI-generated heightmap DSL text before it is ever
// executed. The DSL itself (documented in src/data/heightmap-templates.ts) is
// `Tool count height rangeX rangeY`, one instruction per line — the AI never
// generates a map, it only ever writes lines in this fixed vocabulary, which
// this module parses into safe, already-clamped data. Nothing here evaluates
// model text as code; every step is data later fed to HeightmapGenerator's
// own typed methods (addHill, addPit, ...).
export const TERRAIN_TOOLS = [
  "Hill",
  "Pit",
  "Range",
  "Trough",
  "Strait",
  "Mask",
  "Invert",
  "Add",
  "Multiply",
  "Smooth"
] as const;
export type TerrainTool = (typeof TERRAIN_TOOLS)[number];

export interface TerrainStep {
  tool: TerrainTool;
  a2: string;
  a3: string;
  a4: string;
  a5: string;
}

export interface TerrainBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface RejectedLine {
  line: string;
  reason: string;
}

export interface ParsedTerrainDsl {
  steps: TerrainStep[];
  rejected: RejectedLine[];
}

const MAX_LINES = 10;
const MAX_COUNT = 20;
const STRAIT_DIRECTIONS = new Set(["vertical", "horizontal"]);
const INVERT_AXES = new Set(["both", "x", "y"]);
const MODIFY_SELECTORS = new Set(["all", "land"]);

function parseNumberToken(token: string): number | [number, number] | null {
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  const rangeMatch = /^(-?\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(token);
  if (!rangeMatch) return null;
  const lo = Number(rangeMatch[1]);
  const hi = Number(rangeMatch[2]);
  return lo <= hi ? [lo, hi] : [hi, lo];
}

// Parses a rangeX/rangeY token and clamps it into `[min, max]`, expressed as
// a "lo-hi" string (even a single point becomes "n-n", same as real
// templates already do, e.g. "60-60"). Returns null if the token isn't a
// plain percentage/range at all.
function clampRangeToken(token: string, min: number, max: number): string | null {
  const parsed = parseNumberToken(token);
  if (parsed === null) return null;

  const [lo, hi] = Array.isArray(parsed) ? parsed : [parsed, parsed];
  const clampedLo = Math.round(Math.min(Math.max(lo, min), max));
  const clampedHi = Math.round(Math.min(Math.max(hi, min), max));
  return `${clampedLo}-${clampedHi}`;
}

function clampCountToken(token: string, max: number): string | null {
  const parsed = parseNumberToken(token);
  if (parsed === null) return null;

  const clampOne = (n: number) => Math.min(Math.max(n, 0), max);
  if (Array.isArray(parsed)) return `${clampOne(parsed[0])}-${clampOne(parsed[1])}`;
  return String(clampOne(parsed));
}

function validateLine(
  tool: TerrainTool,
  a2: string,
  a3: string,
  a4: string,
  a5: string,
  bounds: TerrainBounds
): TerrainStep | string {
  if (tool === "Hill" || tool === "Pit" || tool === "Range" || tool === "Trough") {
    const count = clampCountToken(a2, MAX_COUNT);
    if (count === null) return `invalid count "${a2}"`;
    const height = clampCountToken(a3, 100);
    if (height === null) return `invalid height "${a3}"`;
    const rangeX = clampRangeToken(a4, bounds.xMin, bounds.xMax);
    if (rangeX === null) return `invalid rangeX "${a4}"`;
    const rangeY = clampRangeToken(a5, bounds.yMin, bounds.yMax);
    if (rangeY === null) return `invalid rangeY "${a5}"`;
    return { tool, a2: count, a3: height, a4: rangeX, a5: rangeY };
  }

  if (tool === "Strait") {
    const width = clampCountToken(a2, MAX_COUNT);
    if (width === null) return `invalid width "${a2}"`;
    if (!STRAIT_DIRECTIONS.has(a3)) return `invalid direction "${a3}", expected vertical or horizontal`;
    return { tool, a2: width, a3, a4: "0", a5: "0" };
  }

  if (tool === "Mask") {
    const power = parseNumberToken(a2);
    if (power === null || Array.isArray(power)) return `invalid power "${a2}"`;
    return { tool, a2: String(Math.min(Math.max(power, -10), 10)), a3: "0", a4: "0", a5: "0" };
  }

  if (tool === "Invert") {
    const probability = parseNumberToken(a2);
    if (probability === null || Array.isArray(probability)) return `invalid probability "${a2}"`;
    if (!INVERT_AXES.has(a3)) return `invalid axes "${a3}", expected both, x, or y`;
    return { tool, a2: String(Math.min(Math.max(probability, 0), 1)), a3, a4: "0", a5: "0" };
  }

  if (tool === "Add" || tool === "Multiply") {
    const amount = parseNumberToken(a2);
    if (amount === null || Array.isArray(amount)) return `invalid amount "${a2}"`;
    const clampedAmount = tool === "Add" ? Math.min(Math.max(amount, -50), 50) : Math.min(Math.max(amount, 0), 2);

    if (MODIFY_SELECTORS.has(a3)) return { tool, a2: String(clampedAmount), a3, a4: "0", a5: "0" };
    const selector = clampRangeToken(a3, 0, 100);
    if (selector === null) return `invalid selector "${a3}", expected all, land, or a 0-100 range`;
    return { tool, a2: String(clampedAmount), a3: selector, a4: "0", a5: "0" };
  }

  // Smooth
  const factor = parseNumberToken(a2);
  if (factor === null || Array.isArray(factor)) return `invalid factor "${a2}"`;
  return { tool, a2: String(Math.min(Math.max(factor, 0), 10)), a3: "0", a4: "0", a5: "0" };
}

// Models told "output only the DSL, no markdown fences" still add them
// often enough that this is worth handling directly rather than losing every
// line in a response to it: strip ``` fence lines and a leading bullet/
// numbering marker some models use for a "list" of instructions instead of
// bare lines.
const FENCE_LINE = /^```\w*$/;
const LIST_PREFIX = /^(?:[-*•]|\d+[.)])\s+/;

function stripWrapping(line: string): string {
  return line.replace(LIST_PREFIX, "");
}

export function parseTerrainDsl(text: string, bounds: TerrainBounds): ParsedTerrainDsl {
  const allLines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !FENCE_LINE.test(line))
    .map(stripWrapping);

  const rejected: RejectedLine[] = [];
  const consideredLines = allLines.slice(0, MAX_LINES);
  for (const line of allLines.slice(MAX_LINES)) {
    rejected.push({ line, reason: `dropped: more than ${MAX_LINES} lines` });
  }

  const steps: TerrainStep[] = [];
  for (const line of consideredLines) {
    const allTokens = line.split(/\s+/);
    if (allTokens.length < 5) {
      rejected.push({ line, reason: "expected 5 fields: tool count height rangeX rangeY" });
      continue;
    }

    // a model that ignores "output only the DSL" often appends a trailing
    // comment on the same line instead of a separate one - the first 5
    // fields are still a complete, valid instruction, so use those rather
    // than rejecting the whole line over trailing text
    const [tool, a2, a3, a4, a5] = allTokens;
    if (!(TERRAIN_TOOLS as readonly string[]).includes(tool)) {
      rejected.push({ line, reason: `unknown tool "${tool}"` });
      continue;
    }

    const result = validateLine(tool as TerrainTool, a2, a3, a4, a5, bounds);
    if (typeof result === "string") {
      rejected.push({ line, reason: result });
      continue;
    }

    steps.push(result);
  }

  return { steps, rejected };
}

// Reserializes already-validated steps into the same textual DSL format, so
// it can be saved inside the map file and reproduced without calling any AI.
export function formatTerrainDsl(steps: TerrainStep[]): string {
  return steps.map(s => `${s.tool} ${s.a2} ${s.a3} ${s.a4} ${s.a5}`).join("\n");
}
