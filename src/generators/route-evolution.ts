import type { Route } from "@/generators/routes-generator";
import { findPath } from "@/utils";

// Eras never regenerate pack.routes from scratch: roads are what survives longest in reality
// (Barcino's cardo and decumanus are still Barcelona's streets), so the network generated with the
// map carries over from era to era. This only changes it at the edges, once per era, after the
// era's political map is settled:
// - a capital that has held its status for two eras running and still has no road gets one, to
//   the nearest cell already on a road. Wherever that way follows an existing trail, the trail
//   itself is promoted to a road (split off from the rest of the trail if needed, keeping its
//   name); only the stretches with no trail at all are built new
// - once that burg has stopped being a capital long enough, every stretch promoted or built for
//   it decays back into a trail; the map's original roads never decay this way, they're the
//   ancient backbone (the Roman roads) that outlives the powers that built it
// - a road that only ever led to settlements that have since been abandoned decays into a trail
// Route names are kept as they are - a road keeps the name it was built with (Via Augusta), even
// after the town it was named for drifts to a new name.

// years a road promoted or built for a capital survives after that burg stops being a capital
const CAPITAL_ROAD_DECAY_YEARS = 300;

// a route promoted or built for a capital remembers which burg it serves and the last year that
// burg was a capital - saved with the map as part of pack.routes, no other code needs to know
type EraRoute = Route & { capitalBurg?: number; capitalYear?: number };

// `previousCapitals`: burg ids that were capitals in the previous era
export function evolveRoutes(previousCapitals: Set<number>): void {
  if (!pack.routes) return;
  // Routes' pathfinding cost reads its own connections cache, which follows whatever pack.routes
  // was when it was last built - an era restore (eras-editor.ts's selectEra()) replaces pack.routes
  Routes.sync();

  const capitals = new Set(pack.states.filter(s => s.i && !s.removed).map(s => s.capital));
  decayAbandonedRoads();
  decayFormerCapitalRoads(capitals);
  buildRoadsToCapitals(capitals, previousCapitals);

  pack.cells.routes = Routes.buildLinks(pack.routes);
  Routes.sync();
}

// A road segment between two junctions touches no burg at all and is left alone - only a road
// that reached at least one abandoned settlement and no living one has lost its reason to exist.
// A locked route never changes.
// Read from pack.burgs rather than pack.cells.burg, so it holds whatever state cells.burg is in.
function decayAbandonedRoads(): void {
  const livingCells = new Set(pack.burgs.filter(b => b.i && !b.removed).map(b => b.cell));
  const abandonedCells = new Set(pack.burgs.filter(b => b.i && b.removed && !livingCells.has(b.cell)).map(b => b.cell));
  if (!abandonedCells.size) return;

  for (const route of pack.routes) {
    if (route.group !== "roads" || route.lock) continue;
    const cells = route.points.map(point => point[2]);
    const reachesAbandoned = cells.some(cellId => abandonedCells.has(cellId));
    const reachesLiving = cells.some(cellId => livingCells.has(cellId));
    if (reachesAbandoned && !reachesLiving) route.group = "trails";
  }
}

// A road another capital's road still ends on stays, so no road is left leading into a trail. The
// stretches of one capital's road end on each other, so they're left out of that check and decay
// together; so is the cell where a road itself joined the network, since the road it joined may
// well end there.
function decayFormerCapitalRoads(capitals: Set<number>): void {
  const routes = pack.routes as EraRoute[];
  for (const route of routes) {
    if (route.capitalBurg !== undefined && capitals.has(route.capitalBurg)) route.capitalYear = options.year;
  }

  for (const route of routes) {
    if (route.group !== "roads" || route.lock || route.capitalBurg === undefined) continue;
    if (options.year - (route.capitalYear ?? options.year) < CAPITAL_ROAD_DECAY_YEARS) continue;

    const cells = new Set(route.points.slice(0, -1).map(point => point[2]));
    const endsOnThisRoad = (other: EraRoute) =>
      [other.points[0], other.points.at(-1)].some(point => point !== undefined && cells.has(point[2]));
    const isJoined = routes.some(
      other =>
        other !== route && other.group === "roads" && other.capitalBurg !== route.capitalBurg && endsOnThisRoad(other)
    );
    if (!isJoined) route.group = "trails";
  }
}

function buildRoadsToCapitals(capitals: Set<number>, previousCapitals: Set<number>): void {
  const roadCells = new Set<number>();
  for (const route of pack.routes) {
    if (route.group === "roads") for (const point of route.points) roadCells.add(point[2]);
  }
  if (!roadCells.size) return; // a map with no road network at all has nothing to connect to

  for (const burgId of capitals) {
    if (!previousCapitals.has(burgId)) continue; // not established yet
    const capital = pack.burgs[burgId];
    if (!capital?.i || capital.removed || roadCells.has(capital.cell)) continue;

    // same cost Routes uses for its own land routes, so the way follows existing trails where it can;
    // null when no road is reachable by land (a capital on a roadless island)
    const isExit = (cellId: number) => roadCells.has(cellId);
    const path = findPath(capital.cell, isExit, Routes.getLandPathCost.bind(Routes), pack);
    if (!path) continue;

    for (const route of buildRoadAlong(path, burgId)) {
      for (const point of route.points) roadCells.add(point[2]);
    }
    Routes.sync(); // the next capital's way should see this one as an existing connection
  }
}

// Splits `path` into runs that follow one trail and runs that follow none: each trail run promotes
// that stretch of the trail, each other run becomes a new road. Returns every route now a road.
function buildRoadAlong(path: number[], burgId: number): EraRoute[] {
  const roads: EraRoute[] = [];
  for (const run of splitIntoRuns(path)) {
    const route = run.onTrail ? promoteTrailStretch(run.cells) : addNewRoad(run.cells);
    route.capitalBurg = burgId;
    route.capitalYear = options.year;
    roads.push(route);
  }
  return roads;
}

type Run = { cells: number[]; onTrail: boolean };

// Consecutive path edges grouped by which (unlocked) trail they follow, if any - a run's cells
// include both ends, so consecutive runs share their boundary cell.
function splitIntoRuns(path: number[]): Run[] {
  const trailByEdge = new Map<string, EraRoute>();
  for (const route of pack.routes as EraRoute[]) {
    if (route.group !== "trails" || route.lock) continue;
    for (let k = 0; k < route.points.length - 1; k++) {
      trailByEdge.set(edgeKey(route.points[k][2], route.points[k + 1][2]), route);
    }
  }

  const runs: Run[] = [];
  let current: { cells: number[]; trail: EraRoute | undefined } | undefined;
  for (let i = 0; i < path.length - 1; i++) {
    const trail = trailByEdge.get(edgeKey(path[i], path[i + 1]));
    if (current && current.trail === trail) {
      current.cells.push(path[i + 1]);
      continue;
    }
    if (current) runs.push({ cells: current.cells, onTrail: current.trail !== undefined });
    current = { cells: [path[i], path[i + 1]], trail };
  }
  if (current) runs.push({ cells: current.cells, onTrail: current.trail !== undefined });
  return runs;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// The stretch of a trail between `cells`' two ends becomes a road; whatever lies beyond them on
// either side stays a trail, as routes of its own with the same name and tags.
function promoteTrailStretch(cells: number[]): EraRoute {
  const firstEdge = edgeKey(cells[0], cells[1]);
  const trail = (pack.routes as EraRoute[]).find(
    route =>
      route.group === "trails" &&
      !route.lock &&
      route.points.some((point, k) => k > 0 && edgeKey(route.points[k - 1][2], point[2]) === firstEdge)
  );
  const routeCells = trail?.points.map(point => point[2]) ?? [];
  const ends = [routeCells.indexOf(cells[0]), routeCells.indexOf(cells[cells.length - 1])];
  if (!trail || ends.includes(-1)) return addNewRoad(cells);

  const from = Math.min(...ends);
  const to = Math.max(...ends);
  const before = trail.points.slice(0, from + 1);
  const after = trail.points.slice(to);
  trail.points = trail.points.slice(from, to + 1);
  trail.group = "roads";

  const { name, feature, capitalBurg, capitalYear } = trail;
  for (const points of [before, after]) {
    if (points.length < 2) continue;
    const piece: EraRoute = { i: Routes.getNextId(), group: "trails", name, feature, points };
    if (capitalBurg !== undefined) Object.assign(piece, { capitalBurg, capitalYear });
    pack.routes.push(piece);
  }
  return trail;
}

function addNewRoad(cells: number[]): EraRoute {
  const points = cells.map(cellId => {
    const burg = pack.burgs[pack.cells.burg[cellId]];
    const [x, y] = burg?.i && !burg.removed ? [burg.x, burg.y] : pack.cells.p[cellId];
    return [x, y, cellId];
  });
  const route: EraRoute = { i: Routes.getNextId(), group: "roads", feature: pack.cells.f[cells[0]], points };
  route.name = Routes.generateName(route);
  pack.routes.push(route);
  return route;
}
