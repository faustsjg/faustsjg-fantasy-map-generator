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
import type { Character } from "@/generators/characters-generator";
import { downloadFile, getFileName } from "@/utils";
import { ensureEl } from "../utils";

const dialogId = "charactersOverview" as const;
const position = { my: "center top", at: "center top+10", of: "svg", collision: "fit" };

const columns: EditorColumn<Character>[] = [
  {
    key: "importance",
    label: "Importance",
    width: "6.5em",
    permanent: true,
    sortBy: character => character.importance,
    sortType: "alpha",
    defaultSort: "asc"
  },
  {
    key: "role",
    label: "Role",
    width: "12em",
    permanent: true,
    sortBy: character => character.role,
    sortType: "alpha"
  },
  { key: "name", label: "Name", width: "9em", permanent: true, sortBy: character => character.name, sortType: "alpha" },
  { key: "dynasty", label: "Dynasty", width: "10em", sortBy: character => character.dynasty ?? "", sortType: "alpha" },
  { key: "liege", label: "Liege", width: "9em", sortBy: character => getLiegeName(character), sortType: "alpha" },
  { key: "burg", label: "Burg", width: "9em", sortBy: character => getBurgName(character), sortType: "alpha" },
  {
    key: "culture",
    label: "Culture",
    width: "9em",
    sortBy: character => getCultureName(character),
    sortType: "alpha"
  }
];

const charactersTable = initEditorTable<Character>({ getData: getCharacters, onUpdate: renderCharactersPage });

function open(): void {
  renderDialog();
  charactersTable.reset();

  $(`#${dialogId}`).dialog({
    title: "Characters",
    position,
    close: closeCharactersOverview
  });
}

function renderDialog(): void {
  document.getElementById(dialogId)?.remove();
  const html = /* html */ `<div id="${dialogId}" class="dialog stable editorDialog">
    <div>
      ${renderEditorHeader({ dialogId, columns })}
      <div id="charactersOverviewBody" class="table" style="max-height: 30em"></div>

      <div id="charactersOverviewFooter" class="totalLine">
        <div style="margin-left: 5px" data-tip="Characters count">
          Characters: <span id="charactersOverviewFooterCount">0</span>
        </div>
      </div>

      <div id="charactersOverviewBottom">
        <button id="charactersOverviewRefresh" data-tip="Refresh the Characters screen" class="icon-cw"></button>
        <button
          id="charactersOverviewExport"
          data-tip="Save characters data as a text file (.csv)"
          class="icon-download"
        ></button>
      </div>
    </div>
  </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);
  bindColumnSorting(dialogId, charactersTable.reset);
  initColumnVisibility({
    dialogId,
    columns,
    onUpdate: () => updateDialog(dialogId, { width: "fit-content", position })
  });

  ensureEl("charactersOverviewRefresh").addEventListener("click", charactersTable.refresh);
  ensureEl("charactersOverviewExport").addEventListener("click", downloadCharactersCsv);
  ensureEl("charactersOverviewBody").addEventListener("click", ev => {
    const el = ev.target as HTMLElement;
    const line = el.closest<HTMLElement>(".characterLine");
    if (!line) return;
    const character = (pack.characters ?? []).find(c => c.i === Number(line.dataset.id));
    if (!character) return;

    const burg = pack.burgs[character.burg];
    if (burg) zoomTo(burg.x, burg.y, 8, 2000);
  });
}

function closeCharactersOverview(): void {
  $(`#${dialogId}`).dialog("destroy");
  ensureEl(dialogId).remove();
}

function getCharacters(): Character[] {
  const characters = (pack.characters ?? []).filter(character => !character.removed);
  return sortDataByColumns(dialogId, characters, columns);
}

function getBurgName(character: Character): string {
  return pack.burgs[character.burg]?.name ?? "";
}

function getCultureName(character: Character): string {
  return pack.cultures[character.culture]?.name ?? "";
}

function getLiegeName(character: Character): string {
  if (character.liege === undefined) return "";
  return pack.characters?.[character.liege]?.name ?? "";
}

function getLiegeLabel(character: Character): string {
  if (character.liege === undefined) return "Independent";
  const liege = pack.characters?.[character.liege];
  return liege ? `${liege.name}, ${liege.role}` : "Independent";
}

function renderCharactersPage(view: TableView<Character>): void {
  const lines = view.rows.map(renderCharacterLine).join("");
  ensureEl("charactersOverviewBody").innerHTML = lines || "No characters recorded";
  ensureEl("charactersOverviewFooterCount").innerHTML = String(view.all.length);
  renderEditorPagination(ensureEl("charactersOverviewFooter"), view, charactersTable.goto);
  updateDialog(dialogId, { width: "fit-content", position });
}

function renderCharacterLine(character: Character): string {
  return /* html */ `<div class="states characterLine" data-id="${character.i}">
      <div data-col="importance">${character.importance}</div>
      <div data-col="role">${character.role}</div>
      <div data-col="name">${character.name}</div>
      <div data-col="dynasty">${character.dynasty ?? ""}</div>
      <div data-col="liege" data-tip="${getLiegeLabel(character)}">${getLiegeName(character) || "—"}</div>
      <div data-col="burg" class="pointer" data-tip="Click to zoom">${getBurgName(character)}</div>
      <div data-col="culture">${getCultureName(character)}</div>
    </div>`;
}

function downloadCharactersCsv(): void {
  let csv = "Id,Importance,Role,Name,Dynasty,Liege,Spouse,Children,Burg,Culture\n";
  for (const character of pack.characters ?? []) {
    if (character.removed) continue;
    csv += [
      character.i,
      character.importance,
      character.role,
      character.name,
      character.dynasty ?? "",
      getLiegeName(character),
      character.spouse ?? "",
      `"${(character.children ?? []).map(child => child.name).join("; ")}"`,
      getBurgName(character),
      getCultureName(character)
    ].join(",");
    csv += "\n";
  }

  downloadFile(csv, `${getFileName("Characters")}.csv`);
}

export const CharactersOverview = { open };
