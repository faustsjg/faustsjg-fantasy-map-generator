// A province doesn't stay loyal just because a border was redrawn - Wars.transferProvince() and
// characters-generator.ts's resolveMarriageMerge() move territory, but nothing until now gave
// that territory a reason to want out again. Every era, every province gets a chance to rebel and
// break away as its own independent state, driven entirely by structural unrest signals that are
// already sitting in the data - nothing new to compute except how recently it changed hands:
//  - a different culture from the crown's
//  - real distance from the capital, scaled to the realm's own size (a "far" province in a small
//    kingdom and a "far" province in an empire aren't the same kind of far)
//  - sitting on a different landmass than the capital (an island or overseas holding is far harder
//    to hold than raw distance alone suggests - the classic colonial-independence pattern)
//  - how recently it was annexed by force (war conquest or a marriage merger) - freshly conquered
//    land is unstable, but that wound heals over a few generations
//  - how isolated it is within its own realm: a province boxed in mostly by fellow provinces of
//    the same state feels the pressure of belonging (La Rioja, deep in Spain's interior); one
//    surrounded mostly by foreign territory doesn't (Catalonia or Galicia, each bordering far
//    fewer provinces of their own state) - independent of whether those neighbors share its culture
// A well-garrisoned state dampens all of the above at once, Civilization-style: a strong army
// keeps a realm together even where it has every structural reason to fray, while a thin one
// makes those same reasons bite harder.
import { mean } from "d3";
import { detachLockedBurgs, isSeatLocked } from "@/generators/burg-locks";
import { Emblems } from "@/generators/emblems-generator";
import { getMilitaryRatio, getTroopsPerArea } from "@/generators/military-generator";
import { getNextPersistentId } from "@/generators/persistent-id";
import type { Province } from "@/generators/provinces-generator";
import { buildNewStateDiplomacy, extendDiplomacyForNewState } from "@/generators/state-diplomacy";
import type { State } from "@/generators/states-generator";
import { getRandomColor, minmax, P } from "@/utils";

// weights calibrated toward medieval-Europe realism: a "perfect" province (same culture, close to
// the capital, mainland, never conquered, average garrison and embeddedness) should almost never
// spontaneously revolt on its own - real instability came overwhelmingly from a recent conquest,
// not ambient regional identity. Isolation is a minor tie-breaker factor, not a primary driver.
const BASE_UNREST = 0.01;
const CULTURE_MISMATCH_BONUS = 0.1;
const MAX_DISTANCE_BONUS = 0.1;
const ISLAND_BONUS = 0.2;
const MAX_RECENT_ANNEXATION_BONUS = 0.25;
const RECENT_ANNEXATION_DECAY_YEARS = 150; // ~5 eras at the default 30 years/era - a few generations
const MAX_ISOLATION_BONUS = 0.04;
const MIN_UNREST = 0.01;
const MAX_UNREST = 0.65;
const MILITARY_DAMPENING_STRENGTH = 0.4;
const MIN_MILITARY_DAMPENING = 0.25; // a heavily garrisoned empire's unrest drops to at most a quarter of the raw value
const MAX_MILITARY_DAMPENING = 1.5; // an undefended realm's unrest can run up to 1.5x the raw value

class RebellionsModule {
  // called once per era, after Wars.resolveCampaigns() has settled this era's conquests and
  // before Characters.applySuccession() hands out rulers - any new rebel state is prior-less, so
  // applySuccession() creates its ruler exactly like it would for any other brand new state
  resolve(): void {
    let anyChange = false;

    const validStates = pack.states.filter(s => s.i && !s.removed);
    const averageTroopsPerArea = mean(validStates.map(getTroopsPerArea)) || 0;

    const provinceAdjacency = this.buildProvinceAdjacency();
    const allValidProvinces = (pack.provinces ?? []).filter(p => p.i && !p.removed);
    const averageSameStateNeighbors =
      mean(allValidProvinces.map(p => this.countSameStateNeighbors(p, provinceAdjacency))) || 0;

    for (const state of validStates) {
      const provinces = (pack.provinces ?? []).filter(p => p.i && !p.removed && p.state === state.i);
      if (provinces.length < 2) continue; // nothing left to secede from
      // a state the user locked is immune to secession outright - checked once here rather than
      // inside the per-province loop below, since it can't change mid-loop and this also skips the
      // capital/military lookups just below for nothing
      if (state.userLocked) continue;

      const capitalBurg = pack.burgs[state.capital];
      if (!capitalBurg?.i) continue;
      const capitalProvinceId = pack.cells.province?.[capitalBurg.cell];

      const militaryRatio = getMilitaryRatio(getTroopsPerArea(state), averageTroopsPerArea);
      const militaryDampening = minmax(
        1 - (militaryRatio - 1) * MILITARY_DAMPENING_STRENGTH,
        MIN_MILITARY_DAMPENING,
        MAX_MILITARY_DAMPENING
      );

      for (const province of provinces) {
        if (province.i === capitalProvinceId) continue; // the capital itself never rebels against its own crown
        // a locked province is individually immune to secession too, and so is one whose seat burg
        // (the would-be rebel capital) is locked
        if (province.lock || isSeatLocked(province)) continue;

        const sameStateNeighbors = this.countSameStateNeighbors(province, provinceAdjacency);
        const chance = this.getUnrestChance(
          province,
          state,
          capitalBurg,
          militaryDampening,
          sameStateNeighbors,
          averageSameStateNeighbors
        );
        if (P(chance)) {
          this.secede(province, state);
          anyChange = true;
        }
      }
    }

    if (anyChange) window.States.collectStatistics(); // refresh area/burgs/rural/urban after territory moved
  }

  private getUnrestChance(
    province: Province,
    state: State,
    capitalBurg: { x: number; y: number; cell: number },
    militaryDampening: number,
    sameStateNeighbors: number,
    averageSameStateNeighbors: number
  ): number {
    const provinceBurg = pack.burgs[province.burg];
    if (!provinceBurg?.i) return 0;

    const cultureMismatch = provinceBurg.culture !== undefined && provinceBurg.culture !== state.culture;

    const distance = Math.hypot(provinceBurg.x - capitalBurg.x, provinceBurg.y - capitalBurg.y);
    const typicalRadius = Math.sqrt(state.area || 1) || 1;
    const distanceBonus = minmax(distance / typicalRadius - 1, 0, 1) * MAX_DISTANCE_BONUS;

    const onDifferentLandmass = pack.cells.f?.[provinceBurg.cell] !== pack.cells.f?.[capitalBurg.cell];

    const yearsSinceAnnexation = province.annexedYear === undefined ? Infinity : options.year - province.annexedYear;
    const recentAnnexationBonus =
      minmax(1 - yearsSinceAnnexation / RECENT_ANNEXATION_DECAY_YEARS, 0, 1) * MAX_RECENT_ANNEXATION_BONUS;

    // fewer same-state neighbors than the era's average - less peer pressure to stay put
    const isolationRatio = averageSameStateNeighbors > 0 ? sameStateNeighbors / averageSameStateNeighbors : 1;
    const isolationBonus = minmax(1 - isolationRatio, 0, 1) * MAX_ISOLATION_BONUS;

    const rawChance =
      BASE_UNREST +
      (cultureMismatch ? CULTURE_MISMATCH_BONUS : 0) +
      distanceBonus +
      (onDifferentLandmass ? ISLAND_BONUS : 0) +
      recentAnnexationBonus +
      isolationBonus;

    return minmax(rawChance * militaryDampening, MIN_UNREST, MAX_UNREST);
  }

  private countSameStateNeighbors(province: Province, adjacency: Map<number, Set<number>>): number {
    const neighborIds = adjacency.get(province.i);
    if (!neighborIds) return 0;

    let count = 0;
    for (const neighborId of neighborIds) {
      if (pack.provinces?.[neighborId]?.state === province.state) count++;
    }
    return count;
  }

  // one pass over every cell, recording which provinces actually share a border - same approach
  // wars-generator.ts and characters-generator.ts use for their own province-adjacency needs
  private buildProvinceAdjacency(): Map<number, Set<number>> {
    const adjacency = new Map<number, Set<number>>();
    for (const cellId of pack.cells?.i ?? []) {
      const provinceId = pack.cells.province?.[cellId];
      if (!provinceId) continue;

      for (const neighborCellId of pack.cells.c?.[cellId] ?? []) {
        const neighborProvinceId = pack.cells.province[neighborCellId];
        if (!neighborProvinceId || neighborProvinceId === provinceId) continue;

        if (!adjacency.has(provinceId)) adjacency.set(provinceId, new Set());
        adjacency.get(provinceId)?.add(neighborProvinceId);
      }
    }
    return adjacency;
  }

  private secede(province: Province, state: State): void {
    const seatBurg = pack.burgs[province.burg];
    if (!seatBurg?.i || seatBurg.removed) return;

    const newStateId = pack.states.length;
    // a breakaway realm echoes the crown it left (kinship 0.4, the same "distinct but recognizably
    // related" weight provinces-generator.ts gives a province not named after its own seat burg) -
    // not state.coa itself, which would hand the rebels the literal same mutable emblem object as
    // the parent: editing either one's shield/position afterward would silently edit both
    const coa = Emblems.generate(state.coa, 0.4, null, state.type);
    coa.shield = state.coa?.shield;
    // freshly hostile to the crown it just broke from, neutral to everyone else - matches
    // declareProvinceIndependence()'s own reasoning for the same event (see buildNewStateDiplomacy())
    const diplomacy = buildNewStateDiplomacy(state.i, "Enemy");
    const newState: State = {
      i: newStateId,
      persistentId: getNextPersistentId(),
      name: province.name,
      expansionism: state.expansionism,
      capital: seatBurg.i,
      type: state.type,
      center: seatBurg.cell,
      culture: seatBurg.culture ?? state.culture,
      coa,
      form: state.form,
      formName: state.formName,
      color: getRandomColor(),
      salesTax: state.salesTax,
      pollTax: state.pollTax,
      treasury: 0,
      diplomacy
    };
    newState.fullName = `${newState.formName} of ${newState.name} (rebelled against ${state.name})`;
    pack.states.push(newState);
    extendDiplomacyForNewState(newStateId, state.i, "Enemy");
    // states-generator.ts's and provinces-generator.ts's own capital bookkeeping (stale-capital
    // cleanup, capital-first province-seat sorting) relies on this flag - without it, a later era's
    // regeneration doesn't know this burg is already someone's capital and can hand it to another state
    seatBurg.capital = 1;

    detachLockedBurgs(province.i); // any other locked burg inside stays with the crown as an enclave
    province.state = newStateId;
    province.annexedYear = undefined; // independent now - no foreign crown to be "recently annexed" by
    for (const cellId of pack.cells.i) {
      if (pack.cells.province?.[cellId] === province.i) pack.cells.state[cellId] = newStateId;
    }
    // cells.province is the source of truth for which province (and so which state) a burg
    // belongs to - reassigning only burgs whose .state already matched the old owner would
    // silently skip (and permanently propagate) any burg that had already drifted out of sync
    for (const burg of pack.burgs) {
      if (pack.cells.province?.[burg.cell] === province.i) burg.state = newStateId;
    }
  }
}

export const Rebellions = new RebellionsModule();
