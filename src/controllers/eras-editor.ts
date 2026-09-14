import { select } from "d3";
import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { unfog } from "@/renderers/overlays/fogging";
import type { TypedArray } from "@/types/PackedGraph";
import { ensureEl } from "../utils";

let playbackTimer: number | undefined;

function open(): void {
  closeDialogs("#erasEditor, .stable");
  renderDialog();

  ensureEl("erasGenerate").addEventListener("click", generate);
  ensureEl<HTMLInputElement>("erasSlider").addEventListener("input", onSliderInput);
  ensureEl("erasPlayPause").addEventListener("click", togglePlayback);

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
      margin-top: 0.6em;
    }

    #erasPlaybackControls {
      display: flex;
      align-items: center;
      gap: 0.4em;
    }

    #erasSlider {
      flex: 1;
    }

    #erasYearLabel {
      text-align: center;
      margin-top: 0.3em;
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

  stopPlayback();
  window.Eras.generate(count, years);
  showPlayback(pack.eras!.length - 1);
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
    slider.value = "0";
    selectEra(0);
  }

  setPlayPauseIcon(true);
  const speed = ensureEl<HTMLInputElement>("erasSpeed").valueAsNumber || 800;
  playbackTimer = window.setInterval(() => {
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

// Apply one era's political snapshot to the live map and redraw. Geography
// (heights, rivers, biomes...) is untouched; only what expandStates() itself
// writes is restored, so this is the exact inverse of taking the snapshot.
// `highlight` flashes the cells whose owning state changed since the map's current state - skipped
// on the dialog's own opening render, where "changed since" isn't a meaningful comparison yet.
function selectEra(index: number, highlight = false): void {
  const era = pack.eras?.[index];
  if (!era) return;

  const previousCellsState = highlight ? pack.cells.state.slice() : undefined;

  pack.states = structuredClone(era.states);
  pack.cells.state = Uint16Array.from(era.cellsState);

  for (const burg of pack.burgs) {
    if (!burg.i || burg.removed) continue;
    burg.state = pack.cells.state[burg.cell];
  }

  unfog();
  Layers.draw("states", "borders", "provinces", "labels", "burgIcons", "military", "goods", "emblems");

  ensureEl("erasYearLabel").textContent = `Year: ${era.year}`;

  if (previousCellsState) highlightChangedTerritory(previousCellsState, pack.cells.state);
}

// One polygon per land cell that switched owning state between the previous and the new snapshot,
// briefly overlaid and faded out - reuses the #debug layer the same way states-editor.ts's own
// border highlight does for a transient, non-interactive overlay.
function highlightChangedTerritory(previous: TypedArray, current: TypedArray): void {
  const { cells, vertices } = pack;

  const changedCells: number[] = [];
  for (let cellId = 0; cellId < current.length; cellId++) {
    if (cells.h[cellId] < 20) continue; // land only - ownership isn't tracked for ocean cells
    if (previous[cellId] !== current[cellId]) changedCells.push(cellId);
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

function closeErasEditor(): void {
  stopPlayback();
  $("#erasEditor").dialog("destroy");
  ensureEl("erasEditor").remove();
  document.getElementById("erasEditorStyles")?.remove();
}

export const ErasEditor = { open };
