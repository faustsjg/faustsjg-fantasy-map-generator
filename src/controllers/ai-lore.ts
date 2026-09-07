import { pointer } from "d3";
import { refreshEditors } from "@/components/dialog/dialog-helpers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import { buildLorePrompt, parseStateLore } from "@/generators/state-lore";
import type { State } from "@/generators/states-generator";
import { findEl } from "../utils";

// stopMapPlacement() only clears .pressed off buttons inside #addFeature;
// this button lives in the general Tools list, so it must unpress itself.
function stop(): void {
  stopMapPlacement();
  findEl("addAiLore")?.classList.remove("pressed");
}

function toggle(): void {
  if (findEl("addAiLore")?.classList.contains("pressed")) {
    stop();
    return;
  }

  toggleMapPlacement("addAiLore", onMapClick, "Click a state's territory to generate its founding lore");
}

function onMapClick(event: MouseEvent): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  const cell = Pack.findCell(point[0], point[1]);
  if (cell === undefined) return;

  const stateId = pack.cells.state[cell];
  const state = pack.states[stateId];
  if (!stateId || !state || state.removed) {
    tip("Click on a cell that belongs to a state", true, "error", 4000);
    return;
  }

  stop();

  const cultureName = pack.cultures[state.culture]?.name ?? "unknown";
  const prompt = buildLorePrompt(state.name, cultureName, options.year);
  void Controllers.AiGenerator.open({ defaultPrompt: prompt, onApply: result => onApply(result, state) });
}

function onApply(result: string, state: State): void {
  const lore = parseStateLore(result, options.year);
  if (!lore) {
    tip("Could not parse a valid lore response from the AI", true, "error", 6000);
    return;
  }

  // Saved as plain data on the state object, so it round-trips through
  // pack.states like any other field — no extra .map wiring needed.
  state.lore = lore;
  refreshEditors();
  tip(`${state.name}, founded ${lore.founded}: ${lore.description}`, true, "success", 8000);
}

export const AiLore = { toggle };
