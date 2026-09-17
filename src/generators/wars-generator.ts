// States.regenerate()'s own diplomacy step (generateDiplomacy(), in states-generator.ts) already
// decides who attacks whom and why: it compares power (area * expansionism), forms coalitions of
// allies/vassals on both sides, and - if the attacker is decisively stronger - declares the war,
// flips both sides to "Enemy", and records it as a Campaign with no `end` (an ongoing lore
// campaign, generated separately by generateCampaigns(), always carries an `end`). None of that
// touches territory, though - it's flavor. This module gives a freshly-declared war a mechanical
// consequence: the stronger side annexes some of the weaker side's bordering provinces, reusing
// the exact same power comparison and threshold Azgaar already used to decide the war was
// winnable in the first place.
import type { Province } from "@/generators/provinces-generator";
import type { State } from "@/generators/states-generator";
import { gauss, withAnnotation } from "@/utils";

// at most a third of the loser's bordering provinces change hands per era - conquering a state
// takes several eras of sustained war, not one lucky roll
const ANNEXATION_SHARE = 1 / 3;

class WarsModule {
  // called once per era, right after States.regenerate() (so this era's freshly-declared wars are
  // already in state.campaigns), before Characters.applySuccession() hands out the era's rulers
  resolveCampaigns(): void {
    const provinceAdjacency = this.buildProvinceAdjacency();
    let anyChange = false;

    for (const attacker of pack.states) {
      if (!attacker.i || attacker.removed) continue;

      for (const campaign of attacker.campaigns ?? []) {
        // only a just-declared, still-live war (no `end`) and only from the attacker's own array -
        // the same Campaign object is also pushed onto the defender's array, so this skips the duplicate
        if (campaign.end !== undefined || campaign.attacker !== attacker.i) continue;

        const defender = pack.states[campaign.defender];
        if (!defender?.i || defender.removed) continue;

        if (this.annex(attacker, defender, provinceAdjacency)) anyChange = true;
      }
    }

    if (anyChange) window.States.collectStatistics(); // refresh area/burgs/rural/urban after territory moved
  }

  private annex(attacker: State, defender: State, provinceAdjacency: Map<number, Set<number>>): boolean {
    const attackerPower = (attacker.area ?? 0) * attacker.expansionism;
    const defenderPower = (defender.area ?? 0) * defender.expansionism;
    // same margin generateDiplomacy() requires before it even declares the war - a war Azgaar
    // thought was winnable stays winnable here, no separate threshold to keep in sync
    if (attackerPower < defenderPower * gauss(1.6, 0.8, 0, 10, 2)) return false;

    const defenderProvinces = (pack.provinces ?? []).filter(p => p.i && !p.removed && p.state === defender.i);
    if (!defenderProvinces.length) return false;

    const border = defenderProvinces.filter(p =>
      [...(provinceAdjacency.get(p.i) ?? [])].some(neighborId => pack.provinces?.[neighborId]?.state === attacker.i)
    );
    if (!border.length) return false; // no shared border - a naval or coalition war, nothing to take on land

    const takeCount = Math.max(1, Math.ceil(border.length * ANNEXATION_SHARE));
    for (const province of border.slice(0, takeCount)) this.transferProvince(province, attacker);

    // losing the capital, or every last province, ends the state - the rest is absorbed too. A
    // direct sweep by state id (not just by province membership) matters here: a state can hold
    // cells that belong to no province at all (unclaimed wilderness), and those would otherwise be
    // left pointing at a now-removed state once it's gone
    const stillHasCapital = pack.burgs[defender.capital]?.state === defender.i;
    const stillHasProvince = (pack.provinces ?? []).some(p => p.i && !p.removed && p.state === defender.i);
    if (!stillHasCapital || !stillHasProvince) {
      // burgs are matched against cells.state (the source of truth), before cells.state itself
      // gets reassigned below - matching against burg.state instead would silently skip (and
      // permanently propagate) any burg that had already drifted out of sync
      for (const burg of pack.burgs) {
        if (pack.cells.state[burg.cell] === defender.i) burg.state = attacker.i;
      }
      for (const cellId of pack.cells.i) {
        if (pack.cells.state[cellId] === defender.i) pack.cells.state[cellId] = attacker.i;
      }
      for (const province of pack.provinces ?? []) {
        if (province.i && !province.removed && province.state === defender.i) {
          province.state = attacker.i;
          province.annexedYear = options.year;
        }
      }
      defender.removed = true;
      attacker.fullName = withAnnotation(attacker.fullName ?? attacker.name, `absorbed ${defender.name}`);
    }

    return true;
  }

  private transferProvince(province: Province, to: State): void {
    province.state = to.i;
    province.annexedYear = options.year; // freshly conquered - a rebellion risk factor, decaying over time
    for (const cellId of pack.cells.i) {
      if (pack.cells.province?.[cellId] === province.i) pack.cells.state[cellId] = to.i;
    }
    // cells.province is the source of truth for which province (and so which state) a burg
    // belongs to - reassigning only burgs whose .state already matched the old owner would
    // silently skip (and permanently propagate) any burg that had already drifted out of sync
    for (const burg of pack.burgs) {
      if (pack.cells.province?.[burg.cell] === province.i) burg.state = to.i;
    }
  }

  // one pass over every cell, recording which provinces actually share a border - same approach
  // characters-generator.ts uses for county marriages, needed here to restrict annexation to
  // provinces that actually touch the attacker's own territory
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
}

export const Wars = new WarsModule();
