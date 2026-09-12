// Craft and trade guilds: derived from each burg's actual production, not invented independently
import { rn } from "@/utils";
import type { Burg } from "./burgs-generator";
import type { CultureType } from "./cultures-generator";
import { isDealRecord, type LocalRecord, type MfgRecord } from "./production-generator";

export interface Guild {
  i: number;
  name: string;
  burg: number;
  culture: number;
  goodId?: number; // absent for the generic "Merchants" guild a burg falls back to
  craft: string;
  influence: number; // 1-100, roughly the guild's local economic weight
  removed?: boolean;
}

// Same two culture types the town-spacing modifier already clusters tighter along water for -
// coastal/river trade means more crafts worth organizing into a guild.
const MERCHANT_CULTURE_TYPES: Partial<Record<CultureType, number>> = {
  Naval: 1.8,
  River: 1.4
};

// Common goods get a real trade name; anything else falls back to "<Good> Traders"
const CRAFT_LABELS: Record<string, string> = {
  Iron: "Blacksmiths",
  Bronze: "Bronzesmiths",
  Copper: "Coppersmiths",
  Tin: "Tinsmiths",
  Gold: "Goldsmiths",
  Silver: "Silversmiths",
  Wood: "Carpenters",
  Mahogany: "Carpenters",
  Stone: "Masons",
  Marble: "Masons",
  Wine: "Vintners",
  Olives: "Pressers",
  Fish: "Fishmongers",
  Whales: "Whalers",
  Grain: "Millers",
  Cattle: "Butchers",
  Sheep: "Wool Merchants",
  Horses: "Horse Breeders",
  Leather: "Tanners",
  Furs: "Furriers",
  Cloth: "Weavers",
  Garments: "Tailors",
  Silk: "Silk Merchants",
  Ships: "Shipwrights",
  Sails: "Sailmakers",
  Ropes: "Ropemakers",
  Glass: "Glassblowers",
  Ceramics: "Potters",
  Clay: "Potters",
  Books: "Scribes",
  Paper: "Papermakers",
  Ink: "Scribes",
  Tools: "Toolmakers",
  Arms: "Armorers",
  Salt: "Salters",
  Gemstones: "Jewelers",
  Pearls: "Jewelers",
  Amber: "Jewelers",
  Spices: "Spice Traders",
  Tea: "Tea Merchants",
  Honey: "Beekeepers",
  Dyes: "Dyers"
};

class GuildsModule {
  generate(): void {
    const guilds: Guild[] = [];

    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;

      const count = this.getGuildCount(burg);
      if (!count) continue;

      this.topCrafts(burg, count).forEach((craft, index) => {
        guilds.push({
          i: guilds.length,
          name: this.getGuildName(burg, craft.label),
          burg: burg.i,
          culture: burg.culture ?? 0,
          goodId: craft.goodId,
          craft: craft.label,
          influence: this.getInfluence(burg, index)
        });
      });
    }

    pack.guilds = guilds;
  }

  regenerate(): void {
    this.generate();
  }

  // Bigger burgs support more distinct guilds; trade-oriented cultures (see
  // MERCHANT_CULTURE_TYPES) support noticeably more than a landlocked or nomadic one would.
  private getGuildCount(burg: Burg): number {
    const population = burg.population ?? 0;
    if (population < 3) return 0;

    const base = Math.min(4, Math.floor(Math.log2(population + 1) / 2));
    const cultureType = pack.cultures[burg.culture ?? 0]?.type;
    const modifier = (cultureType && MERCHANT_CULTURE_TYPES[cultureType]) || 1;
    return Math.max(0, Math.round(base * modifier));
  }

  // A guild forms around whatever the burg actually produces most of; short of real distinct
  // crafts, it falls back to a generic merchants' guild rather than inventing a good out of thin air.
  private topCrafts(burg: Burg, count: number): { goodId?: number; label: string }[] {
    const records = (burg.production ?? []).filter(record => !isDealRecord(record)) as (MfgRecord | LocalRecord)[];

    const unitsByGood = new Map<number, number>();
    for (const record of records) unitsByGood.set(record.goodId, (unitsByGood.get(record.goodId) || 0) + record.units);

    const sortedGoodIds = [...unitsByGood.entries()].sort((a, b) => b[1] - a[1]).map(([goodId]) => goodId);

    const crafts: { goodId?: number; label: string }[] = sortedGoodIds.slice(0, count).map(goodId => ({
      goodId,
      label: this.getCraftLabel(pack.goods[goodId]?.name)
    }));

    while (crafts.length < count) crafts.push({ label: "Merchants" });
    return crafts;
  }

  private getCraftLabel(goodName?: string): string {
    if (!goodName) return "Merchants";
    return CRAFT_LABELS[goodName] || `${goodName} Traders`;
  }

  private getGuildName(burg: Burg, craftLabel: string): string {
    return `${craftLabel} Guild of ${burg.name}`;
  }

  private getInfluence(burg: Burg, index: number): number {
    const population = burg.population ?? 0;
    return rn(Math.max(1, Math.min(100, population * 2 - index * 10)));
  }
}

export const Guilds = new GuildsModule();
