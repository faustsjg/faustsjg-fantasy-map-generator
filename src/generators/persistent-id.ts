// A tiny, side-effect-free home for getNextPersistentId() - kept separate from
// states-generator.ts/provinces-generator.ts so that importing it (from characters-generator.ts,
// rebellions-generator.ts, wars-generator.ts) never drags in those modules' own window.X = ...
// side effects, which would otherwise clobber test stubs and other modules' globals.
//
// state.i and province.i get renumbered every era, even for locked (surviving) entities - a
// state's .i can change from one era to the next with nothing else about it different, so
// anything that needs to recognize "the same state/province as last era" (characters-generator.ts's
// succession matching) can't use .i for that. persistentId is assigned once, here, and never
// reassigned or reused - it's the actual stable identity.
export function getNextPersistentId(): number {
  pack.nextPersistentId = (pack.nextPersistentId ?? 0) + 1;
  return pack.nextPersistentId;
}
