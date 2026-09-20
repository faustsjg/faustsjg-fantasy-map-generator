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
import { gauss, minmax, P, rn } from "../utils";

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
// swings (plague, famine, prosperity) and outright decline in bad stretches - rolled once per
// state per era, then compounded over however many years that era spans.
const POP_GROWTH_MEAN_PCT = 0.3;
const POP_GROWTH_SD_PCT = 0.15;
const POP_GROWTH_MIN_PCT = -0.2;
const POP_GROWTH_MAX_PCT = 0.8;
// a province annexed THIS era pays for it in people, not just political unrest - war, pillage and
// displacement, overriding the state's own growth roll for just that province, just this once
const WAR_POPULATION_RETENTION_MEAN = 0.8;
const WAR_POPULATION_RETENTION_SD = 0.08;
const WAR_POPULATION_RETENTION_MIN = 0.6;
const WAR_POPULATION_RETENTION_MAX = 0.95;
// population can't compound forever - each cell/burg is capped at a multiple of whatever
// population it had when this generate() run started (captured once, see generate() below),
// standing in for a Malthusian agricultural/urban ceiling
const CARRYING_CAPACITY_MULTIPLIER = 3;

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

    const eras: Era[] = [this.snapshot(options.year)];

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
      this.growPopulation(yearsPerEra, populationCeilingByCell, populationCeilingByBurg);
      window.States.collectStatistics(); // refresh area/burgs/rural/urban after population changed
      this.updateTreasuries();
      eras.push(this.snapshot(options.year));
    }

    pack.eras = eras;
    return eras;
  }

  private snapshot(year: number): Era {
    return {
      year,
      states: structuredClone(pack.states),
      cellsState: Array.from(pack.cells.state),
      provinces: structuredClone(pack.provinces ?? []),
      cellsProvince: Array.from(pack.cells.province ?? []),
      burgs: structuredClone(pack.burgs),
      characters: structuredClone(pack.characters ?? [])
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
      const militaryRatio = getMilitaryRatio(getTroopsPerArea(state), averageTroopsPerArea);
      state.lock = P(survivalChance(state.area ?? 0, totalArea, validStates.length, militaryRatio));

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

  // Population grows (or, for a freshly-conquered province, shrinks) once per era, capped by the
  // ceilings generate() captured before the run started - rural (cells.pop) and urban
  // (burg.population) are tracked as the separate figures States.collectStatistics() itself sums
  // them from, so both need their own growth pass.
  private growPopulation(
    yearsPerEra: number,
    populationCeilingByCell: Map<number, number>,
    populationCeilingByBurg: Map<number, number>
  ): void {
    const growthFactorByState = new Map<number, number>();
    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const ratePerYear =
        gauss(POP_GROWTH_MEAN_PCT, POP_GROWTH_SD_PCT, POP_GROWTH_MIN_PCT, POP_GROWTH_MAX_PCT, 3) / 100;
      growthFactorByState.set(state.i, (1 + ratePerYear) ** yearsPerEra);
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

    for (const cellId of pack.cells.i) {
      if (pack.cells.h[cellId] < 20) continue; // no population in water

      const growthFactor = growthFactorByState.get(pack.cells.state[cellId]);
      if (!growthFactor) continue; // unowned/neutral land - no growth tracked

      const provinceId = pack.cells.province?.[cellId];
      const factor =
        provinceId && devastatedProvinceIds.has(provinceId) ? getWarRetention(provinceId) : growthFactor;

      const ceiling = populationCeilingByCell.get(cellId) ?? Infinity;
      pack.cells.pop[cellId] = Math.min(pack.cells.pop[cellId] * factor, ceiling);
    }

    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;

      const growthFactor = growthFactorByState.get(burg.state ?? 0);
      if (!growthFactor) continue;

      const provinceId = pack.cells.province?.[burg.cell];
      const factor =
        provinceId && devastatedProvinceIds.has(provinceId) ? getWarRetention(provinceId) : growthFactor;

      const ceiling = populationCeilingByBurg.get(burg.i) ?? Infinity;
      burg.population = rn(Math.min((burg.population ?? 0) * factor, ceiling), 3);
    }
  }
}

window.Eras = new ErasModule();
