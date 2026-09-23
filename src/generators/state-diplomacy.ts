// Shared by rebellions-generator.ts's secede() and characters-generator.ts's trySplitRealm() - both
// give a brand new mid-era state its own relations array (states-generator.ts's generateDiplomacy()
// only runs once, at the start of the era, before either of these states exist), differing only in
// how the new state feels about the one it came from (hostile for a rebellion, friendly for a
// peaceful split).
//
// Deliberately its own file rather than living in states-generator.ts: that module sets
// `window.States = new StatesModule()` at the top level, a real side effect that fires on import.
// A plain `import type { State }` (as both callers already had) is erased entirely at build time,
// so states-generator.ts never actually loaded - but a real value import of anything from it forces
// that side effect to run, which clobbers the `window.States` mock eras-generator.test.ts installs
// before importing rebellions-generator.ts. These two functions have nothing to do with StatesModule
// itself, so they don't need to drag that module in at all.
export function buildNewStateDiplomacy(originStateId: number, relationToOrigin: string): string[] {
  const diplomacy = pack.states.map(s =>
    !s.i || s.removed ? "x" : s.i === originStateId ? relationToOrigin : "Neutral"
  );
  diplomacy.push("x");
  return diplomacy;
}

// The other half of the same pairing: every other existing state also needs the new state added to
// its own relations array, in the same "x"-for-removed / relationToOrigin-for-the-origin-state /
// Neutral-for-everyone-else shape.
export function extendDiplomacyForNewState(newStateId: number, originStateId: number, relationToOrigin: string): void {
  for (const s of pack.states) {
    if (!s.i || s.removed || s.i === newStateId || !s.diplomacy) continue;
    s.diplomacy[newStateId] = s.i === originStateId ? relationToOrigin : "Neutral";
  }
}
