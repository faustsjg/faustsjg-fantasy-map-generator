// Named individuals living in the world: rulers, provincial nobles, guild masters, and ordinary
// people known for something small - worldbuilding texture, not adventure hooks or quest-givers.
// Titles, dynasties and family ties are all derived procedurally from the existing state/province
// data (form, diplomacy) - nothing here is AI-generated. Only the on-demand bio (characters-overview.ts)
// calls out to the AI generator, and only when a user clicks for it.
import { minmax, P, ra, rand } from "@/utils";
import type { Burg } from "./burgs-generator";
import type { Province } from "./provinces-generator";
import type { State } from "./states-generator";

export interface Child {
  name: string;
  gender: "m" | "f";
}

export interface Character {
  i: number;
  name: string;
  burg: number;
  culture: number;
  role: string;
  importance: "notable" | "common";
  dynasty?: string; // house name, notable characters only
  spouse?: string;
  children?: Child[];
  liege?: number; // index into pack.characters of this character's overlord, if any
  state?: number; // for a ruler: the state.i they rule - lets Eras find them again next era
  province?: number; // for a provincial noble: the province.i they govern, same reason
  spouseState?: number; // for a ruler married into another crown: that state's i
  spouseProvince?: number; // for a noble married into another county: that province's i
  age?: number; // in years; drives succession together with the culture's lifespan
  bio?: string; // filled in on demand via the AI generator, not at generation time
  removed?: boolean;
}

// State.formName is a rich, long tail (Kingdom, Khanate, Shogunate, Beylik...); every form the
// states generator can produce gets a matching title here, so rank varies with real state power
// and vassal status instead of everyone defaulting to "King".
const RULER_TITLES: Record<string, string> = {
  Empire: "Emperor",
  Kingdom: "King",
  "Grand Duchy": "Grand Duke",
  Duchy: "Duke",
  Principality: "Prince",
  Republic: "President",
  Theocracy: "High Priest",
  Union: "Chancellor",
  Khanate: "Khan",
  Khaganate: "Khagan",
  Horde: "Khan",
  Ulus: "Khan",
  Tsardom: "Tsar",
  Caliphate: "Caliph",
  Shogunate: "Shogun",
  Emirate: "Emir",
  Despotate: "Despot",
  Satrapy: "Satrap",
  Beylik: "Bey",
  Federation: "Federal Chairman",
  "Trade Company": "Company Director",
  "Most Serene Republic": "Doge",
  Oligarchy: "Archon",
  Tetrarchy: "Tetrarch",
  Triumvirate: "Triumvir",
  Diarchy: "Co-Regent",
  Junta: "Junta Leader",
  League: "League Speaker",
  Confederation: "Confederate Chairman",
  "United Kingdom": "King",
  "United Republic": "President",
  "United Provinces": "Stadtholder",
  Commonwealth: "Lord Protector",
  Heptarchy: "High King",
  Brotherhood: "Grand Master",
  Thearchy: "Thearch",
  See: "Bishop",
  "Holy State": "High Priest",
  Diocese: "Bishop",
  Bishopric: "Bishop",
  Eparchy: "Eparch",
  Exarchate: "Exarch",
  Patriarchate: "Patriarch",
  Imamah: "Imam",
  "Free Territory": "Elder",
  Council: "Council Speaker",
  Commune: "Commune Elder",
  Community: "Community Elder",
  Marches: "Marquess",
  Dominion: "Governor-General",
  Protectorate: "Lord Protector",
  "Free City": "Lord Mayor",
  "City-state": "Archon"
};

// Province.formName ranks below its state's form (a County inside a Kingdom, a Barony inside a
// Duchy...), giving the mid-tier nobility the vassalage chain needs.
const PROVINCE_TITLES: Record<string, string> = {
  County: "Count",
  Earldom: "Earl",
  Shire: "Reeve",
  Landgrave: "Landgrave",
  Margrave: "Margrave",
  Barony: "Baron",
  Captaincy: "Captain",
  Seneschalty: "Seneschal",
  Province: "Governor",
  Department: "Prefect",
  Governorate: "Governor",
  District: "District Governor",
  Canton: "Canton Chief",
  Prefecture: "Prefect",
  Parish: "Vicar",
  Deanery: "Dean",
  State: "Governor",
  Council: "Councilor",
  Commune: "Commune Elder",
  Community: "Community Elder",
  Tribe: "Chieftain",
  Territory: "Territorial Governor",
  Land: "Warden",
  Region: "Warden",
  Clan: "Clan Chief",
  Dependency: "Governor",
  Area: "Warden"
};

type SuccessionLaw = "agnatic" | "male-preference" | "absolute" | "elective" | "ultimogeniture";

// The political SYSTEM (hereditary vs. elective, and how) belongs to the state's form, not a
// county's noble rank - a county inside a Republic follows the Republic's law, not "County"'s.
// Unmapped forms fall back to male-preference primogeniture, the most common historical default.
const DEFAULT_SUCCESSION_LAW: SuccessionLaw = "male-preference";
const SUCCESSION_LAW_BY_FORM: Record<string, SuccessionLaw> = {
  // Salic-law-style: strictly male-line. A daughter-only family really can go extinct here,
  // exactly as it did in real history (France, 1328).
  Empire: "agnatic",
  Kingdom: "agnatic",
  "Grand Duchy": "agnatic",
  Duchy: "agnatic",
  Principality: "agnatic",
  // steppe/Mongol-Turkic custom: the youngest child inherited the parents' own hearth and lands
  Khanate: "ultimogeniture",
  Khaganate: "ultimogeniture",
  Horde: "ultimogeniture",
  Ulus: "ultimogeniture",
  // republics, communes, and religious offices were typically chosen, not simply inherited
  Republic: "elective",
  Federation: "elective",
  "Trade Company": "elective",
  "Most Serene Republic": "elective",
  Oligarchy: "elective",
  Tetrarchy: "elective",
  Triumvirate: "elective",
  Diarchy: "elective",
  Junta: "elective",
  League: "elective",
  Confederation: "elective",
  "United Republic": "elective",
  "United Provinces": "elective",
  Commonwealth: "elective",
  Heptarchy: "elective",
  "Free Territory": "elective",
  Council: "elective",
  Commune: "elective",
  Community: "elective",
  "Free City": "elective",
  "City-state": "elective",
  Theocracy: "elective",
  Brotherhood: "elective",
  Thearchy: "elective",
  See: "elective",
  "Holy State": "elective",
  Diocese: "elective",
  Bishopric: "elective",
  Eparchy: "elective",
  Exarchate: "elective",
  Patriarchate: "elective",
  Imamah: "elective"
};

// Ordinary people worth naming without inventing a plot for them - just part of the world
export const COMMONER_ARCHETYPES = [
  "the Herbalist",
  "the Storyteller",
  "the Ferryman",
  "the Beekeeper",
  "the Midwife",
  "the Woodcarver",
  "the Bell-ringer",
  "the Gravedigger",
  "the Weaver",
  "the Innkeeper",
  "the Fisherman",
  "the Shepherd",
  "the Smith's Apprentice",
  "the Town Crier",
  "the Gardener",
  "the Cooper",
  "the Miller",
  "the Tinker",
  "the Candlemaker",
  "the Potter"
];

interface NobleSeed {
  burg: number;
  culture: number;
  role: string;
  name?: string;
}

// some counties/duchies really were named after the family that first held them (Habsburg,
// Savoy...) - not most, but not rare either; the rest keep their existing, older place name
const FOUNDER_NAMING_CHANCE = 0.3;

// Dwarves, elves and the rest don't share a human lifespan, so neither should their reigns.
// Keyed by name-base index (src/data/name-bases.ts) - only the fantasy bases differ from the
// human baseline; every real-world base (0-32, 42+) falls through to DEFAULT_LIFESPAN_YEARS.
const DEFAULT_LIFESPAN_YEARS = 75;
const LIFESPAN_YEARS_BY_BASE: Record<number, number> = {
  33: 700, // Elven
  34: 700, // Dark Elven
  35: 250, // Dwarven
  36: 40, // Goblin
  37: 55, // Orc
  38: 220, // Giant
  39: 600, // Draconic
  40: 25, // Arachnid
  41: 25 // Serpents
};

// chance a ruler marries into another crown rather than an anonymous spouse - real crowns, so a
// childless death can merge the two realms (Aragon+Catalonia, Castile+Aragon, England+Scotland...)
const MARRIAGE_ALLIANCE_CHANCE = 0.15;

class CharactersModule {
  generate(): void {
    const characters: Character[] = [];
    const rulerByState = new Map<number, number>(); // state.i -> character index

    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const capital = pack.burgs[state.capital];
      if (!capital || !capital.i || capital.removed) continue;

      const index = characters.length;
      const ruler = this.createRuler(index, state, capital);
      this.tryFormMarriageAlliance(ruler, state, rulerByState, characters);
      characters.push(ruler);
      rulerByState.set(state.i, index);
    }
    this.linkStateLieges(characters, rulerByState);

    const nobleByProvince = new Map<number, number>(); // province.i -> character index
    const provinceAdjacency = this.buildProvinceAdjacency();

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const index = characters.length;
      const noble = this.createProvinceNoble(index, province, burg);
      this.tryFormCountyMarriageAlliance(noble, province, provinceAdjacency, nobleByProvince, characters);
      characters.push(noble);
      nobleByProvince.set(province.i, index);

      const liegeIndex = rulerByState.get(province.state);
      if (liegeIndex !== undefined) characters[index].liege = liegeIndex;
    }

    this.addGuildMastersAndCommoners(characters);
    pack.characters = characters;
  }

  regenerate(): void {
    this.generate();
  }

  // Called after Eras advances the political map (Eras.applySuccession() locks surviving states,
  // States.regenerate() rebuilds the rest - locked states and their provinces keep their original
  // `i`, everything else is fresh). A surviving dynasty either keeps ruling, hands power to a
  // recorded heir, or - if it left no heir - goes extinct and a new house rises in its place.
  // Everything outside a locked state/province is generated exactly like a fresh map.
  applySuccession(yearsPerEra: number): void {
    const previous = pack.characters ?? [];
    const priorRulerByState = new Map(previous.filter(c => c.state !== undefined).map(c => [c.state as number, c]));
    const priorNobleByProvince = new Map(
      previous.filter(c => c.province !== undefined).map(c => [c.province as number, c])
    );

    const characters: Character[] = [];
    const rulerByState = new Map<number, number>();
    const extinctions: { state: State; prior: Character }[] = [];

    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const capital = pack.burgs[state.capital];
      if (!capital || !capital.i || capital.removed) continue;

      const index = characters.length;
      const prior = state.lock ? priorRulerByState.get(state.i) : undefined;
      const role = `${this.getRulerTitle(state.formName)} of ${state.name}`;

      const law = this.getSuccessionLaw(state.formName);
      let ruler = prior ? this.succeed(index, prior, capital.i, role, yearsPerEra, law) : undefined;
      if (prior && !ruler) extinctions.push({ state, prior });
      if (!ruler) {
        ruler = this.createRuler(index, state, capital);
        this.tryFormMarriageAlliance(ruler, state, rulerByState, characters);
      }

      characters.push(ruler);
      rulerByState.set(state.i, index);
    }
    this.linkStateLieges(characters, rulerByState);

    // a childless ruler married into another crown doesn't end their line - the crowns merge
    for (const { state, prior } of extinctions) {
      this.resolveMarriageMerge(state, prior, characters, rulerByState);
    }

    const nobleByProvince = new Map<number, number>();
    const provinceAdjacency = this.buildProvinceAdjacency();
    const provinceExtinctions: { province: Province; prior: Character; originalName: string }[] = [];

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const index = characters.length;
      const prior = priorNobleByProvince.get(province.i);
      const role = `${this.getProvinceTitle(province.formName)} of ${province.name}`;

      // a county follows its own kingdom's succession custom, not a rule tied to its noble rank
      const law = this.getSuccessionLaw(pack.states[province.state]?.formName);
      let noble = prior ? this.succeed(index, prior, burg.i, role, yearsPerEra, law) : undefined;
      // captured before createProvinceNoble can rename it via founder-naming below
      if (prior && !noble) provinceExtinctions.push({ province, prior, originalName: province.name });
      if (!noble) {
        noble = this.createProvinceNoble(index, province, burg);
        this.tryFormCountyMarriageAlliance(noble, province, provinceAdjacency, nobleByProvince, characters);
      }

      characters.push(noble);
      nobleByProvince.set(province.i, index);

      const liegeIndex = rulerByState.get(province.state);
      if (liegeIndex !== undefined) characters[index].liege = liegeIndex;
    }

    // a childless noble married into a neighboring county doesn't end their line - the counties merge
    for (const { province, prior, originalName } of provinceExtinctions) {
      this.resolveCountyMerge(province, prior, originalName, characters, nobleByProvince);
    }

    this.addGuildMastersAndCommoners(characters);
    pack.characters = characters;
  }

  // states[f].diplomacy[t] records the role f plays toward t; a state with "Vassal" somewhere in
  // its own array plays that role toward whichever state sits at that index - its suzerain
  private getSuzerainStateIndex(state: State): number | undefined {
    const suzerainIndex = state.diplomacy?.indexOf("Vassal") ?? -1;
    return suzerainIndex > 0 ? suzerainIndex : undefined;
  }

  private linkStateLieges(characters: Character[], rulerByState: Map<number, number>): void {
    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const rulerIndex = rulerByState.get(state.i);
      if (rulerIndex === undefined) continue;

      const suzerainIndex = this.getSuzerainStateIndex(state);
      const liegeIndex = suzerainIndex === undefined ? undefined : rulerByState.get(suzerainIndex);
      if (liegeIndex !== undefined) characters[rulerIndex].liege = liegeIndex;
    }
  }

  // real dynastic marriages overwhelmingly happened between neighboring realms - sealing peace
  // with a rival next door, or cementing an existing alliance - not between two random, unrelated
  // crowns on opposite sides of the world
  private isMarriageEligibleState(state: State, otherStateId: number): boolean {
    if (state.neighbors?.includes(otherStateId)) return true;
    const relation = state.diplomacy?.[otherStateId];
    return relation === "Ally" || relation === "Friendly";
  }

  // ties this ruler to an already-resolved ruler of another (neighboring or allied) crown, both
  // ways - the tie itself is what a childless death later resolves into a merger of the two realms
  private tryFormMarriageAlliance(
    ruler: Character,
    state: State,
    rulerByState: Map<number, number>,
    characters: Character[]
  ): void {
    if (rulerByState.size === 0 || !P(MARRIAGE_ALLIANCE_CHANCE)) return;

    const candidates = [...rulerByState.entries()]
      .filter(([otherStateId]) => this.isMarriageEligibleState(state, otherStateId))
      .map(([, index]) => index);
    if (!candidates.length) return;

    const partnerIndex = ra(candidates);
    const partner = characters[partnerIndex];
    if (!partner || partner.spouseState !== undefined) return;

    ruler.spouse = partner.name;
    ruler.spouseState = partner.state;
    partner.spouse = ruler.name;
    partner.spouseState = ruler.state;
  }

  // a childless ruler married into another crown: their realm doesn't pass to a stranger, it
  // merges into their spouse's - the smaller crown's territory, provinces and burgs transfer, and
  // the spouse's ruler (already resolved this era) reigns over both
  private resolveMarriageMerge(
    state: State,
    prior: Character,
    characters: Character[],
    rulerByState: Map<number, number>
  ): void {
    if (prior.spouseState === undefined) return;

    const survivor = pack.states[prior.spouseState];
    if (!survivor || !survivor.i || survivor.removed || survivor.i === state.i) return;

    const survivorRulerIndex = rulerByState.get(survivor.i);
    if (survivorRulerIndex === undefined) return;

    const absorbedRulerIndex = rulerByState.get(state.i);
    if (absorbedRulerIndex !== undefined) {
      characters[absorbedRulerIndex].removed = true;
      rulerByState.delete(state.i);
    }

    for (const cellId of pack.cells.i) {
      if (pack.cells.state[cellId] === state.i) pack.cells.state[cellId] = survivor.i;
    }
    for (const province of pack.provinces ?? []) {
      if (province.state === state.i) province.state = survivor.i;
    }
    for (const burg of pack.burgs) {
      if (burg.state === state.i) burg.state = survivor.i;
    }

    state.removed = true;
    survivor.fullName = `${survivor.fullName} (united with ${state.name})`;
    characters[survivorRulerIndex].role = `${characters[survivorRulerIndex].role}, uniting the crown of ${state.name}`;
  }

  // one pass over every cell, recording which provinces actually share a border - so county
  // marriages can be restricted to real neighbors instead of any county under the same crown
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

  // same idea as tryFormMarriageAlliance, one tier down: a county marries into a NEIGHBORING
  // county of the same state - crossing into a different kingdom would leave a county stranded in
  // foreign territory, and a random county across the whole realm is no more realistic than a
  // random crown across the world
  private tryFormCountyMarriageAlliance(
    noble: Character,
    province: Province,
    provinceAdjacency: Map<number, Set<number>>,
    nobleByProvince: Map<number, number>,
    characters: Character[]
  ): void {
    if (!P(MARRIAGE_ALLIANCE_CHANCE)) return;

    const neighboringProvinceIds = provinceAdjacency.get(province.i);
    if (!neighboringProvinceIds) return;

    const candidates = [...nobleByProvince.entries()]
      .filter(
        ([provinceId]) =>
          neighboringProvinceIds.has(provinceId) && pack.provinces?.[provinceId]?.state === province.state
      )
      .map(([, index]) => index);
    if (!candidates.length) return;

    const partnerIndex = ra(candidates);
    const partner = characters[partnerIndex];
    if (!partner || partner.spouseProvince !== undefined) return;

    noble.spouse = partner.name;
    noble.spouseProvince = partner.province;
    partner.spouse = noble.name;
    partner.spouseProvince = noble.province;
  }

  // a childless noble married into a neighboring county: their land merges into their spouse's,
  // same mechanism as resolveMarriageMerge but one tier down and without the diplomacy consequences
  private resolveCountyMerge(
    province: Province,
    prior: Character,
    originalName: string,
    characters: Character[],
    nobleByProvince: Map<number, number>
  ): void {
    if (prior.spouseProvince === undefined) return;

    const survivor = pack.provinces?.[prior.spouseProvince];
    if (!survivor || !survivor.i || survivor.removed || survivor.i === province.i) return;
    if (survivor.state !== province.state) return; // safety net; shouldn't happen by construction

    const survivorNobleIndex = nobleByProvince.get(survivor.i);
    if (survivorNobleIndex === undefined) return;

    const absorbedNobleIndex = nobleByProvince.get(province.i);
    if (absorbedNobleIndex !== undefined) {
      characters[absorbedNobleIndex].removed = true;
      nobleByProvince.delete(province.i);
    }

    for (const cellId of pack.cells.i) {
      if (pack.cells.province[cellId] === province.i) pack.cells.province[cellId] = survivor.i;
    }

    province.removed = true;
    survivor.fullName = `${survivor.fullName} (united with ${originalName})`;
    characters[survivorNobleIndex].role =
      `${characters[survivorNobleIndex].role}, uniting the county of ${originalName}`;
  }

  private createRuler(index: number, state: State, capital: Burg): Character {
    return {
      ...this.createNoble(index, {
        burg: capital.i,
        culture: state.culture,
        role: `${this.getRulerTitle(state.formName)} of ${state.name}`
      }),
      state: state.i
    };
  }

  private createProvinceNoble(index: number, province: Province, burg: Burg): Character {
    const culture = burg.culture ?? pack.states[province.state]?.culture ?? 0;
    const nobleName = Names.getCulture(culture);

    // the province takes the noble's own name, rather than an unrelated random word - a real
    // historical pattern for smaller lordships, less common for old, established ones
    if (P(FOUNDER_NAMING_CHANCE)) {
      province.name = Names.getState(nobleName, culture);
      province.fullName = `${province.name} ${province.formName}`;
    }

    return {
      ...this.createNoble(index, {
        burg: burg.i,
        culture,
        name: nobleName,
        role: `${this.getProvinceTitle(province.formName)} of ${province.name}`
      }),
      province: province.i
    };
  }

  // decide whether a still-locked ruler/noble ages another era and keeps their seat, dies and
  // hands it to a recorded heir, or - with no heir on record - returns undefined so the caller
  // starts a fresh house instead. Mortality is driven by age against their own species' lifespan,
  // not a flat probability - a 40-year-old dwarf and a 40-year-old goblin are nowhere near the
  // same point in their lives
  private succeed(
    index: number,
    prior: Character,
    burg: number,
    role: string,
    yearsPerEra: number,
    law: SuccessionLaw
  ): Character | undefined {
    const lifespan = this.getLifespanYears(prior.culture);
    const age = (prior.age ?? this.getStartingAge(lifespan)) + yearsPerEra;

    if (!P(this.getDeathChance(age, lifespan))) {
      // liege is cleared and reassigned by the caller - carrying over the previous round's index
      // would point at the wrong character in this round's freshly built array
      const { liege: _liege, ...stillRules } = prior;
      return { ...stillRules, i: index, burg, role, age };
    }

    const heirName = this.getHeir(prior.children, law);
    if (!heirName) return undefined; // no heir survives under this law - the dynasty ends here

    return {
      // the heir carries on the same house; createNoble would otherwise roll a fresh, unrelated one
      ...this.createNoble(index, { burg, culture: prior.culture, name: heirName, role }),
      dynasty: prior.dynasty,
      state: prior.state,
      province: prior.province
    };
  }

  private getSuccessionLaw(formName?: string): SuccessionLaw {
    if (!formName) return DEFAULT_SUCCESSION_LAW;
    const base = formName.startsWith("Divine ") ? formName.slice("Divine ".length) : formName;
    return SUCCESSION_LAW_BY_FORM[base] ?? DEFAULT_SUCCESSION_LAW;
  }

  // who inherits depends on the law, not just birth order - agnatic succession can go extinct
  // with daughters alone (as it really did, e.g. France in 1328), elective doesn't care about
  // birth order at all, and ultimogeniture picks the last child rather than the first
  private getHeir(children: Child[] | undefined, law: SuccessionLaw): string | undefined {
    if (!children?.length) return undefined;

    if (law === "elective") return ra(children).name;
    if (law === "ultimogeniture") return children[children.length - 1].name;
    if (law === "absolute") return children[0].name;

    const sons = children.filter(child => child.gender === "m");
    if (law === "agnatic") return sons[0]?.name;
    return (sons[0] ?? children[0]).name; // male-preference: eldest son, else eldest child
  }

  private getLifespanYears(culture: number): number {
    const base = pack.cultures[culture]?.base;
    return (base !== undefined && LIFESPAN_YEARS_BY_BASE[base]) || DEFAULT_LIFESPAN_YEARS;
  }

  // a ruler or noble typically comes to power as a young adult, occasionally later in life
  private getStartingAge(lifespanYears: number): number {
    return rand(Math.round(lifespanYears * 0.15), Math.round(lifespanYears * 0.55));
  }

  // mortality is negligible through the first half of a natural lifespan, then ramps up linearly
  // to near-certain by the time it's fully spent - simple, but scales correctly across species
  private getDeathChance(age: number, lifespanYears: number): number {
    return minmax((age - lifespanYears * 0.5) / (lifespanYears * 0.5), 0.03, 0.95);
  }

  private addGuildMastersAndCommoners(characters: Character[]): void {
    for (const guild of pack.guilds ?? []) {
      if (guild.removed) continue;
      const burg = pack.burgs[guild.burg];
      if (!burg || !burg.i || burg.removed) continue;

      characters.push(
        this.createNoble(characters.length, {
          burg: guild.burg,
          culture: guild.culture,
          role: `${guild.craft} Guild Master`
        })
      );
    }

    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;

      const count = this.getCommonerCount(burg);
      for (let n = 0; n < count; n++) {
        characters.push({
          i: characters.length,
          name: Names.getCulture(burg.culture ?? 0),
          burg: burg.i,
          culture: burg.culture ?? 0,
          role: ra(COMMONER_ARCHETYPES),
          importance: "common"
        });
      }
    }
  }

  private createNoble(index: number, seed: NobleSeed): Character {
    return {
      i: index,
      name: seed.name ?? Names.getCulture(seed.culture),
      burg: seed.burg,
      culture: seed.culture,
      role: seed.role,
      importance: "notable",
      dynasty: `House of ${Names.getCultureShort(seed.culture)}`,
      age: this.getStartingAge(this.getLifespanYears(seed.culture)),
      ...this.getFamily(seed.culture)
    };
  }

  // a lightweight family snapshot, not a simulated lineage - most nobles have a spouse and a
  // handful of children, some don't
  private getFamily(culture: number): { spouse?: string; children?: Child[] } {
    if (!P(0.85)) return {};

    const spouse = Names.getCulture(culture);
    const childrenCount = ra([0, 1, 1, 2, 2, 3]);
    if (!childrenCount) return { spouse };

    // the name-bases don't distinguish gender (the same list generates every name), so gender is
    // assigned separately, at even odds - it still lets a succession law meaningfully apply
    const children: Child[] = Array.from({ length: childrenCount }, () => ({
      name: Names.getCulture(culture),
      gender: P(0.5) ? "m" : "f"
    }));
    return { spouse, children };
  }

  private getRulerTitle(formName?: string): string {
    if (!formName) return "Ruler";
    if (formName.startsWith("Divine ")) {
      const base = formName.slice("Divine ".length);
      return `Divine ${RULER_TITLES[base] ?? "Ruler"}`;
    }
    return RULER_TITLES[formName] ?? "Ruler";
  }

  private getProvinceTitle(formName?: string): string {
    if (!formName) return "Governor";
    return PROVINCE_TITLES[formName] ?? "Governor";
  }

  // bigger burgs support more people worth naming; small hamlets get none
  private getCommonerCount(burg: Burg): number {
    const population = burg.population ?? 0;
    if (population < 2) return 0;
    return Math.min(3, Math.floor(Math.log2(population + 1) / 3));
  }
}

export const Characters = new CharactersModule();
