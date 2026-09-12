import { updateDialog } from "@/components/dialog/dialog-helpers";
import { bindColumnSorting, sortDataByColumns } from "@/components/dialog/sorting";
import {
  type EditorColumn,
  initColumnVisibility,
  initEditorTable,
  renderEditorHeader,
  renderEditorPagination,
  type TableView
} from "@/components/dialog/table";
import type { Guild } from "@/generators/guilds-generator";
import { downloadFile, getFileName } from "@/utils";
import { ensureEl } from "../utils";

const dialogId = "guildsOverview" as const;
const position = { my: "center top", at: "center top+10", of: "svg", collision: "fit" };

const columns: EditorColumn<Guild>[] = [
  { key: "craft", label: "Craft", width: "9em", permanent: true, sortBy: guild => guild.craft, sortType: "alpha" },
  { key: "name", label: "Guild", width: "12em", permanent: true, sortBy: guild => guild.name, sortType: "alpha" },
  {
    key: "burg",
    label: "Burg",
    width: "9em",
    sortBy: guild => getBurgName(guild),
    sortType: "alpha"
  },
  {
    key: "culture",
    label: "Culture",
    width: "9em",
    sortBy: guild => getCultureName(guild),
    sortType: "alpha"
  },
  { key: "influence", label: "Influence", width: "5em", sortBy: guild => guild.influence, defaultSort: "desc" },
  { key: "actions", width: "1.2em", permanent: true }
];

const guildsTable = initEditorTable<Guild>({ getData: getGuilds, onUpdate: renderGuildsPage });

function open(): void {
  renderDialog();
  guildsTable.reset();

  $(`#${dialogId}`).dialog({
    title: "Guilds",
    position,
    close: closeGuildsOverview
  });
}

function renderDialog(): void {
  document.getElementById(dialogId)?.remove();
  const html = /* html */ `<div id="${dialogId}" class="dialog stable editorDialog">
    <div>
      ${renderEditorHeader({ dialogId, columns })}
      <div id="guildsOverviewBody" class="table" style="max-height: 30em"></div>

      <div id="guildsOverviewFooter" class="totalLine">
        <div style="margin-left: 5px" data-tip="Guilds count">Guilds: <span id="guildsOverviewFooterCount">0</span></div>
      </div>

      <div id="guildsOverviewBottom">
        <button id="guildsOverviewRefresh" data-tip="Refresh the Guilds screen" class="icon-cw"></button>
        <button id="guildsOverviewExport" data-tip="Save guilds data as a text file (.csv)" class="icon-download"></button>
      </div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
  bindColumnSorting(dialogId, guildsTable.reset);
  initColumnVisibility({
    dialogId,
    columns,
    onUpdate: () => updateDialog(dialogId, { width: "fit-content", position })
  });

  ensureEl("guildsOverviewRefresh").addEventListener("click", guildsTable.refresh);
  ensureEl("guildsOverviewExport").addEventListener("click", downloadGuildsCsv);
  ensureEl("guildsOverviewBody").addEventListener("click", ev => {
    const el = ev.target as HTMLElement;
    const guildId = el.closest<HTMLElement>(".guildLine")?.dataset.id;
    const guild = (pack.guilds ?? []).find(g => g.i === Number(guildId));
    const burg = guild && pack.burgs[guild.burg];
    if (burg) zoomTo(burg.x, burg.y, 8, 2000);
  });
}

function closeGuildsOverview(): void {
  $(`#${dialogId}`).dialog("destroy");
  ensureEl(dialogId).remove();
}

function getGuilds(): Guild[] {
  const guilds = (pack.guilds ?? []).filter(guild => !guild.removed);
  return sortDataByColumns(dialogId, guilds, columns);
}

function getBurgName(guild: Guild): string {
  return pack.burgs[guild.burg]?.name ?? "";
}

function getCultureName(guild: Guild): string {
  return pack.cultures[guild.culture]?.name ?? "";
}

function renderGuildsPage(view: TableView<Guild>): void {
  const lines = view.rows.map(renderGuildLine).join("");
  ensureEl("guildsOverviewBody").innerHTML = lines || "No guilds recorded";
  ensureEl("guildsOverviewFooterCount").innerHTML = String(view.all.length);
  renderEditorPagination(ensureEl("guildsOverviewFooter"), view, guildsTable.goto);
  updateDialog(dialogId, { width: "fit-content", position });
}

function renderGuildLine(guild: Guild): string {
  return /* html */ `<div class="states guildLine" data-id="${guild.i}">
      <div data-col="craft">${guild.craft}</div>
      <div data-col="name">${guild.name}</div>
      <div data-col="burg" class="pointer" data-tip="Click to zoom">${getBurgName(guild)}</div>
      <div data-col="culture">${getCultureName(guild)}</div>
      <div data-col="influence">${guild.influence}</div>
    </div>`;
}

function downloadGuildsCsv(): void {
  let csv = "Id,Guild,Craft,Burg,Culture,Influence\n";
  for (const guild of pack.guilds ?? []) {
    if (guild.removed) continue;
    csv += [guild.i, guild.name, guild.craft, getBurgName(guild), getCultureName(guild), guild.influence].join(",");
    csv += "\n";
  }

  downloadFile(csv, `${getFileName("Guilds")}.csv`);
}

export const GuildsOverview = { open };
