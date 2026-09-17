import { mean, sum } from "d3";
import type { Character } from "@/generators/characters-generator";
import { Characters } from "@/generators/characters-generator";
import { getMilitaryRatio, getTroopsPerArea } from "@/generators/military-generator";
import { Rebellions } from "@/generators/rebellions-generator";
import type { State } from "@/generators/states-generator";
import { mutateName } from "@/generators/toponym-drift";
import { Wars } from "@/generators/wars-generator";
import { minmax, P, rn } from "../utils";

declare global {
  var Eras: ErasModule;
}

export interface Era {
  year: number;
  states: State[];
  cellsState: number[];
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

class ErasModule {
  // Generate `eraCount` snapshots of the political layer, `yearsPerEra` years apart.
  // Geography (pack.cells.h/biome/rivers/...) is untouched — only pack.states and
  // pack.cells.state are regenerated each era, inheriting from the previous one.
  generate(eraCount: number, yearsPerEra: number): Era[] {
    if (eraCount < 1) return [];

    const eras: Era[] = [this.snapshot(options.year)];

    for (let n = 1; n < eraCount; n++) {
      options.year += yearsPerEra;
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
        break;
      }

      Wars.resolveCampaigns();
      Rebellions.resolve();
      Characters.applySuccession(yearsPerEra);
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
}

window.Eras = new ErasModule();
