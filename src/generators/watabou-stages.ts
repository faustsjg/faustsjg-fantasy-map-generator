// Watabou's city, village and dwelling generators build their whole layout from the parameters in
// the preview link: the same seed with a slightly different population (and so size) gives an
// entirely different town, not the same town a little bigger. A burg's population changes every
// era, so the preview would be redrawn from scratch on every step of the time bar.
//
// The population sent to them is therefore rounded to a stage: a power of two, in log space, so
// the preview stays exactly the same until the population has roughly doubled (or halved) and
// then changes once. Real growth still shows; ordinary drift between eras doesn't.
export function populationStage(population: number): number {
  if (!(population > 0)) return population;
  return 2 ** Math.round(Math.log2(population));
}
