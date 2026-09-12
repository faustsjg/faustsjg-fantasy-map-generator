import { destroyDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { tip } from "@/components/tooltips";
import { CELLS_DENSITY_MAP, DetailExpander } from "@/generators/detail-expander";
import { ensureEl } from "../utils";

function open(): void {
  renderDialog();
  addListeners();

  $("#expandWorldTool").dialog({
    title: "Expand world detail",
    resizable: false,
    width: "32em",
    position: { my: "center", at: "center", of: "svg" },
    close: cleanup,
    buttons: {
      Expand: function (this: HTMLElement) {
        void expandWorld();
        $(this).dialog("close");
      },
      Cancel: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    }
  });
}

function renderDialog(): void {
  destroyDialog("expandWorldTool");

  const currentLevel = Number(ensureEl<HTMLInputElement>("pointsInput").value) || 4;
  const cells = CELLS_DENSITY_MAP[currentLevel];

  const html = /* html */ `<div id="expandWorldTool" class="dialog">
    <p>
      Keeps the current coastline and mountain shapes exactly as they are, but resamples the
      terrain onto a much denser grid and regenerates cultures, states, burgs, religions and
      provinces from scratch on top of it. More cells means more room for towns and cultures to
      appear on their own - the same land and sea layout, just with a lot more of it to fill in.
    </p>
    <p style="font-weight: bold">
      This operation is destructive and irreversible. Don't forget to save the .map file to your
      machine first!
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.5em">
      <div data-tip="Set the new points (cells) number" style="display: flex; gap: 1em">
        <div>Points number</div>
        <div>
          <input id="expandWorldPointsInput" type="range" min="1" max="13" value="${currentLevel}" />
          <output id="expandWorldPointsFormatted">${cells / 1000}K</output>
        </div>
      </div>
      <div data-tip="Recompute lake depressions and coastal detail for the new resolution, same as a fresh map">
        <input type="checkbox" class="checkbox" id="expandWorldErosion" checked />
        <label for="expandWorldErosion" class="checkbox-label">Allow erosion detail</label>
      </div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
}

function addListeners(): void {
  ensureEl<HTMLInputElement>("expandWorldPointsInput").oninput = handlePointsInput;
}

function cleanup(): void {
  destroyDialog("expandWorldTool");
}

function handlePointsInput(e: Event): void {
  const cells = CELLS_DENSITY_MAP[+(e.target as HTMLInputElement).value];
  ensureEl<HTMLOutputElement>("expandWorldPointsFormatted").value = `${cells / 1000}K`;
}

async function expandWorld(): Promise<void> {
  const densityLevel = +ensureEl<HTMLInputElement>("expandWorldPointsInput").value;
  const erosion = ensureEl<HTMLInputElement>("expandWorldErosion").checked;

  tip("Expanding world detail...", false, "info");
  try {
    undraw();
    await DetailExpander.process(densityLevel, erosion);
    Layers.drawAll();
    tip("World detail expanded", true, "success", 4000);
  } catch (error) {
    ERROR && console.error(error);
    tip(`Failed to expand world detail: ${(error as Error)?.message || "Unknown error"}`, true, "error", 5000);
  }
}

export const ExpandWorldTool = { open };
