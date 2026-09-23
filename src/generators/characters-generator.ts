// Named individuals living in the world: rulers, provincial nobles, guild masters, and ordinary
// people known for something small - worldbuilding texture, not adventure hooks or quest-givers.
// Titles, dynasties and family ties are all derived procedurally from the existing state/province
// data (form, diplomacy) - nothing here is AI-generated.
import { Emblems } from "@/generators/emblems-generator";
import { getNextPersistentId } from "@/generators/persistent-id";
import { getRandomColor, minmax, P, ra, rand, rw, withAnnotations } from "@/utils";
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
  state?: number; // for a ruler: the state.i they rule, for THIS era's own lookups/display
  province?: number; // for a provincial noble: the province.i they govern, same reason
  // state.i/province.i get renumbered every era, even for locked (surviving) states/provinces -
  // these track the actual stable identity, so next era's succession can recognize "the same
  // state/province as last era" regardless of what its .i happens to be renumbered to
  statePersistentId?: number;
  provincePersistentId?: number;
  // same reasoning as statePersistentId/provincePersistentId above: a marriage/county-alliance
  // tie can outlive several eras of renumbering before it's actually resolved (the ruler has to
  // die childless first) - storing the spouse's raw state.i/province.i at the moment of marriage
  // would silently point at a different state/province by the time the merge actually runs
  spouseStatePersistentId?: number; // for a ruler married into another crown: that state's persistentId
  spouseProvincePersistentId?: number; // for a noble married into another county: that province's persistentId
  age?: number; // in years; drives succession together with the culture's lifespan
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

// Azgaar already sorts every state into one of 5 top-level forms (states-generator.ts,
// defineStateForms) before it ever picks a specific title like Kingdom or Khanate - Monarchy,
// Republic, Union, Theocracy, Anarchy - and already weights that choice by culture (a Naval
// culture leans Republic). Succession law rides the same axis instead of inventing a new one:
// weighted per form, so a Monarchy is never electively-succeeded and a Republic never agnatic.
const SUCCESSION_LAW_WEIGHTS_BY_FORM: Record<string, Partial<Record<SuccessionLaw, number>>> = {
  Monarchy: { agnatic: 45, "male-preference": 35, ultimogeniture: 10, elective: 7, absolute: 3 },
  Republic: { elective: 85, absolute: 10, "male-preference": 5 },
  Union: { elective: 80, "male-preference": 10, absolute: 10 },
  Theocracy: { elective: 75, "male-preference": 15, absolute: 10 },
  Anarchy: { elective: 70, ultimogeniture: 15, absolute: 15 }
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

// after a hereditary handover, a chance the passed-over sibling's claim isn't just symbolic - the
// realm actually splits (partible inheritance was a real, if declining, alternative to primogeniture
// through most of the medieval period). Scoped to agnatic/male-preference successions only -
// elective and ultimogeniture already resolve without a "disputed succession" flavor.
const SUCCESSION_CRISIS_CHANCE = 0.12;

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
    // matched by persistentId, not by state.i/province.i - those get renumbered every era even for
    // locked (surviving) states/provinces, so last era's .i can't reliably identify this era's entity
    const priorRulerByState = new Map(
      previous.filter(c => c.statePersistentId !== undefined).map(c => [c.statePersistentId as number, c])
    );
    const priorNobleByProvince = new Map(
      previous.filter(c => c.provincePersistentId !== undefined).map(c => [c.provincePersistentId as number, c])
    );

    const characters: Character[] = [];
    const rulerByState = new Map<number, number>();
    const extinctions: { state: State; prior: Character }[] = [];
    // set by trySplitRealm/resolveMarriageMerge whenever they move cells between states - mirrors
    // Wars.resolveCampaigns()/Rebellions.resolve()'s own "anyChange -> collectStatistics()" pattern,
    // so a state's area/rural/urban (and the treasury Eras.updateTreasuries() derives from them)
    // never reflect stale, pre-split/pre-merger territory for this era
    let territoryChanged = false;

    // snapshotted so a splinter state created mid-loop (see trySplitRealm) isn't re-visited this
    // same pass - it gets its own succession/lock decision starting next era, like any other state
    for (const state of [...pack.states]) {
      if (!state.i || state.removed) continue;
      const capital = pack.burgs[state.capital];
      if (!capital || !capital.i || capital.removed) continue;

      const index = characters.length;
      const prior = state.lock ? priorRulerByState.get(state.persistentId as number) : undefined;
      const role = `${this.getRulerTitle(state.formName)} of ${state.name}`;

      const law = this.getSuccessionLaw(state);
      const succeeded = prior ? this.succeed(index, prior, capital.i, role, yearsPerEra, law) : undefined;
      if (prior && !succeeded) extinctions.push({ state, prior });

      let ruler = succeeded;
      if (!ruler) {
        ruler = this.createRuler(index, state, capital);
        this.tryFormMarriageAlliance(ruler, state, rulerByState, characters);
      } else {
        // succeed() carries prior's fields forward, which are last era's state.i/persistentId -
        // both get reasserted to this era's values regardless of which succeed() branch ran
        ruler.state = state.i;
        ruler.statePersistentId = state.persistentId;
      }

      characters.push(ruler);
      rulerByState.set(state.i, index);

      // a clean hereditary handover (not "still rules", not extinction) can still be contested -
      // scoped to laws with a fixed line of succession, where a passed-over sibling has a real claim
      const handedOver = succeeded && prior && succeeded.name !== prior.name;
      if (handedOver && (law === "agnatic" || law === "male-preference") && P(SUCCESSION_CRISIS_CHANCE)) {
        const runnerUp = this.getRunnerUpHeir(prior?.children, law, succeeded.name);
        if (runnerUp && this.trySplitRealm(state, index, runnerUp, characters, rulerByState)) territoryChanged = true;
      }
    }
    this.linkStateLieges(characters, rulerByState);

    // a childless ruler married into another crown doesn't end their line - the crowns merge.
    // one survivor can absorb more than one extinct crown in the same era, so every merge's name
    // is collected and applied as a single combined annotation per survivor at the end, instead of
    // each call overwriting the previous one's (withAnnotations() only ever keeps one trailing group)
    const mergedCrownNamesBySurvivor = new Map<number, string[]>();
    for (const { state, prior } of extinctions) {
      const merge = this.resolveMarriageMerge(state, prior, characters, rulerByState);
      if (!merge) continue;
      territoryChanged = true;
      const names = mergedCrownNamesBySurvivor.get(merge.survivor.i) ?? [];
      names.push(merge.absorbedName);
      mergedCrownNamesBySurvivor.set(merge.survivor.i, names);
    }
    for (const [survivorStateId, absorbedNames] of mergedCrownNamesBySurvivor) {
      const survivor = pack.states[survivorStateId];
      survivor.fullName = withAnnotations(
        survivor.fullName ?? survivor.name,
        absorbedNames.map(name => `united with ${name}`)
      );
    }
    if (territoryChanged) window.States.collectStatistics(); // refresh area/burgs/rural/urban after territory moved

    const nobleByProvince = new Map<number, number>();
    const provinceAdjacency = this.buildProvinceAdjacency();
    const provinceExtinctions: { province: Province; prior: Character; originalName: string }[] = [];

    for (const province of pack.provinces ?? []) {
      if (!province.i || province.removed) continue;
      const burg = pack.burgs[province.burg];
      if (!burg || !burg.i || burg.removed) continue;

      const index = characters.length;
      const prior = province.persistentId !== undefined ? priorNobleByProvince.get(province.persistentId) : undefined;
      const role = `${this.getProvinceTitle(province.formName)} of ${province.name}`;

      // a county follows its own kingdom's succession custom, not a rule tied to its noble rank
      const law = this.getSuccessionLaw(pack.states[province.state]);
      let noble = prior ? this.succeed(index, prior, burg.i, role, yearsPerEra, law) : undefined;
      // captured before createProvinceNoble can rename it via founder-naming below
      if (prior && !noble) provinceExtinctions.push({ province, prior, originalName: province.name });
      if (!noble) {
        noble = this.createProvinceNoble(index, province, burg);
        this.tryFormCountyMarriageAlliance(noble, province, provinceAdjacency, nobleByProvince, characters);
      } else {
        // succeed() carries prior's fields forward, which are last era's province.i/persistentId -
        // both get reasserted to this era's values regardless of which succeed() branch ran
        noble.province = province.i;
        noble.provincePersistentId = province.persistentId;
      }

      characters.push(noble);
      nobleByProvince.set(province.i, index);

      const liegeIndex = rulerByState.get(province.state);
      if (liegeIndex !== undefined) characters[index].liege = liegeIndex;
    }

    // a childless noble married into a neighboring county doesn't end their line - the counties
    // merge, same "combine same-era merges into one annotation" reasoning as the crown merge above
    const mergedCountyNamesBySurvivor = new Map<number, string[]>();
    for (const { province, prior, originalName } of provinceExtinctions) {
      const merge = this.resolveCountyMerge(province, prior, originalName, characters, nobleByProvince);
      if (!merge) continue;
      const names = mergedCountyNamesBySurvivor.get(merge.survivor.i) ?? [];
      names.push(merge.absorbedName);
      mergedCountyNamesBySurvivor.set(merge.survivor.i, names);
    }
    for (const [survivorProvinceId, absorbedNames] of mergedCountyNamesBySurvivor) {
      const survivor = pack.provinces?.[survivorProvinceId];
      if (!survivor) continue;
      survivor.fullName = withAnnotations(
        survivor.fullName ?? survivor.name,
        absorbedNames.map(name => `united with ${name}`)
      );
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
    if (!partner || partner.spouseStatePersistentId !== undefined) return;

    ruler.spouse = partner.name;
    ruler.spouseStatePersistentId = partner.statePersistentId;
    partner.spouse = ruler.name;
    partner.spouseStatePersistentId = ruler.statePersistentId;
  }

  // a childless ruler married into another crown: their realm doesn't pass to a stranger, it
  // merges into their spouse's - the smaller crown's territory, provinces and burgs transfer, and
  // the spouse's ruler (already resolved this era) reigns over both
  private resolveMarriageMerge(
    state: State,
    prior: Character,
    characters: Character[],
    rulerByState: Map<number, number>
  ): { survivor: State; absorbedName: string } | null {
    if (prior.spouseStatePersistentId === undefined) return null;
    // a userLocked realm is fully immune to being absorbed - same reasoning as wars-generator.ts's
    // annex() checking the defender's userLocked, not the surviving crown's: locking only protects,
    // it doesn't stop a state from marrying in and absorbing someone else. The marriage tie and the
    // childless ruler are left exactly as they are; the next era's extinctions loop reconsiders it.
    if (state.userLocked) return null;

    // matched by persistentId, not the raw state.i the marriage tie was formed with - that .i may
    // have been renumbered one or more eras ago, while this ruler kept ruling unchanged (a marriage
    // isn't resolved until the ruler actually dies childless, which can take several eras)
    const survivor = pack.states.find(s => s.persistentId === prior.spouseStatePersistentId);
    if (!survivor || !survivor.i || survivor.removed || survivor.i === state.i) return null;

    const survivorRulerIndex = rulerByState.get(survivor.i);
    if (survivorRulerIndex === undefined) return null;

    const absorbedRulerIndex = rulerByState.get(state.i);
    if (absorbedRulerIndex !== undefined) {
      characters[absorbedRulerIndex].removed = true;
      rulerByState.delete(state.i);

      // linkStateLieges() already ran, so any vassal of the now-extinct crown is still pointing at
      // this index - the merger passes their allegiance to the surviving crown instead of leaving
      // them bound to a dead ruler
      for (const character of characters) {
        if (character.liege === absorbedRulerIndex) character.liege = survivorRulerIndex;
      }
    }

    // burgs are matched against cells.state (the source of truth for territory), and BEFORE
    // cells.state itself gets reassigned below - matching against burg.state instead would
    // silently skip (and permanently propagate) any burg that had already drifted out of sync
    for (const burg of pack.burgs) {
      if (pack.cells.state[burg.cell] === state.i) burg.state = survivor.i;
    }
    for (const cellId of pack.cells.i) {
      if (pack.cells.state[cellId] === state.i) pack.cells.state[cellId] = survivor.i;
    }
    for (const province of pack.provinces ?? []) {
      if (province.state === state.i) {
        province.state = survivor.i;
        province.annexedYear = options.year; // newly under a foreign crown - a rebellion risk factor
      }
    }

    state.removed = true;
    characters[survivorRulerIndex].role = `${characters[survivorRulerIndex].role}, uniting the crown of ${state.name}`;
    return { survivor, absorbedName: state.name };
  }

  // the inverse of a merge: carves roughly half of the realm's provinces into a brand new state
  // for the passed-over sibling, a cadet branch of the same house. Needs at least 2 provinces to
  // mean anything - a single-province realm just isn't divisible this way, so it's left alone
  private trySplitRealm(
    state: State,
    primaryRulerIndex: number,
    runnerUp: Child,
    characters: Character[],
    rulerByState: Map<number, number>
  ): boolean {
    // a userLocked realm is never split up - same reasoning as rebellions-generator.ts's resolve()
    // checking state.userLocked before letting any of its provinces secede
    if (state.userLocked) return false;

    const provinces = (pack.provinces ?? []).filter(
      province => province.i && !province.removed && province.state === state.i
    );
    if (provinces.length < 2) return false;

    // the capital's own province must never end up in the splinter - array position reflects
    // when each province was first created (its state's own original generation pass), not who
    // currently rules it, so after any war annexation an older, lower-indexed conquered province
    // can sort before this state's own (newer, higher-indexed) capital province in this filter.
    // Individually locked provinces are excluded too, so a non-locked realm can still shield
    // specific provinces from ever landing in a splinter (same idea as wars-generator.ts's annex()
    // filtering .lock out of its own border-province selection).
    const capitalBurg = pack.burgs[state.capital];
    const capitalProvinceId = capitalBurg ? pack.cells.province?.[capitalBurg.cell] : undefined;
    const splinterableProvinces = provinces.filter(province => province.i !== capitalProvinceId && !province.lock);
    if (!splinterableProvinces.length) return false; // nothing left to give away

    const takeCount = Math.min(splinterableProvinces.length, Math.max(1, Math.floor(provinces.length / 2)));
    const splinterProvinces = splinterableProvinces.slice(splinterableProvinces.length - takeCount);
    const seatProvince = splinterProvinces[0];
    const seatBurg = pack.burgs[seatProvince.burg];
    if (!seatBurg || !seatBurg.i || seatBurg.removed) return false;

    const newStateId = pack.states.length;
    // a splinter kingdom echoes the crown it split from (kinship 0.4, the same "distinct but
    // recognizably related" weight provinces-generator.ts gives a province not named after its own
    // seat burg) - not state.coa itself, which would hand the splinter the literal same mutable
    // emblem object as the parent: editing either one's shield/position afterward would silently
    // edit both (see rebellions-generator.ts's secede(), which shares this exact reasoning)
    const coa = Emblems.generate(state.coa, 0.4, null, state.type);
    coa.shield = state.coa?.shield;
    // states-generator.ts's own generateDiplomacy() only runs once at the start of the era, before
    // this state exists - without its own relations array (one entry per state, "x" for itself),
    // anything that later reads or writes state.diplomacy[i] for every state (declaring another
    // province's independence, the Diplomacy editor) throws on this one until the next era's
    // regeneration rebuilds it properly. A peaceful sibling split, unlike a rebellion, so friendly
    // to the realm it split from rather than hostile - same house, a cadet branch.
    const diplomacy = pack.states.map(s => (!s.i || s.removed ? "x" : s.i === state.i ? "Friendly" : "Neutral"));
    diplomacy.push("x");
    const newState: State = {
      i: newStateId,
      persistentId: getNextPersistentId(),
      name: seatProvince.name,
      expansionism: state.expansionism,
      capital: seatBurg.i,
      type: state.type,
      center: seatBurg.cell,
      culture: state.culture,
      coa,
      form: state.form,
      formName: state.formName,
      color: getRandomColor(),
      salesTax: state.salesTax,
      pollTax: state.pollTax,
      treasury: 0,
      diplomacy
    };
    // a simpler fallback than States.getFullName's adjective-form rules - good enough for a
    // splinter state, and keeps this module free of a cross-generator dependency
    newState.fullName = `${newState.formName} of ${newState.name}`;
    pack.states.push(newState);
    for (const s of pack.states) {
      if (!s.i || s.removed || s.i === newStateId || !s.diplomacy) continue;
      s.diplomacy[newStateId] = s.i === state.i ? "Friendly" : "Neutral";
    }
    // states-generator.ts's own capital bookkeeping (stale-capital cleanup, capital-first
    // province-seat sorting) relies on this flag - without it, a later era's regeneration doesn't
    // know this burg is already someone's capital and can hand it to another state
    seatBurg.capital = 1;

    const splinterProvinceIds = new Set(splinterProvinces.map(province => province.i));
    for (const province of splinterProvinces) province.state = newStateId;
    for (const cellId of pack.cells.i) {
      if (splinterProvinceIds.has(pack.cells.province?.[cellId])) pack.cells.state[cellId] = newStateId;
    }
    for (const burg of pack.burgs) {
      if (splinterProvinceIds.has(pack.cells.province?.[burg.cell])) burg.state = newStateId;
    }

    const newRuler = this.createNoble(characters.length, {
      burg: seatBurg.i,
      culture: newState.culture,
      name: runnerUp.name,
      role: `${this.getRulerTitle(newState.formName)} of ${newState.name}`
    });
    newRuler.state = newStateId;
    newRuler.statePersistentId = newState.persistentId;
    newRuler.dynasty = characters[primaryRulerIndex].dynasty; // same house, a cadet branch
    rulerByState.set(newStateId, characters.length);
    characters.push(newRuler);

    characters[primaryRulerIndex].role = `${characters[primaryRulerIndex].role} (realm divided among siblings)`;
    return true;
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
    if (!partner || partner.spouseProvincePersistentId !== undefined) return;

    noble.spouse = partner.name;
    noble.spouseProvincePersistentId = partner.provincePersistentId;
    partner.spouse = noble.name;
    partner.spouseProvincePersistentId = noble.provincePersistentId;
  }

  // a childless noble married into a neighboring county: their land merges into their spouse's,
  // same mechanism as resolveMarriageMerge but one tier down and without the diplomacy consequences
  private resolveCountyMerge(
    province: Province,
    prior: Character,
    originalName: string,
    characters: Character[],
    nobleByProvince: Map<number, number>
  ): { survivor: Province; absorbedName: string } | null {
    if (prior.spouseProvincePersistentId === undefined) return null;

    // matched by persistentId, not the raw province.i the marriage tie was formed with - see the
    // identical reasoning on resolveMarriageMerge's own persistentId lookup above
    const survivor = pack.provinces?.find(p => p.persistentId === prior.spouseProvincePersistentId);
    if (!survivor || !survivor.i || survivor.removed || survivor.i === province.i) return null;
    if (survivor.state !== province.state) return null; // safety net; shouldn't happen by construction

    const survivorNobleIndex = nobleByProvince.get(survivor.i);
    if (survivorNobleIndex === undefined) return null;

    const absorbedNobleIndex = nobleByProvince.get(province.i);
    if (absorbedNobleIndex !== undefined) {
      characters[absorbedNobleIndex].removed = true;
      nobleByProvince.delete(province.i);
    }

    for (const cellId of pack.cells.i) {
      if (pack.cells.province[cellId] === province.i) pack.cells.province[cellId] = survivor.i;
    }

    province.removed = true;
    characters[survivorNobleIndex].role =
      `${characters[survivorNobleIndex].role}, uniting the county of ${originalName}`;
    return { survivor, absorbedName: originalName };
  }

  private createRuler(index: number, state: State, capital: Burg): Character {
    return {
      ...this.createNoble(index, {
        burg: capital.i,
        culture: state.culture,
        role: `${this.getRulerTitle(state.formName)} of ${state.name}`
      }),
      state: state.i,
      statePersistentId: state.persistentId
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
      province: province.i,
      provincePersistentId: province.persistentId
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

  // rolled once per (culture, state.form) pair and cached directly on the culture - every
  // Monarchy of that culture shares one succession custom, every Union of that same culture
  // shares its own (a culture isn't only ever one form: a Naval culture can hold both a Monarchy
  // and a Union at once, and each form has its own weight table). It stays put across
  // regenerations and eras (pack.cultures isn't touched by either), and even survives save/load
  // (cultures are saved as plain JSON, this field included). Only a genuinely new culture (a new
  // map, or an explicit Regenerate Cultures) rolls again.
  private getSuccessionLaw(state: State | undefined): SuccessionLaw {
    const form = state?.form ?? "Monarchy";
    const culture = pack.cultures[state?.culture ?? -1] as
      | { successionLawByForm?: Partial<Record<string, SuccessionLaw>> }
      | undefined;
    const cached = culture?.successionLawByForm?.[form];
    if (cached) return cached;

    const weights = SUCCESSION_LAW_WEIGHTS_BY_FORM[form] ?? SUCCESSION_LAW_WEIGHTS_BY_FORM.Monarchy;
    const law = rw(weights as Record<string, number>) as SuccessionLaw;
    if (culture) {
      culture.successionLawByForm ??= {};
      culture.successionLawByForm[form] = law;
    }
    return law;
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

  // the sibling who would inherit next under the same law, if the primary heir's claim didn't
  // stand - the seed of a succession crisis, not a real title until trySplitRealm acts on it
  private getRunnerUpHeir(
    children: Child[] | undefined,
    law: SuccessionLaw,
    primaryHeirName: string
  ): Child | undefined {
    const rest = children?.filter(child => child.name !== primaryHeirName);
    if (!rest?.length) return undefined;

    if (law === "agnatic") return rest.find(child => child.gender === "m");
    const sons = rest.filter(child => child.gender === "m");
    return sons[0] ?? rest[0]; // male-preference
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
