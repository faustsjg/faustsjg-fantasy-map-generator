// Named individuals living in the world: rulers, provincial nobles, guild masters, and ordinary
// people known for something small - worldbuilding texture, not adventure hooks or quest-givers.
// Titles, dynasties and family ties are all derived procedurally from the existing state/province
// data (form, diplomacy) - nothing here is AI-generated. Only the on-demand bio (characters-overview.ts)
// calls out to the AI generator, and only when a user clicks for it.
import { P, ra } from "@/utils";
import type { Burg } from "./burgs-generator";
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

class CharactersModule {
  generate(): void {
    const characters: Character[] = [];
    const rulerByState = new Map<number, number>(); // state.i -> character index

    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const capital = pack.burgs[state.capital];
      if (!capital || !capital.i || capital.removed) continue;

      const index = characters.length;
      characters.push(
        this.createNoble(index, {
          burg: capital.i,
          culture: state.culture,
          role: `${this.getRulerTitle(state.formName)} of ${state.name}`
        })
      );
      rulerByState.set(state.i, index);
    }

    // a vassal state's rank comes from its suzerain - link the ruler characters the same way
    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const rulerIndex = rulerByState.get(state.i);
      if (rulerIndex === undefined) continue;

      const suzerainIndex = this.getSuzerainStateIndex(state);
      const liegeIndex = suzerainIndex === undefined ? undefined : rulerByState.get(suzerainIndex);
      if (liegeIndex !== undefined) characters[rulerIndex].liege = liegeIndex;
    }

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const culture = burg.culture ?? pack.states[province.state]?.culture ?? 0;
      const nobleName = Names.getCulture(culture);

      // the province takes the noble's own name, rather than an unrelated random word - a real
      // historical pattern for smaller lordships, less common for old, established ones
      if (P(FOUNDER_NAMING_CHANCE)) {
        province.name = Names.getState(nobleName, culture);
        province.fullName = `${province.name} ${province.formName}`;
      }

      const index = characters.length;
      characters.push(
        this.createNoble(index, {
          burg: burg.i,
          culture,
          name: nobleName,
          role: `${this.getProvinceTitle(province.formName)} of ${province.name}`
        })
      );

      const liegeIndex = rulerByState.get(province.state);
      if (liegeIndex !== undefined) characters[index].liege = liegeIndex;
    }

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

    pack.characters = characters;
  }

  regenerate(): void {
    this.generate();
  }

  // states[f].diplomacy[t] records the role f plays toward t; a state with "Vassal" somewhere in
  // its own array plays that role toward whichever state sits at that index - its suzerain
  private getSuzerainStateIndex(state: State): number | undefined {
    const suzerainIndex = state.diplomacy?.indexOf("Vassal") ?? -1;
    return suzerainIndex > 0 ? suzerainIndex : undefined;
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
