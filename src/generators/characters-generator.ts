// Named individuals living in the world: rulers, provincial nobles, guild masters, and ordinary
// people known for something small - worldbuilding texture, not adventure hooks or quest-givers.
// Titles, dynasties and family ties are all derived procedurally from the existing state/province
// data (form, diplomacy) - nothing here is AI-generated. Only the on-demand bio (characters-overview.ts)
// calls out to the AI generator, and only when a user clicks for it.
import { P, ra } from "@/utils";
import type { Burg } from "./burgs-generator";
import type { Province } from "./provinces-generator";
import type { State } from "./states-generator";

export interface Character {
  i: number;
  name: string;
  burg: number;
  culture: number;
  role: string;
  importance: "notable" | "common";
  dynasty?: string; // house name, notable characters only
  spouse?: string;
  children?: string[];
  liege?: number; // index into pack.characters of this character's overlord, if any
  state?: number; // for a ruler: the state.i they rule - lets Eras find them again next era
  province?: number; // for a provincial noble: the province.i they govern, same reason
  spouseState?: number; // for a ruler married into another crown: that state's i
  spouseProvince?: number; // for a noble married into another county: that province's i
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

// average length of a reign, in years - used to scale how likely succession is for a given era
// length: a 20-year era is likely to see one change of ruler, a 5-year one usually won't
const AVERAGE_REIGN_YEARS = 25;

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
      this.tryFormMarriageAlliance(ruler, rulerByState, characters);
      characters.push(ruler);
      rulerByState.set(state.i, index);
    }
    this.linkStateLieges(characters, rulerByState);

    const nobleByProvince = new Map<number, number>(); // province.i -> character index

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const index = characters.length;
      const noble = this.createProvinceNoble(index, province, burg);
      this.tryFormCountyMarriageAlliance(noble, province, nobleByProvince, characters);
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
    const successionChance = Math.min(0.9, Math.max(0.15, yearsPerEra / AVERAGE_REIGN_YEARS));

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

      let ruler = prior ? this.succeed(index, prior, capital.i, role, successionChance) : undefined;
      if (prior && !ruler) extinctions.push({ state, prior });
      if (!ruler) {
        ruler = this.createRuler(index, state, capital);
        this.tryFormMarriageAlliance(ruler, rulerByState, characters);
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
    const provinceExtinctions: { province: Province; prior: Character; originalName: string }[] = [];

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const index = characters.length;
      const prior = priorNobleByProvince.get(province.i);
      const role = `${this.getProvinceTitle(province.formName)} of ${province.name}`;

      let noble = prior ? this.succeed(index, prior, burg.i, role, successionChance) : undefined;
      // captured before createProvinceNoble can rename it via founder-naming below
      if (prior && !noble) provinceExtinctions.push({ province, prior, originalName: province.name });
      if (!noble) {
        noble = this.createProvinceNoble(index, province, burg);
        this.tryFormCountyMarriageAlliance(noble, province, nobleByProvince, characters);
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

  // ties this ruler to an already-resolved ruler of another crown, both ways - the tie itself is
  // what a childless death later resolves into a merger of the two realms
  private tryFormMarriageAlliance(ruler: Character, rulerByState: Map<number, number>, characters: Character[]): void {
    if (rulerByState.size === 0 || !P(MARRIAGE_ALLIANCE_CHANCE)) return;

    const partnerIndex = ra([...rulerByState.values()]);
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

  // same idea as tryFormMarriageAlliance, one tier down: a county marries into another county of
  // the same state - crossing into a different kingdom would leave a county stranded in foreign
  // territory, so partners are restricted to provinces sharing this one's state
  private tryFormCountyMarriageAlliance(
    noble: Character,
    province: Province,
    nobleByProvince: Map<number, number>,
    characters: Character[]
  ): void {
    if (!P(MARRIAGE_ALLIANCE_CHANCE)) return;

    const candidates = [...nobleByProvince.entries()]
      .filter(([provinceId]) => pack.provinces?.[provinceId]?.state === province.state)
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

  // decide whether a still-locked ruler/noble keeps their seat, hands it to a recorded heir, or -
  // with no heir on record - returns undefined so the caller starts a fresh house instead
  private succeed(
    index: number,
    prior: Character,
    burg: number,
    role: string,
    successionChance: number
  ): Character | undefined {
    if (!P(successionChance)) {
      // liege is cleared and reassigned by the caller - carrying over the previous round's index
      // would point at the wrong character in this round's freshly built array
      const { liege: _liege, ...stillRules } = prior;
      return { ...stillRules, i: index, burg, role };
    }

    const heirName = prior.children?.[0];
    if (!heirName) return undefined; // no heir survives - the dynasty ends here

    return {
      // the heir carries on the same house; createNoble would otherwise roll a fresh, unrelated one
      ...this.createNoble(index, { burg, culture: prior.culture, name: heirName, role }),
      dynasty: prior.dynasty,
      state: prior.state,
      province: prior.province
    };
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
      ...this.getFamily(seed.culture)
    };
  }

  // a lightweight family snapshot, not a simulated lineage - most nobles have a spouse and a
  // handful of children, some don't
  private getFamily(culture: number): { spouse?: string; children?: string[] } {
    if (!P(0.85)) return {};

    const spouse = Names.getCulture(culture);
    const childrenCount = ra([0, 1, 1, 2, 2, 3]);
    if (!childrenCount) return { spouse };

    const children = Array.from({ length: childrenCount }, () => Names.getCulture(culture));
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
