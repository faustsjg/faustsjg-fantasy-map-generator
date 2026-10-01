import type { Route } from "@/generators/routes-generator";

// Eras never regenerate pack.routes from scratch: roads are what survives longest in reality
// (Barcino's cardo and decumanus are still Barcelona's streets), so the network generated with the
// map carries over from era to era. This only changes it at the edges, once per era, after the
// era's political map is settled:
// - a capital that has held its status for two eras running and still has no road gets one, built
//   to the nearest cell already on a road - an established center of power joins the network, a
//   capital that lasts a single era doesn't
// - a road built that way for a capital that has since lost its status decays into a trail once
//   enough time has passed; the map's original network never decays this way, it's the ancient
//   backbone (the Roman roads) that outlives the powers that built it
// - a road that only ever led to settlements that have since been abandoned decays into a trail
// Route names are kept as they are - a road keeps the name it was built with (Via Augusta), even
// after the town it was named for drifts to a new name.

// years a road built for a capital survives after that burg stops being a capital
const CAPITAL_ROAD_DECAY_YEARS = 300;

// a road this module built for a capital remembers which burg it serves and the last year that
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
}

// A road segment between two junctions touches no burg at all and is left alone - only a road
// that reached at least one abandoned settlement and no living one has lost its reason to exist.
// A locked route never changes.
// Read from pack.burgs rather than pack.cells.burg, which an era restore doesn't roll back.
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

// A road another road still ends on stays, so no road is left leading into a trail. The cell
// where this road itself joined the network doesn't count: the road it joined may well end there.
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
    const isJoined = routes.some(other => other !== route && other.group === "roads" && endsOnThisRoad(other));
    if (!isJoined) route.group = "trails";
  }
}

function buildRoadsToCapitals(capitals: Set<number>, previousCapitals: Set<number>): void {
  const routes = pack.routes as EraRoute[];
  const roadCells = new Set<number>();
  for (const route of routes) {
    if (route.group === "roads") for (const point of route.points) roadCells.add(point[2]);
  }
  if (!roadCells.size) return; // a map with no road network at all has nothing to connect to

  for (const burgId of capitals) {
    if (!previousCapitals.has(burgId)) continue; // not established yet
    const capital = pack.burgs[burgId];
    if (!capital?.i || capital.removed || roadCells.has(capital.cell)) continue;

    // a capital whose old road decayed gets that road back rather than a second one beside it,
    // as long as it still leads onto the road network
    const decayed = routes.find(r => r.capitalBurg === burgId && r.group === "trails" && !r.lock);
    let route: EraRoute | undefined;
    const decayedEnd = decayed?.points.at(-1);
    if (decayed && decayedEnd && roadCells.has(decayedEnd[2])) {
      decayed.group = "roads";
      route = decayed;
    } else {
      // undefined when no road is reachable by land (a capital on a roadless island)
      route = Routes.connect(capital.cell, "roads", cellId => roadCells.has(cellId));
      if (!route) continue;
      route.name = Routes.generateName(route);
      route.capitalBurg = burgId;
    }

    route.capitalYear = options.year;
    for (const point of route.points) roadCells.add(point[2]);
  }
}
