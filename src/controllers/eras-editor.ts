import { select } from "d3";
import { closeDialogs, confirmationDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { Controllers } from "@/controllers";
import type { Era } from "@/generators/eras-generator";
import type { State } from "@/generators/states-generator";
import { unfog } from "@/renderers/overlays/fogging";
import type { Emblem } from "@/types/emblems";
import type { TypedArray } from "@/types/PackedGraph";
import { ensureEl } from "../utils";

let playbackTimer: number | undefined;
// which already-generated era's snapshot the live pack.states/burgs/provinces currently reflect -
// selectEra() keeps this in sync; commitCoaEditsForward() reads it to know which era (and how many
// later ones) a coa edit made on the live map should be written back into. undefined means "not
// currently showing a specific era's snapshot" (nothing to commit against).
let currentEraIndex: number | undefined;

function open(): void {
  closeDialogs("#erasEditor, .stable");
  renderDialog();

  ensureEl("erasGenerate").addEventListener("click", generate);
  ensureEl<HTMLInputElement>("erasSlider").addEventListener("input", onSliderInput);
  ensureEl("erasPlayPause").addEventListener("click", togglePlayback);
  ensureEl("erasEventLog").addEventListener("click", onEventLogClick);

  // the dialog was closed (not the map) while browsing an older era, e.g. to open the Emblems
  // editor on a burg's coa - jumping straight to the latest era below would otherwise silently
  // discard that edit the same way scrubbing the slider away from it would
  if (currentEraIndex !== undefined) commitCoaEditsForward(currentEraIndex);

  if (pack.eras?.length) showPlayback(pack.eras.length - 1);

  $("#erasEditor").dialog({
    title: "Eras",
    resizable: false,
    width: "22em",
    position: { my: "left top", at: "left+10 top+10", of: "svg", collision: "fit" },
    close: closeErasEditor
  });
}

function renderDialog(): void {
  document.getElementById("erasEditor")?.remove();
  const html = /* html */ `<div id="erasEditor" class="dialog stable">
    <div id="erasControls">
      <div data-tip="Number of political snapshots to generate, one per era">
        <label for="erasCount">Eras</label>
        <input id="erasCount" type="number" min="2" max="20" value="5" step="1" />
      </div>
      <div data-tip="How many years pass between one era and the next">
        <label for="erasYears">Years per era</label>
        <input id="erasYears" type="number" min="10" max="1000" value="100" step="10" />
      </div>
      <button id="erasGenerate">Generate</button>
    </div>
    <div id="erasPlayback" hidden>
      <div id="erasPlaybackControls">
        <button id="erasPlayPause" data-tip="Play/pause the timeline" class="icon-play"></button>
        <input id="erasSlider" type="range" min="0" max="0" value="0" step="1" />
        <select id="erasSpeed" data-tip="Playback speed">
          <option value="1600">Slow</option>
          <option value="800" selected>Normal</option>
          <option value="400">Fast</option>
        </select>
      </div>
      <div id="erasYearLabel"></div>
      <div id="erasEventLog"></div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  document.getElementById("erasEditorStyles")?.remove();
  const style = document.createElement("style");
  style.id = "erasEditorStyles";
  style.textContent = /* css */ `
    #erasControls > div {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.4em;
    }

    #erasControls input {
      width: 5em;
    }

    #erasGenerate {
      width: 100%;
    }

    #erasPlayback {
      /* .dialog > div defaults to width: max-content (fine for #erasControls' short label+input
         rows) - overridden here because it let the event log's long, unwrapped lines size this
         element (and so the whole fixed-width dialog) to their max-content width instead of
         wrapping, producing a horizontal scrollbar */
      width: 100%;
      margin-top: 0.6em;
    }

    #erasPlaybackControls {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }

    #erasSlider {
      flex: 1;
      /* flex items default to min-width: auto (their own intrinsic size), which for a range
         input is wide enough that this row (button + slider + speed select) doesn't fit the
         dialog's fixed width - min-width: 0 lets it actually shrink instead of pushing
         #erasSpeed past the row's own edge */
      min-width: 0;
    }

    #erasYearLabel {
      text-align: center;
      margin-top: 0.3em;
    }

    #erasEventLog {
      max-height: 10em;
      overflow-x: hidden;
      overflow-y: auto;
      margin-top: 0.4em;
      box-sizing: border-box;
    }

    /* matches the thin scrollbar .dialog/.table already use elsewhere - the browser-default one
       otherwise reserves ~15px, wide enough to push this element past the dialog's own fixed width */
    #erasEventLog::-webkit-scrollbar {
      width: 6px;
    }

    #erasEventLog::-webkit-scrollbar-thumb {
      background-color: #aaa;
      border-radius: 6px;
    }

    .erasEventLine {
      font-size: 0.9em;
      padding: 0.1em 0;
      overflow-wrap: break-word;
    }

    .erasStateLink {
      cursor: pointer;
      text-decoration: underline dotted;
    }
  `;
  document.head.append(style);
}

function generate(): void {
  const validStates = pack.states?.filter(s => s.i && !s.removed) ?? [];
  if (!validStates.length) return void tip("Generate states first, then generate eras", false, "error");

  const count = ensureEl<HTMLInputElement>("erasCount").valueAsNumber;
  const years = ensureEl<HTMLInputElement>("erasYears").valueAsNumber;
  if (!count || count < 1) return void tip("<i>Eras</i> must be at least 1", false, "error");
  if (!years || years < 1) return void tip("<i>Years per era</i> must be at least 1", false, "error");

  // ErasModule.generate() always reads the live map (states/burgs/pop, edits and all - see
  // selectEra() above) as its own starting point, so if the slider is currently sitting on an
  // older era rather than the latest one, running it now regenerates forward from THAT era and
  // throws away every already-generated era after it. That's the intended way to redo history
  // from a chosen point, but it's also destructive and easy to trigger by accident just by
  // pressing Generate again without noticing the slider had been moved - so it's confirmed here
  // rather than run straight away, same as the "wipes every emblem" warning on Regenerate Emblems.
  const eras = pack.eras;
  const isRegeneratingFromPast = currentEraIndex !== undefined && !!eras?.length && currentEraIndex < eras.length - 1;
  if (isRegeneratingFromPast) {
    const discardedCount = eras!.length - 1 - currentEraIndex!;
    const fromYear = eras![currentEraIndex!].year;
    confirmationDialog({
      title: "Regenerate from this era",
      message: `This discards the ${discardedCount} era(s) already generated after year ${fromYear} and generates a new future from here instead. Continue?`,
      confirm: "Regenerate",
      onConfirm: () => runGenerate(count, years)
    });
    return;
  }

  runGenerate(count, years);
}

function runGenerate(count: number, years: number): void {
  stopPlayback();
  // a fresh run replaces pack.eras wholesale - any index left over from browsing the previous run
  // no longer means anything against this new array
  currentEraIndex = undefined;
  window.Eras.generate(count, years);

  const actualCount = pack.eras?.length ?? 0;
  if (actualCount < count) {
    tip(
      `Generated only ${actualCount} of ${count} eras: every surviving state locked at once in one era, leaving nothing left to regenerate`,
      false,
      "warn"
    );
  }

  showPlayback(actualCount - 1);
}

function showPlayback(index: number): void {
  const eras = pack.eras;
  if (!eras?.length) return;

  const playback = ensureEl("erasPlayback");
  playback.hidden = false;

  const slider = ensureEl<HTMLInputElement>("erasSlider");
  slider.max = String(eras.length - 1);
  slider.value = String(index);

  selectEra(index);
}

function onSliderInput(event: Event): void {
  stopPlayback();
  if (currentEraIndex !== undefined) commitCoaEditsForward(currentEraIndex);
  const index = Number((event.target as HTMLInputElement).value);
  selectEra(index, true);
}

function togglePlayback(): void {
  if (playbackTimer === undefined) startPlayback();
  else stopPlayback();
}

function startPlayback(): void {
  const eras = pack.eras;
  if (!eras?.length) return;

  const slider = ensureEl<HTMLInputElement>("erasSlider");
  if (Number(slider.value) >= eras.length - 1) {
    if (currentEraIndex !== undefined) commitCoaEditsForward(currentEraIndex);
    slider.value = "0";
    selectEra(0);
  }

  setPlayPauseIcon(true);
  const speed = ensureEl<HTMLInputElement>("erasSpeed").valueAsNumber || 800;
  playbackTimer = window.setInterval(() => {
    if (currentEraIndex !== undefined) commitCoaEditsForward(currentEraIndex);
    const index = Number(slider.value) + 1;
    if (index > eras.length - 1) {
      stopPlayback();
      return;
    }
    slider.value = String(index);
    selectEra(index, true);
  }, speed);
}

function stopPlayback(): void {
  if (playbackTimer === undefined) return;
  clearInterval(playbackTimer);
  playbackTimer = undefined;
  setPlayPauseIcon(false);
}

// no icon-pause glyph exists in this project's icon font, so the pause state falls back to a
// plain text glyph instead of an icon class
function setPlayPauseIcon(isPlaying: boolean): void {
  const button = ensureEl("erasPlayPause");
  button.className = isPlaying ? "" : "icon-play";
  button.textContent = isPlaying ? "⏸" : "";
}

// selectEra() clones an era's own coa objects into the live pack.states/burgs/provinces, so
// editing one there (the Emblems editor's drag/reshape, cultures-editor.ts's shield picker) only
// ever touches that live clone - the stored era snapshot, and every later one, never hears about
// it. Without this, the edit renders fine until the moment the era slider moves again (selectEra()
// overwrites the live clone from the pristine snapshot) or the dialog is reopened after being
// closed on an old era (which jumps straight to the latest one) - at which point it's gone
// without a trace, and was never in what gets saved either. Called right before each of those
// discard points, for whichever era `fromIndex` says the live map currently reflects: any coa that
// no longer matches what that era's own snapshot has is the edit - confirmed once (covering every
// changed entity at once, not one dialog per entity), then written into that era's own snapshot
// and forward into every later one (matched by persistentId for states/provinces, since era-to-era
// renumbering makes .i unusable for that; by .i for burgs, which are only ever pruned in place,
// never renumbered). Eras before fromIndex are left alone - nothing about the past should change
// because of an edit made looking at a later point in it. A cancelled confirmation simply leaves
// the edit uncommitted, the same as if this function had never run at all.
function commitCoaEditsForward(fromIndex: number): void {
  const eras = pack.eras;
  const fromEra = eras?.[fromIndex];
  if (!eras || !fromEra) return;
  const laterEras = eras.slice(fromIndex);

  const pendingWrites: Array<() => void> = [];

  const collectChanges = <T extends { coa?: Emblem }>(
    liveEntities: T[],
    getCollection: (era: Era) => T[],
    getKey: (entity: T) => number | string | undefined
  ): void => {
    const storedByKey = new Map<number | string, T>();
    for (const entity of getCollection(fromEra)) {
      const key = getKey(entity);
      if (key !== undefined) storedByKey.set(key, entity);
    }

    for (const liveEntity of liveEntities) {
      const key = getKey(liveEntity);
      if (key === undefined || !liveEntity.coa) continue;

      const stored = storedByKey.get(key);
      if (!stored || JSON.stringify(stored.coa) === JSON.stringify(liveEntity.coa)) continue;

      pendingWrites.push(() => {
        for (const era of laterEras) {
          const target = getCollection(era).find(entity => getKey(entity) === key);
          if (target) target.coa = structuredClone(liveEntity.coa);
        }
      });
    }
  };

  collectChanges(
    pack.states,
    era => era.states,
    s => s.persistentId
  );
  collectChanges(
    pack.burgs,
    era => era.burgs,
    b => b.i
  );
  collectChanges(
    pack.provinces ?? [],
    era => era.provinces,
    p => p.persistentId
  );

  if (!pendingWrites.length) return;

  const laterCount = laterEras.length - 1;
  const laterEraNote = laterCount > 0 ? ` and its ${laterCount} later era(s)` : "";
  confirmationDialog({
    title: "Apply emblem edit forward",
    message: `You edited an emblem while looking at year ${fromEra.year}. This will apply from here${laterEraNote} - the eras before it are left as they were. Continue?`,
    confirm: "Apply",
    onConfirm: () => {
      for (const write of pendingWrites) write();
    }
  });
}

// Apply one era's political snapshot to the live map and redraw. Geography
// (heights, rivers, biomes...) is untouched; only what expandStates() itself
// writes - states, provinces, burgs and their cell ownership - plus
// pack.characters, is restored, so this is the exact inverse of taking the
// snapshot. Skipping any one of these would leave that layer/panel drawing
// whatever era was generated last instead of the one actually selected.
// `highlight` flashes territory whose controlling state was born or died since the map's current
// state - skipped on the dialog's own opening render, where "since" isn't meaningful yet.
function selectEra(index: number, highlight = false): void {
  const era = pack.eras?.[index];
  if (!era) return;

  const previousCellsState = highlight ? pack.cells.state.slice() : undefined;
  const previousStates = highlight ? pack.states : undefined;

  pack.states = structuredClone(era.states);
  pack.cells.state = Uint16Array.from(era.cellsState);
  pack.provinces = structuredClone(era.provinces);
  pack.cells.province = Uint16Array.from(era.cellsProvince);
  pack.burgs = structuredClone(era.burgs);
  pack.characters = structuredClone(era.characters);
  pack.cells.pop = Float32Array.from(era.cellsPop);
  // the year LABEL below always matched the era shown, but options.year itself (what
  // ErasModule.generate() actually reads as "now") didn't - clicking Generate while looking at an
  // older era would silently start the new run from whatever year the last run ended on, not this
  // era's own year
  options.year = era.year;
  currentEraIndex = index;

  unfog();
  Layers.draw("states", "borders", "provinces", "labels", "burgIcons", "military", "goods", "emblems");

  ensureEl("erasYearLabel").textContent = `Year: ${era.year}`;

  if (previousCellsState && previousStates) {
    highlightChangedTerritory(previousCellsState, previousStates, pack.cells.state, pack.states);
    renderEventLog(previousCellsState, previousStates, pack.cells.state, pack.states, era.epidemicEvents);
  } else {
    ensureEl("erasEventLog").innerHTML = "";
  }
}

// A state ceding border provinces to a neighbor, or merely being renumbered/renamed while it
// survives (recreate() renumbers even locked states every era; mutateName() can reword a
// surviving state's name), is not an event worth calling out - only a birth or a death is.
// Matched by persistentId, the identifier that survives renumbering (see persistent-id.ts),
// never by the volatile state.i.
function getBornAndDiedIds(
  previousStates: State[],
  currentStates: State[]
): { bornIds: Set<number>; diedIds: Set<number> } {
  const previousPersistentIds = new Set(previousStates.filter(s => s.i && !s.removed).map(s => s.persistentId));
  const currentPersistentIds = new Set(currentStates.filter(s => s.i && !s.removed).map(s => s.persistentId));

  const bornIds = new Set(
    [...currentPersistentIds].filter((id): id is number => id !== undefined && !previousPersistentIds.has(id))
  );
  const diedIds = new Set(
    [...previousPersistentIds].filter((id): id is number => id !== undefined && !currentPersistentIds.has(id))
  );
  return { bornIds, diedIds };
}

// Flashes only the footprint of states that were born or died between the two snapshots.
function highlightChangedTerritory(
  previousCellsState: TypedArray,
  previousStates: State[],
  currentCellsState: TypedArray,
  currentStates: State[]
): void {
  const { cells, vertices } = pack;

  const { bornIds, diedIds } = getBornAndDiedIds(previousStates, currentStates);
  if (!bornIds.size && !diedIds.size) return;

  const previousPersistentIdByIndex = new Map(previousStates.map(s => [s.i, s.persistentId]));
  const currentPersistentIdByIndex = new Map(currentStates.map(s => [s.i, s.persistentId]));

  const changedCells: number[] = [];
  for (let cellId = 0; cellId < currentCellsState.length; cellId++) {
    if (cells.h[cellId] < 20) continue; // land only - ownership isn't tracked for ocean cells

    const currentPersistentId = currentPersistentIdByIndex.get(currentCellsState[cellId]);
    const previousPersistentId = previousPersistentIdByIndex.get(previousCellsState[cellId]);
    const isNowNewlyBorn = currentPersistentId !== undefined && bornIds.has(currentPersistentId);
    const wasPreviouslyOfDeadState = previousPersistentId !== undefined && diedIds.has(previousPersistentId);

    if (isNowNewlyBorn || wasPreviouslyOfDeadState) changedCells.push(cellId);
  }
  if (!changedCells.length) return;

  const path = changedCells
    .map(cellId => {
      const points = cells.v[cellId].map((vertexId: number) => vertices.p[vertexId]);
      return `M${points.map(([x, y]: [number, number]) => `${x},${y}`).join("L")}Z`;
    })
    .join(" ");

  const layer = select("#debug");
  layer.selectAll(".eraChangeHighlight").remove();
  layer
    .append("path")
    .attr("class", "eraChangeHighlight")
    .attr("d", path)
    .attr("fill", "#ff2222")
    .attr("fill-opacity", 0.55)
    .attr("stroke", "none")
    .style("pointer-events", "none")
    .transition()
    .delay(500)
    .duration(1000)
    .attr("fill-opacity", 0)
    .remove();
}

// Short, template-built (no AI) summary of the same birth/death events the highlight flashes -
// what a state was absorbed by is derived from whichever current state now holds the most of its
// former land, not stored anywhere, since Wars/Rebellions never record who took what.
function renderEventLog(
  previousCellsState: TypedArray,
  previousStates: State[],
  currentCellsState: TypedArray,
  currentStates: State[],
  epidemicEvents: string[]
): void {
  const container = ensureEl("erasEventLog");

  const { bornIds, diedIds } = getBornAndDiedIds(previousStates, currentStates);
  if (!bornIds.size && !diedIds.size && !epidemicEvents.length) {
    container.innerHTML = "";
    return;
  }

  const previousByPersistentId = new Map(previousStates.map(s => [s.persistentId, s]));
  const currentByPersistentId = new Map(currentStates.map(s => [s.persistentId, s]));

  // disease/famine notes are causes, so they read naturally ahead of whatever births/deaths
  // followed from them this era - eras-generator.ts already writes these out as plain text
  const lines: string[] = [...epidemicEvents];

  for (const id of bornIds) {
    const state = currentByPersistentId.get(id);
    if (state) lines.push(`🆕 ${stateLink(state)} is founded`);
  }

  for (const id of diedIds) {
    const state = previousByPersistentId.get(id);
    if (!state) continue;
    const name = state.fullName ?? state.name; // no current .i to link to - this state no longer exists
    const absorber = findAbsorber(previousCellsState, state.i, currentCellsState, currentStates);
    lines.push(absorber ? `☠️ ${name} falls, absorbed by ${stateLink(absorber)}` : `☠️ ${name} collapses`);
  }

  container.innerHTML = lines.map(line => `<div class="erasEventLine">${line}</div>`).join("");
}

// A state still present in the CURRENT snapshot (so it has a live, clickable state.i) gets a link
// that opens its Dynasty panel; states that no longer exist just render their name as plain text.
function stateLink(state: State): string {
  return `<span class="erasStateLink" data-state-i="${state.i}">${state.fullName ?? state.name}</span>`;
}

function onEventLogClick(event: Event): void {
  const link = (event.target as HTMLElement).closest<HTMLElement>(".erasStateLink");
  if (!link) return;
  void Controllers.DynastyOverview.open(Number(link.dataset.stateI));
}

// Whichever current state now holds the most of the dead state's former land cells, if any.
function findAbsorber(
  previousCellsState: TypedArray,
  deadStateIndex: number,
  currentCellsState: TypedArray,
  currentStates: State[]
): State | null {
  const cellCountByCurrentOwner = new Map<number, number>();
  for (let cellId = 0; cellId < previousCellsState.length; cellId++) {
    if (pack.cells.h[cellId] < 20) continue;
    if (previousCellsState[cellId] !== deadStateIndex) continue;

    const currentOwner = currentCellsState[cellId];
    if (!currentOwner) continue;
    cellCountByCurrentOwner.set(currentOwner, (cellCountByCurrentOwner.get(currentOwner) ?? 0) + 1);
  }

  let bestOwner: number | undefined;
  let bestCount = 0;
  for (const [owner, count] of cellCountByCurrentOwner) {
    if (count > bestCount) {
      bestOwner = owner;
      bestCount = count;
    }
  }
  if (bestOwner === undefined) return null;

  return currentStates.find(s => s.i === bestOwner && !s.removed) ?? null;
}

function closeErasEditor(): void {
  stopPlayback();
  // closing alone doesn't discard the live map (only selectEra()/open() do), but pack.eras is
  // what actually gets saved - commit now so an edit made while browsing an old era is already
  // written into its snapshot if the user saves or exports right after closing this dialog,
  // without ever touching the slider again
  if (currentEraIndex !== undefined) commitCoaEditsForward(currentEraIndex);
  $("#erasEditor").dialog("destroy");
  ensureEl("erasEditor").remove();
  document.getElementById("erasEditorStyles")?.remove();
}

export const ErasEditor = { open };
