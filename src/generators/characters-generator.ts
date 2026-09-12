// Named individuals living in the world: rulers, guild masters, and ordinary people known for
// something small - worldbuilding texture, not adventure hooks or quest-givers.
import { ra } from "@/utils";
import type { Burg } from "./burgs-generator";
import type { State } from "./states-generator";

export interface Character {
  i: number;
  name: string;
  burg: number;
  culture: number;
  role: string;
  importance: "notable" | "common";
  bio?: string; // filled in on demand via the AI generator, not at generation time
  removed?: boolean;
}

// State.formName is a rich, long tail (Kingdom, Khanate, Shogunate, Beylik...); only the common
// ones get a dedicated ruler title, everything else falls back to "Ruler".
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
  Horde: "Khan",
  Ulus: "Khan",
  Tsardom: "Tsar",
  Caliphate: "Caliph",
  Shogunate: "Shogun",
  Emirate: "Emir",
  Despotate: "Despot",
  Satrapy: "Satrap",
  Beylik: "Bey"
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

class CharactersModule {
  generate(): void {
    const characters: Character[] = [];

    for (const state of pack.states) {
      if (!state.i || state.removed) continue;
      const capital = pack.burgs[state.capital];
      if (!capital || !capital.i || capital.removed) continue;

      characters.push({
        i: characters.length,
        name: Names.getCulture(state.culture),
        burg: capital.i,
        culture: state.culture,
        role: `${this.getRulerTitle(state)} of ${state.name}`,
        importance: "notable"
      });
    }

    for (const guild of pack.guilds ?? []) {
      if (guild.removed) continue;
      const burg = pack.burgs[guild.burg];
      if (!burg || !burg.i || burg.removed) continue;

      characters.push({
        i: characters.length,
        name: Names.getCulture(guild.culture),
        burg: guild.burg,
        culture: guild.culture,
        role: `${guild.craft} Guild Master`,
        importance: "notable"
      });
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

  private getRulerTitle(state: State): string {
    return RULER_TITLES[state.formName ?? ""] || "Ruler";
  }

  // bigger burgs support more people worth naming; small hamlets get none
  private getCommonerCount(burg: Burg): number {
    const population = burg.population ?? 0;
    if (population < 2) return 0;
    return Math.min(3, Math.floor(Math.log2(population + 1) / 3));
  }
}

export const Characters = new CharactersModule();
