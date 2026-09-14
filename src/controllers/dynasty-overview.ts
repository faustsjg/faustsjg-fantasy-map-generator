// Per-state view of who rules now and who ruled before them. The reign history is reconstructed
// from pack.eras' character snapshots, matched by statePersistentId - the one identifier that
// survives every era's state.i renumbering (see persistent-id.ts). No new data is generated here.
import { closeDialogs, destroyDialog, updateDialog } from "@/components/dialog/dialog-helpers";
import type { Character } from "@/generators/characters-generator";
import type { State } from "@/generators/states-generator";
import { EmblemRenderer } from "@/renderers/emblems/renderer";
import { ensureEl, si } from "../utils";

const dialogId = "dynastyOverview" as const;
const position = { my: "center top", at: "center top+10", of: "svg", collision: "fit" };

interface Reign {
  name: string;
  dynasty?: string;
  role: string;
  startYear: number;
  endYear: number;
}

function open(stateId: number): void {
  const state = pack.states[stateId];
  if (!state?.i || state.removed) return;

  closeDialogs(`#${dialogId}, .stable`);
  renderDialog(state);

  $(`#${dialogId}`).dialog({ title: `Dynasty: ${state.name}`, width: "26em", position, close: closeDynastyOverview });
}

function closeDynastyOverview(): void {
  destroyDialog(dialogId);
}

function getRuler(state: State): Character | undefined {
  return pack.characters?.find(c => c.state === state.i && !c.removed);
}

// One row per era where this state (matched by the persistentId that survives renumbering) had a
// recorded ruler; consecutive eras with the same ruler name collapse into a single reign span.
function buildReignHistory(state: State): Reign[] {
  if (state.persistentId === undefined || !pack.eras?.length) return [];

  const reigns: Reign[] = [];
  for (const era of pack.eras) {
    const ruler = era.characters.find(c => c.statePersistentId === state.persistentId);
    if (!ruler) continue;

    const last = reigns[reigns.length - 1];
    if (last && last.name === ruler.name) last.endYear = era.year;
    else
      reigns.push({
        name: ruler.name,
        dynasty: ruler.dynasty,
        role: ruler.role,
        startYear: era.year,
        endYear: era.year
      });
  }
  return reigns;
}

function renderDialog(state: State): void {
  destroyDialog(dialogId);
  EmblemRenderer.trigger(`stateCOA${state.i}`, state.coa);

  const html = /* html */ `<div id="${dialogId}" class="dialog stable" style="max-height: 60vh; overflow-y: auto">
    <div id="dynastyOverviewHeader">
      <svg class="coaIcon" viewBox="0 0 200 200"><use href="#stateCOA${state.i}"></use></svg>
      <div>
        <div id="dynastyOverviewStateName">${state.fullName ?? state.name}</div>
        <div id="dynastyOverviewCapital" class="pointer" data-tip="Click to zoom to the capital">${pack.burgs[state.capital]?.name ?? ""}</div>
        <div id="dynastyOverviewTreasury" data-tip="State treasury">🟡 ${si(state.treasury)}</div>
      </div>
    </div>
    <div id="dynastyOverviewRuler"></div>
    <div id="dynastyOverviewHistoryTitle">Line of succession</div>
    <div id="dynastyOverviewHistory"></div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  if (!document.getElementById("dynastyOverviewStyles")) {
    const style = document.createElement("style");
    style.id = "dynastyOverviewStyles";
    style.textContent = /* css */ `
      #dynastyOverviewHeader { display: flex; align-items: center; gap: 0.6em; margin-bottom: 0.6em; }
      #dynastyOverviewHeader .coaIcon { width: 2.6em; height: 2.6em; flex-shrink: 0; }
      #dynastyOverviewStateName { font-weight: bold; }
      #dynastyOverviewHistoryTitle { font-weight: bold; margin-top: 0.7em; margin-bottom: 0.3em; }
      .dynastyRulerCard > div { margin-bottom: 0.2em; }
      #${dialogId} { overflow-x: hidden; }
      .dynastyReign { padding: 0.15em 0; border-bottom: 1px solid rgba(128, 128, 128, 0.2); overflow-wrap: break-word; }
      .dynastyReign:last-child { border-bottom: none; font-weight: bold; }
      .dynastyReignYears { opacity: 0.8; }
      .dynastyLiegeLink { cursor: pointer; text-decoration: underline dotted; }
    `;
    document.head.append(style);
  }

  ensureEl("dynastyOverviewCapital").addEventListener("click", () => {
    const capital = pack.burgs[state.capital];
    if (capital) zoomTo(capital.x, capital.y, 8, 2000);
  });

  renderRuler(state);
  renderHistory(state);
  updateDialog(dialogId, { width: "26em", position });

  ensureEl("dynastyOverviewRuler").addEventListener("click", ev => {
    const link = (ev.target as HTMLElement).closest<HTMLElement>(".dynastyLiegeLink");
    if (!link) return;
    const liegeState = pack.states[Number(link.dataset.stateI)];
    if (liegeState?.i && !liegeState.removed) open(liegeState.i);
  });
}

function renderRuler(state: State): void {
  const container = ensureEl("dynastyOverviewRuler");
  const ruler = getRuler(state);
  if (!ruler) {
    container.innerHTML = "No ruler recorded for this state.";
    return;
  }

  const liege = ruler.liege !== undefined ? pack.characters?.[ruler.liege] : undefined;
  const liegeName =
    liege?.state !== undefined
      ? `<span class="dynastyLiegeLink" data-state-i="${liege.state}">${liege.name}</span>`
      : liege?.name;
  const liegeLine = liege ? `<div>Answers to: ${liegeName}, ${liege.role}</div>` : "";
  const spouseLine = ruler.spouse ? `<div>Spouse: ${ruler.spouse}</div>` : "";
  const childrenLine = ruler.children?.length
    ? `<div>Children: ${ruler.children.map(c => c.name).join(", ")}</div>`
    : "";

  container.innerHTML = /* html */ `<div class="dynastyRulerCard">
    <div><b>${ruler.name}</b> — ${ruler.role}</div>
    <div>House: ${ruler.dynasty ?? "—"}</div>
    ${spouseLine}
    ${childrenLine}
    ${liegeLine}
  </div>`;
}

function renderHistory(state: State): void {
  const container = ensureEl("dynastyOverviewHistory");
  const reigns = buildReignHistory(state);
  if (!reigns.length) {
    container.innerHTML = "Generate Eras to see this state's succession history.";
    return;
  }

  container.innerHTML = reigns
    .map(reign => {
      const years = reign.startYear === reign.endYear ? `${reign.startYear}` : `${reign.startYear}–${reign.endYear}`;
      const dynasty = reign.dynasty ? `, ${reign.dynasty}` : "";
      return /* html */ `<div class="dynastyReign">
        <div>${reign.name}${dynasty} <span style="opacity: 0.75">(${reign.role})</span></div>
        <div class="dynastyReignYears">${years}</div>
      </div>`;
    })
    .join("");
}

export const DynastyOverview = { open };
