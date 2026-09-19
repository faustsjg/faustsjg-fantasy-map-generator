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

// pack.nextPersistentId itself isn't part of the .map save format (only each entity's own
// persistentId is - see save.ts/load.ts) and Pack.generate() resets pack to a fresh object on
// load, so after loading a save this counter would otherwise start back at 0 and immediately
// hand out ids that collide with ones the loaded map (including every historical Era snapshot)
// already has in use. Call this once right after states/provinces/eras are loaded to recompute it
// from whatever's the highest persistentId actually present anywhere in the loaded data.
export function recomputeNextPersistentId(): void {
  let max = 0;
  const scan = (entities: { persistentId?: number }[] | undefined) => {
    for (const entity of entities ?? []) {
      if (entity?.persistentId !== undefined && entity.persistentId > max) max = entity.persistentId;
    }
  };

  scan(pack.states);
  scan(pack.provinces);
  for (const era of pack.eras ?? []) {
    scan(era.states);
    scan(era.provinces);
  }

  pack.nextPersistentId = max;
}
