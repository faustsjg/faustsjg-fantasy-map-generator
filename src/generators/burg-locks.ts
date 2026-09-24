import type { Province } from "@/generators/provinces-generator";

// A locked burg stays with its current state as an enclave when the province around it changes
// hands (war, rebellion, a realm split, a manual independence declaration). Every one of those
// moves territory keyed on cells.province, so detaching the burg's cell from the province before
// the move is enough to keep it out of every loop that follows - the cell and the burg keep their
// current state, and the cell no longer counts as part of a province now owned by someone else.
// Own file for the same reason as state-diplomacy.ts: no module-level side effects.
export function detachLockedBurgs(provinceId: number): void {
  for (const burg of pack.burgs) {
    if (!burg.i || burg.removed || !burg.lock) continue;
    if (pack.cells.province?.[burg.cell] === provinceId) pack.cells.province[burg.cell] = 0;
  }
}

// A province can't leave without its own seat burg - if that one is locked, the whole province
// behaves as if it were locked itself.
export function isSeatLocked(province: Province): boolean {
  return !!pack.burgs[province.burg]?.lock;
}

// Whether any locked burg still sits on this state's territory (cells.state is the source of truth).
export function hasLockedBurg(stateId: number): boolean {
  return pack.burgs.some(b => b.i && !b.removed && b.lock && pack.cells.state[b.cell] === stateId);
}
