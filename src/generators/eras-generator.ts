import { mean, sum } from "d3";
import type { Burg } from "@/generators/burgs-generator";
import type { Character } from "@/generators/characters-generator";
import { Characters } from "@/generators/characters-generator";
import { getMilitaryRatio, getTroopsPerArea } from "@/generators/military-generator";
import type { Province } from "@/generators/provinces-generator";
import { Rebellions } from "@/generators/rebellions-generator";
import type { State } from "@/generators/states-generator";
import { mutateName } from "@/generators/toponym-drift";
import { Wars } from "@/generators/wars-generator";
import { gauss, minmax, P, ra, rn } from "../utils";

declare global {
  var Eras: ErasModule;
}

export interface Era {
  year: number;
  states: State[];
  cellsState: number[];
  // States.regenerate() rebuilds provinces (Provinces.regenerate(false)) alongside states every
  // era, so a province layout belongs to its own era just as much as cellsState does - without
  // capturing it too, scrubbing to an old era would draw the "provinces" map layer from whatever
  // province data happens to be live (the last-generated era's), not the era actually selected
  provinces: Province[];
  cellsProvince: number[];
  // burgs get pruned (small non-capital settlements), renamed (toponym drift) and reassigned as
  // capitals (a splinter/rebel state's seat) in place every era, exactly like states/provinces -
  // without capturing them too, an old era's burg icons/names/capital flags would stay whatever
  // the last-generated era left them as
  burgs: Burg[];
  characters: Character[];
  // human-readable notes on disease/famine events that hit this era (subsistence crises, the rare
  // great pandemic) - population changes gradually every era regardless, so unlike a state's birth
  // or death there's no way to detect "an epidemic happened" by diffing two snapshots; the era that
  // generated them writes these down directly, for eras-editor.ts's event log to show as-is
  epidemicEvents: string[];
  // growPopulation() rewrites pack.cells.pop (rural population) every era exactly like it rewrites
  // burg.population (already captured via burgs above) - without this, scrubbing to an old era
  // would leave the map's rural population showing whatever the last-generated era left it at,
  // and a "regenerate from here" run would compute this era's carrying-capacity ceiling from the
  // wrong (later, larger) population
  cellsPop: number[];
}

// Chance that a state survives into the next era, based on its share of the total settled area
// of that era (bigger states are more likely to keep their throne, small ones more likely to be
// swallowed or collapse) plus a military bonus/penalty: a well-garrisoned state resists
// dissolution beyond what its territory alone would suggest, Civilization-style - Rome doesn't
// fall just because a province revolts, a strong army keeps it together. militaryRatio defaults
// to 1 (neutral, no effect) when the caller has no military data to compare against.
export function survivalChance(stateArea: number, totalArea: number, stateCount: number, militaryRatio = 1): number {
  if (totalArea <= 0 || stateCount <= 0) return 0;
  const share = stateArea / totalArea;
  const areaBasedChance = minmax(share * stateCount * 0.6, 0.05, 0.9);
  const militaryBonus = minmax((militaryRatio - 1) * 0.15, -0.15, 0.3);
  return minmax(areaBasedChance + militaryBonus, 0.05, 0.95);
}

// Pre-industrial population grew roughly 0.1-0.5%/year on average over the long run, with heavy
// swings (famine, prosperity) and outright decline in bad stretches - rolled once per state per
// era, then compounded over however many years that era spans. Urban population (burg.population)
// gets its own, lower and more volatile rate than rural (cells.pop): cities were denser and less
// sanitary, so chronic disease ate into their growth even in an ordinary era with no epidemic -
// this is that "background" mortality, folded straight into growth rather than a separate event.
const RURAL_GROWTH_MEAN_PCT = 0.3;
const RURAL_GROWTH_SD_PCT = 0.15;
const RURAL_GROWTH_MIN_PCT = -0.2;
const RURAL_GROWTH_MAX_PCT = 0.8;
const URBAN_GROWTH_MEAN_PCT = 0.15;
const URBAN_GROWTH_SD_PCT = 0.25;
const URBAN_GROWTH_MIN_PCT = -0.5;
const URBAN_GROWTH_MAX_PCT = 0.8;

// a province annexed THIS era pays for it in people, not just political unrest - war, pillage,
// displacement and the disease that follows armies and sieges, overriding the state's own growth
// roll for just that province, just this once
const WAR_POPULATION_RETENTION_MEAN = 0.72;
const WAR_POPULATION_RETENTION_SD = 0.1;
const WAR_POPULATION_RETENTION_MIN = 0.45;
const WAR_POPULATION_RETENTION_MAX = 0.92;

// population can't compound forever - each cell/burg is capped at a multiple of whatever
// population it had when this generate() run started (captured once, see generate() below),
// standing in for a Malthusian agricultural/urban ceiling
const CARRYING_CAPACITY_MULTIPLIER = 3;

// a state pressing up against its own carrying-capacity ceiling risks a subsistence crisis -
// famine and the disease that rides with it, a Malthusian correction rather than an arbitrary
// dice roll: it only ever hits realms that grew too big for their land to support
const OVERCROWDING_THRESHOLD = 0.85; // population/ceiling ratio that starts risking a crisis
const OVERCROWDING_CRISIS_CHANCE = 0.25; // per era, once past the threshold
const SUBSISTENCE_CRISIS_RETENTION_MEAN = 0.75;
const SUBSISTENCE_CRISIS_RETENTION_SD = 0.1;
const SUBSISTENCE_CRISIS_RETENTION_MIN = 0.55;
const SUBSISTENCE_CRISIS_RETENTION_MAX = 0.9;

// the rare, civilization-scale pandemic (Black Death, Plague of Justinian) - unlike the layers
// above, this needs a plausible origin and a real spread mechanism, not just a dice roll. It
// prefers a port state as its epicenter (the historical Black Death arrived by Genoese trading
// ship), then spreads outward through state.neighbors, losing severity with each hop rather than
// blanketing the whole map at once - some realms catch it fully, others only glancingly, many not
// at all, same as the real thing.
const PANDEMIC_CHANCE_PER_YEAR = 0.0004; // ~4% per 100-year era - a once-in-centuries event
const PANDEMIC_RETENTION_MEAN = 0.6; // ~40% loss at the epicenter, matching Black Death estimates
const PANDEMIC_RETENTION_SD = 0.12;
const PANDEMIC_RETENTION_MIN = 0.3;
const PANDEMIC_RETENTION_MAX = 0.85;
const PANDEMIC_SPREAD_CHANCE = 0.55; // chance each neighboring state also catches it
const PANDEMIC_SPREAD_SEVERITY_FALLOFF = 0.7; // severity retained per hop away from the epicenter
const PANDEMIC_MAX_HOPS = 3; // stop the spread a few realms out, not an unbounded chain reaction

// Political acceptance of a conqueror (Rebellions' own unrest, which decays over
// RECENT_ANNEXATION_DECAY_YEARS = 150) and cultural assimilation fade at very different speeds -
// real conquered regions routinely stayed culturally distinct for centuries after the fighting
// stopped (Wales, Brittany, Catalonia). Assimilation only starts rolling well past that political
// window, and even then it's a modest, capped per-era chance - many conquered provinces are meant
// to never assimilate at all, which is the historically common outcome, not the exception.
const ASSIMILATION_MIN_YEARS = 300;
const ASSIMILATION_BASE_CHANCE = 0.08;
const ASSIMILATION_CHANCE_PER_CENTURY_PAST_MINIMUM = 0.03;
const ASSIMILATION_MAX_CHANCE = 0.3;

class ErasModule {
  // Generate `eraCount` snapshots of the political layer, `yearsPerEra` years apart.
  // Geography (pack.cells.h/biome/rivers/...) is untouched — only pack.states and
  // pack.cells.state are regenerated each era, inheriting from the previous one.
  generate(eraCount: number, yearsPerEra: number): Era[] {
    if (eraCount < 1) return [];

    // captured once, before any era runs - growPopulation() caps each cell/burg at a multiple of
    // its population right now, not a value re-derived from Population's own generation formula
    // (which bakes in a one-time random multiplier growPopulation() has no way to reconstruct, and
    // would otherwise clip an ordinarily-sized burg's population down on the very first era)
    const populationCeilingByCell = new Map<number, number>();
    for (const cellId of pack.cells.i) {
      if (pack.cells.h[cellId] < 20) continue;
      populationCeilingByCell.set(cellId, pack.cells.pop[cellId] * CARRYING_CAPACITY_MULTIPLIER);
    }
    const populationCeilingByBurg = new Map<number, number>();
    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;
      populationCeilingByBurg.set(burg.i, (burg.population ?? 0) * CARRYING_CAPACITY_MULTIPLIER);
    }

    const eras: Era[] = [this.snapshot(options.year, [])];

    for (let n = 1; n < eraCount; n++) {
      options.year += yearsPerEra;
      // applySuccession() mutates pack.states/pack.burgs in place (locks, name drift, small-burg
      // removal) before States.regenerate() is even called - saved here so that if regenerate()
      // then aborts (see below) those mutations can be undone along with options.year, leaving no
      // trace of an era that never actually happened
      const statesBeforeSuccession = structuredClone(pack.states);
      const burgsBeforeSuccession = structuredClone(pack.burgs);
      this.applySuccession();

      // States.recreate() refuses to run (and leaves pack.states/pack.cells.state completely
      // untouched) when every valid state happens to lock at once - with few states and high
      // survival odds this is a real, reachable outcome, not just a theoretical one. Nothing
      // about this era's political map actually changed, so there's nothing meaningful to
      // snapshot: stop here rather than pushing a stale duplicate era and re-running
      // Wars/Rebellions/Characters against territory that was never regenerated for this year.
      const { error } = window.States.regenerate() ?? {};
      if (error) {
        options.year -= yearsPerEra;
        pack.states = statesBeforeSuccession;
        pack.burgs = burgsBeforeSuccession;
        break;
      }

      Wars.resolveCampaigns();
      Rebellions.resolve();
      Characters.applySuccession(yearsPerEra);
      this.assimilateCultures();
      const epidemicEvents = this.growPopulation(yearsPerEra, populationCeilingByCell, populationCeilingByBurg);
      window.States.collectStatistics(); // refresh area/burgs/rural/urban after population changed
      this.updateTreasuries();
      eras.push(this.snapshot(options.year, epidemicEvents));
    }

    pack.eras = eras;
    return eras;
  }

  private snapshot(year: number, epidemicEvents: string[]): Era {
    return {
      year,
      states: structuredClone(pack.states),
      cellsState: Array.from(pack.cells.state),
      provinces: structuredClone(pack.provinces ?? []),
      cellsProvince: Array.from(pack.cells.province ?? []),
      burgs: structuredClone(pack.burgs),
      characters: structuredClone(pack.characters ?? []),
      epidemicEvents,
      cellsPop: Array.from(pack.cells.pop)
    };
  }

  // Decide, in place, which states survive (lock) into the next era and which
  // small settlements are abandoned. States.regenerate() reads state.lock to
  // preserve locked states untouched and recreate the rest from scratch.
  private applySuccession() {
    const { states, burgs } = pack;
    const validStates = states.filter(s => s.i && !s.removed);
    if (!validStates.length) return;

    const totalArea = sum(validStates.map(s => s.area ?? 0)) || 1;
    const averageTroopsPerArea = mean(validStates.map(getTroopsPerArea)) || 0;
    for (const state of validStates) {
      // a state the user locked by hand stays locked - skip the reroll entirely rather than "only
      // overwrite if not already true", which would wrongly turn any state that merely won one
      // era's coin flip into permanent immunity for every era after
      if (!state.userLocked) {
        const militaryRatio = getMilitaryRatio(getTroopsPerArea(state), averageTroopsPerArea);
        state.lock = P(survivalChance(state.area ?? 0, totalArea, validStates.length, militaryRatio));
      }

      // States.defineStateForms() skips locked states, so a surviving name
      // only drifts here; fullName is recomputed from the mutated name and
      // the untouched form (Kingdom, Duchy...) it already carried.
      if (state.lock && P(0.35)) {
        state.name = mutateName(state.name);
        state.fullName = window.States.getFullName(state);
      }
    }

    // small, non-capital settlements have a chance to be abandoned each era;
    // capitals are never pruned, but their name can still drift like any
    // other surviving burg (this is exactly the Barcino -> Barcelona case).
    for (const burg of burgs) {
      if (!burg.i || burg.removed) continue;

      if (!burg.capital && (burg.population ?? 0) < 3 && P(0.15)) {
        burg.removed = true;
        // cells.burg is the source of truth other systems (province generation's "do not
        // overwrite burgs" check, load.ts's own data-integrity pass) read as "is there a burg
        // here" - burgs-generator.ts/burg-editor.ts's own removal paths clear it the same way,
        // leaving it pointing at a removed burg would silently misinform every one of them
        pack.cells.burg[burg.cell] = 0;
        continue;
      }

      if (P(0.2)) burg.name = mutateName(burg.name ?? "");
    }
  }

  // States.collectTaxes() also folds in sales-tax revenue from pack.deals, which isn't era-aware
  // (deals stay tied to the live map's current burgs/markets, not any particular era's political
  // layout) - so this mirrors only its poll-tax half: pollTax × (rural + urban), reset and
  // recomputed fresh each era exactly like the live version does, not accumulated across eras.
  private updateTreasuries(): void {
    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const population = (state.rural ?? 0) + (state.urban ?? 0);
      state.treasury = rn(state.pollTax * population, 2);
    }
  }

  // A province held by a different-culture crown long enough, and left alone long enough
  // (annexedYear, the same field Rebellions' own unrest decay reads), has a modest chance each era
  // to assimilate into the ruling state's culture - never guaranteed, so plenty of conquered
  // provinces stay distinct indefinitely, matching the historically common outcome. Matched against
  // the seat burg's own culture, the same proxy rebellions-generator.ts uses for "this province's
  // culture" - provinces don't carry a culture field of their own, only their cells do.
  private assimilateCultures(): void {
    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed || province.annexedYear === undefined) continue;

      const state = pack.states[province.state];
      if (!state?.i || state.removed) continue;

      const seatBurg = pack.burgs[province.burg];
      if (!seatBurg?.i || seatBurg.removed || seatBurg.culture === state.culture) continue;

      const yearsUnderForeignRule = options.year - province.annexedYear;
      if (yearsUnderForeignRule < ASSIMILATION_MIN_YEARS) continue;

      const centuriesPastMinimum = (yearsUnderForeignRule - ASSIMILATION_MIN_YEARS) / 100;
      const chance = minmax(
        ASSIMILATION_BASE_CHANCE + centuriesPastMinimum * ASSIMILATION_CHANCE_PER_CENTURY_PAST_MINIMUM,
        0,
        ASSIMILATION_MAX_CHANCE
      );
      if (!P(chance)) continue;

      const originalCulture = seatBurg.culture;
      seatBurg.culture = state.culture;
      for (const cellId of pack.cells.i) {
        if (pack.cells.province?.[cellId] === province.i && pack.cells.culture[cellId] === originalCulture) {
          pack.cells.culture[cellId] = state.culture;
        }
      }
    }
  }

  // Population grows (or, for a freshly-conquered/plague-stricken realm, shrinks) once per era,
  // capped by the ceilings generate() captured before the run started - rural (cells.pop) and
  // urban (burg.population) are tracked as the separate figures States.collectStatistics() itself
  // sums them from, so both need their own growth pass, at their own (different) growth rate.
  // Returns any epidemic/famine event lines for eras-editor.ts's event log to show as-is.
  private growPopulation(
    yearsPerEra: number,
    populationCeilingByCell: Map<number, number>,
    populationCeilingByBurg: Map<number, number>
  ): string[] {
    const ruralGrowthFactorByState = new Map<number, number>();
    const urbanGrowthFactorByState = new Map<number, number>();
    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const ruralRatePerYear =
        gauss(RURAL_GROWTH_MEAN_PCT, RURAL_GROWTH_SD_PCT, RURAL_GROWTH_MIN_PCT, RURAL_GROWTH_MAX_PCT, 3) / 100;
      const urbanRatePerYear =
        gauss(URBAN_GROWTH_MEAN_PCT, URBAN_GROWTH_SD_PCT, URBAN_GROWTH_MIN_PCT, URBAN_GROWTH_MAX_PCT, 3) / 100;
      ruralGrowthFactorByState.set(state.i, (1 + ruralRatePerYear) ** yearsPerEra);
      urbanGrowthFactorByState.set(state.i, (1 + urbanRatePerYear) ** yearsPerEra);
    }

    const devastatedProvinceIds = new Set(
      (pack.provinces ?? []).filter(p => p.i && !p.removed && p.annexedYear === options.year).map(p => p.i)
    );
    // one shared roll per devastated province, not per cell/burg - the whole province suffers the
    // same war, not an independently unlucky dice roll on every cell within it
    const warRetentionByProvince = new Map<number, number>();
    const getWarRetention = (provinceId: number): number => {
      let retention = warRetentionByProvince.get(provinceId);
      if (retention === undefined) {
        retention = gauss(
          WAR_POPULATION_RETENTION_MEAN,
          WAR_POPULATION_RETENTION_SD,
          WAR_POPULATION_RETENTION_MIN,
          WAR_POPULATION_RETENTION_MAX,
          3
        );
        warRetentionByProvince.set(provinceId, retention);
      }
      return retention;
    };

    const { retentionByState: pandemicRetentionByState, eventText: pandemicEventText } =
      this.rollGreatPandemic(yearsPerEra);

    const totalPopByState = new Map<number, number>();
    const totalCeilingByState = new Map<number, number>();
    const accumulate = (stateId: number, pop: number, ceiling: number) => {
      totalPopByState.set(stateId, (totalPopByState.get(stateId) ?? 0) + pop);
      totalCeilingByState.set(stateId, (totalCeilingByState.get(stateId) ?? 0) + ceiling);
    };

    for (const cellId of pack.cells.i) {
      if (pack.cells.h[cellId] < 20) continue; // no population in water

      const stateId = pack.cells.state[cellId];
      const growthFactor = ruralGrowthFactorByState.get(stateId);
      if (!growthFactor) continue; // unowned/neutral land - no growth tracked

      const provinceId = pack.cells.province?.[cellId];
      const isDevastated = Boolean(provinceId && devastatedProvinceIds.has(provinceId));
      const pandemicFactor = pandemicRetentionByState.get(stateId) ?? 1;
      // a war-torn province doesn't also grow this era - its own retention factor replaces growth
      // entirely, then a pandemic (independent of any war) multiplies on top of whichever applies
      const factor = (isDevastated ? getWarRetention(provinceId as number) : growthFactor) * pandemicFactor;

      const ceiling = populationCeilingByCell.get(cellId) ?? Infinity;
      pack.cells.pop[cellId] = Math.min(pack.cells.pop[cellId] * factor, ceiling);
      accumulate(stateId, pack.cells.pop[cellId], ceiling);
    }

    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;

      const stateId = burg.state ?? 0;
      const growthFactor = urbanGrowthFactorByState.get(stateId);
      if (!growthFactor) continue;

      const provinceId = pack.cells.province?.[burg.cell];
      const isDevastated = Boolean(provinceId && devastatedProvinceIds.has(provinceId));
      const pandemicFactor = pandemicRetentionByState.get(stateId) ?? 1;
      const factor = (isDevastated ? getWarRetention(provinceId as number) : growthFactor) * pandemicFactor;

      const ceiling = populationCeilingByBurg.get(burg.i) ?? Infinity;
      burg.population = rn(Math.min((burg.population ?? 0) * factor, ceiling), 3);
      accumulate(stateId, burg.population, ceiling);
    }

    const epidemicEvents: string[] = [];
    if (pandemicEventText) epidemicEvents.push(pandemicEventText);
    this.applySubsistenceCrises(totalPopByState, totalCeilingByState, epidemicEvents);

    // burg.group (hamlet/town/city/capital...) drives which icon size a settlement draws with -
    // without this, a burg that grows or shrinks across many eras keeps whatever icon it started
    // with, instead of the map's own settlement tiers actually tracking its history. Recomputed
    // fresh each era from THIS era's populations, exactly like Burgs.specify()/changeGroup() do at
    // generation time and the burg-group editor does by hand (defineGroup() itself skips a locked
    // burg that already has a valid group, so a manually-assigned tier still isn't overridden here).
    const validBurgs = pack.burgs.filter(b => b.i && !b.removed);
    const populations = validBurgs.map(b => b.population ?? 0).sort((a, b) => a - b);
    for (const burg of validBurgs) window.Burgs.defineGroup(burg, populations);

    return epidemicEvents;
  }

  // The rare, civilization-scale pandemic: usually starts at a port (maritime trade, same as the
  // historical Black Death), then spreads through state.neighbors, losing severity with each hop
  // rather than blanketing the whole map at once. Returns a retention factor per infected state
  // (states not returned are unaffected) and a one-line summary for the event log, if it fired.
  private rollGreatPandemic(yearsPerEra: number): { retentionByState: Map<number, number>; eventText?: string } {
    const perEraChance = 1 - (1 - PANDEMIC_CHANCE_PER_YEAR) ** yearsPerEra;
    const retentionByState = new Map<number, number>();
    if (!P(perEraChance)) return { retentionByState };

    const validStates = pack.states.filter(s => s.i && !s.removed);
    if (!validStates.length) return { retentionByState };

    // prefer a port state as the outbreak's origin - falls back to any state if none has a port,
    // since a land-borne outbreak (the Plague of Justinian's likely route) is rarer but not impossible
    const portStateIds = new Set(
      pack.burgs.filter(b => b.i && !b.removed && b.port && b.state).map(b => b.state as number)
    );
    const candidateStates = validStates.filter(s => portStateIds.has(s.i));
    const epicenter = ra(candidateStates.length ? candidateStates : validStates);

    const infectedIds = new Set<number>([epicenter.i]);
    const infectedNames: string[] = [];
    let frontier = [epicenter];

    for (let hop = 0; frontier.length && hop <= PANDEMIC_MAX_HOPS; hop++) {
      const nextFrontier: State[] = [];
      for (const state of frontier) {
        const rawRetention = gauss(
          PANDEMIC_RETENTION_MEAN,
          PANDEMIC_RETENTION_SD,
          PANDEMIC_RETENTION_MIN,
          PANDEMIC_RETENTION_MAX,
          3
        );
        // further from the epicenter, less of the outbreak's severity survives - blended toward
        // "no loss" (1) rather than scaling the loss fraction directly, so it tapers off smoothly
        const severity = PANDEMIC_SPREAD_SEVERITY_FALLOFF ** hop;
        const retention = minmax(1 - (1 - rawRetention) * severity, 0, 1);
        retentionByState.set(state.i, retention);
        infectedNames.push(state.fullName ?? state.name);

        for (const neighborId of state.neighbors ?? []) {
          if (infectedIds.has(neighborId)) continue;
          const neighbor = pack.states[neighborId];
          if (!neighbor?.i || neighbor.removed) continue;
          if (!P(PANDEMIC_SPREAD_CHANCE)) continue;
          infectedIds.add(neighborId);
          nextFrontier.push(neighbor);
        }
      }
      frontier = nextFrontier;
    }

    const epicenterName = epicenter.fullName ?? epicenter.name;
    const eventText =
      infectedNames.length > 1
        ? `🦠 A great pandemic breaks out in ${epicenterName} and spreads to ${infectedNames.length - 1} neighboring realm(s)`
        : `🦠 A great pandemic breaks out in ${epicenterName}`;

    return { retentionByState, eventText };
  }

  // A state pressing up against its own carrying-capacity ceiling (populationCeilingByCell/Burg's
  // per-state totals) risks a subsistence crisis: famine and the disease that rides with it. Only
  // ever hits realms that actually grew too big for their land to support this era - a Malthusian
  // correction, not an arbitrary dice roll independent of the world's own state.
  private applySubsistenceCrises(
    totalPopByState: Map<number, number>,
    totalCeilingByState: Map<number, number>,
    epidemicEvents: string[]
  ): void {
    const retentionByCrisisState = new Map<number, number>();
    for (const [stateId, totalPop] of totalPopByState) {
      const ceiling = totalCeilingByState.get(stateId);
      if (!ceiling || totalPop / ceiling < OVERCROWDING_THRESHOLD) continue;
      if (!P(OVERCROWDING_CRISIS_CHANCE)) continue;

      const retention = gauss(
        SUBSISTENCE_CRISIS_RETENTION_MEAN,
        SUBSISTENCE_CRISIS_RETENTION_SD,
        SUBSISTENCE_CRISIS_RETENTION_MIN,
        SUBSISTENCE_CRISIS_RETENTION_MAX,
        3
      );
      retentionByCrisisState.set(stateId, retention);

      const state = pack.states[stateId];
      epidemicEvents.push(
        `🦠 Overcrowding triggers a subsistence crisis in ${state?.fullName ?? state?.name ?? stateId}`
      );
    }
    if (!retentionByCrisisState.size) return;

    for (const cellId of pack.cells.i) {
      if (pack.cells.h[cellId] < 20) continue;
      const retention = retentionByCrisisState.get(pack.cells.state[cellId]);
      if (retention === undefined) continue;
      pack.cells.pop[cellId] *= retention;
    }
    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;
      const retention = retentionByCrisisState.get(burg.state ?? 0);
      if (retention === undefined) continue;
      burg.population = rn((burg.population ?? 0) * retention, 3);
    }
  }
}

window.Eras = new ErasModule();
