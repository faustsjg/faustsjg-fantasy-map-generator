import { select } from "d3";
import { closeDialogs, updateDialog } from "@/components/dialog/dialog-helpers";
import { applyLineHighlighting } from "@/components/dialog/highlighting";
import { bindColumnSorting, sortDataByColumns } from "@/components/dialog/sorting";
import { dialogState } from "@/components/dialog/state";
import {
  type EditorColumn,
  initColumnVisibility,
  initEditorTable,
  renderEditorHeader,
  renderEditorPagination,
  type TableView
} from "@/components/dialog/table";
import { Layers } from "@/components/layers";
import { Controllers } from "@/controllers";
import { ensureEl } from "@/utils";

type LockKind = "state" | "province" | "burg";

// a synthetic row uniting three otherwise-separate collections (pack.states/provinces/burgs) - no
// existing overview mixes entity types, so this is its own shape rather than reusing EditorColumn<T>
// for one T. `id` alone isn't unique across kinds (state 3 and burg 3 both exist) - callers that need
// a DOM-unique key use `kind`+`id` together (see rowKey() below)
type LockedRow = {
  kind: LockKind;
  id: number;
  name: string;
  parent: string; // owning state's name; "-" for a state row itself
  x: number;
  y: number; // zoom target
};

const dialogId = "locksOverview" as const;
const position = { my: "right top", at: "right-10 top+10", of: "svg", collision: "fit" };
let filterState: { search: string };

const columns: EditorColumn<LockedRow>[] = [
  { key: "locate", width: "0.8em", permanent: true },
  { key: "name", label: "Name", width: "10em", permanent: true, sortBy: r => r.name, sortType: "alpha" },
  { key: "kind", label: "Type", width: "6em", sortBy: r => r.kind, sortType: "alpha" },
  { key: "parent", label: "State", width: "8em", sortBy: r => r.parent, sortType: "alpha" },
  { key: "actions", width: "4.4em", permanent: true, align: "right" }
];

const locksTable = initEditorTable<LockedRow>({
  getData: () => sortDataByColumns(dialogId, getFilteredRows(), columns),
  onUpdate: renderLocksPage
});

function rowKey(row: Pick<LockedRow, "kind" | "id">): string {
  return `${row.kind}-${row.id}`;
}

function open(): void {
  if (customization) return;
  filterState = dialogState.get(dialogId, "filters", () => ({ search: "" }));
  closeDialogs(`#${dialogId}, .stable`);
  Layers.show("states", "provinces", "borders", "burgIcons", "labels");

  renderDialog();
  locksTable.reset();

  $(`#${dialogId}`).dialog({
    title: "Locked Things",
    resizable: false,
    close: closeLocksOverview,
    width: "fit-content",
    position
  });
}

function renderDialog(): void {
  document.getElementById(dialogId)?.remove();
  const HTML = /* html */ `<div id="${dialogId}" class="dialog stable editorDialog">
      <div id="locksBody" class="table">${renderEditorHeader({ dialogId, columns })}</div>
      <div id="locksFilters" data-tip="Apply a filter" class="editorFilters">
        <label for="locksSearch" data-tip="Filter by name, type, or state"
          >Search: <input id="locksSearch" type="search"
        /></label>
      </div>
      <div id="locksFooter" class="totalLine">
        <div data-tip="Locked things displayed" style="margin-left: 5px">
          Locked:&nbsp;<span id="locksFooterCount">0</span>
        </div>
      </div>
      <div id="locksBottom" class="editorToolbar">
        <button id="locksOverviewRefresh" data-tip="Refresh the Editor" class="icon-cw"></button>
      </div>
    </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", HTML);
  ensureEl<HTMLInputElement>("locksSearch").value = filterState.search;
  bindColumnSorting(dialogId, locksTable.reset);
  applyLineHighlighting(dialogId, ({ target, cellId }) => {
    // state/province/burg ids all overlap (state 3 and burg 3 both exist), so a plain cell-owner id
    // can't be handed straight to applyLineHighlighting - only wire up the unambiguous burg case
    // (hovering the map itself) here; row-hover highlighting (below) covers the rest via rowKey()
    const burgId = pack.cells.burg[cellId];
    if (burgId) return burgId;
    const burg = target.closest<SVGElement>("#labels [data-label-type='burg'][data-id], #burgIcons [data-id]");
    return burg ? Number(burg.dataset.id) : undefined;
  });

  initColumnVisibility({
    dialogId,
    columns,
    onUpdate: () => updateDialog(dialogId, { width: "fit-content", position })
  });

  ensureEl("locksOverviewRefresh").addEventListener("click", refreshLocksEditor);
  ensureEl("locksSearch").addEventListener("input", onFilterChange);
}

function closeLocksOverview(): void {
  $(`#${dialogId}`).dialog("destroy");
  ensureEl(dialogId).remove();
}

function refreshLocksEditor(): void {
  locksTable.reset();
}

function onFilterChange(): void {
  filterState.search = ensureEl<HTMLInputElement>("locksSearch").value;
  dialogState.set(dialogId, "filters", filterState);
  locksTable.reset();
}

function getFilteredRows(): LockedRow[] {
  const rows = getLockedRows();
  const searchText = filterState.search.toLowerCase().trim();
  if (!searchText) return rows;

  return rows.filter(
    r =>
      r.name.toLowerCase().includes(searchText) ||
      r.kind.includes(searchText) ||
      r.parent.toLowerCase().includes(searchText)
  );
}

function getLockedRows(): LockedRow[] {
  const states: LockedRow[] = pack.states
    .filter(s => s.i && !s.removed && s.lock)
    .map(s => {
      const capital = pack.burgs[s.capital];
      return { kind: "state", id: s.i, name: s.fullName ?? s.name, parent: "-", x: capital.x, y: capital.y };
    });

  const provinces: LockedRow[] = (pack.provinces ?? [])
    .filter(p => p?.i && !p.removed && p.lock)
    .map(p => {
      // wild-land provinces have no seat burg (burg 0) - zoom to their center cell instead
      const [x, y] = p.burg ? [pack.burgs[p.burg].x, pack.burgs[p.burg].y] : pack.cells.p[p.center];
      return {
        kind: "province",
        id: p.i,
        name: p.fullName ?? p.name,
        parent: pack.states[p.state]?.name ?? "",
        x,
        y
      };
    });

  const burgs: LockedRow[] = pack.burgs
    .filter(b => b.i && !b.removed && b.lock)
    .map(b => ({
      kind: "burg",
      id: b.i,
      name: b.name ?? "",
      parent: pack.states[b.state!]?.name ?? "",
      x: b.x,
      y: b.y
    }));

  return [...states, ...provinces, ...burgs];
}

function renderLocksPage(view: TableView<LockedRow>): void {
  const body = ensureEl("locksBody");
  body.querySelectorAll(":scope > .states").forEach(row => {
    row.remove();
  });

  let lines = "";
  for (const r of view.rows) {
    lines += /* html */ `<div
        class="states"
        data-key="${rowKey(r)}"
        data-kind="${r.kind}"
        data-id=${r.id}
        data-name="${r.name}"
        data-parent="${r.parent}"
      >
        <span data-tip="Click to zoom into view" class="icon-dot-circled pointer" data-col="locate"></span>
        <input data-tip="Name" value="${r.name}" data-col="name" disabled />
        <input data-tip="Type" value="${capitalize(r.kind)}" data-col="kind" disabled />
        <input data-tip="Owning state" value="${r.parent}" data-col="parent" disabled />
        <div data-col="actions">
          <span data-tip="Open editor" class="icon-pencil"></span>
          <span data-tip="Unlock" class="locks pointer icon-lock"></span>
        </div>
      </div>`;
  }
  body.insertAdjacentHTML("beforeend", lines);

  ensureEl("locksFooterCount").innerHTML = String(view.total);
  renderEditorPagination(ensureEl("locksFooter"), view, locksTable.goto);

  body.querySelectorAll("div.states").forEach(el => void el.addEventListener("mouseenter", ev => rowHighlightOn(ev)));
  body.querySelectorAll("div.states").forEach(el => void el.addEventListener("mouseleave", () => rowHighlightOff()));
  body.querySelectorAll("div > span.icon-dot-circled").forEach(el => void el.addEventListener("click", zoomIntoRow));
  body.querySelectorAll("div > span.locks").forEach(el => void el.addEventListener("click", toggleRowLock));
  body.querySelectorAll("div > span.icon-pencil").forEach(el => void el.addEventListener("click", openRowEditor));
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function rowFromEvent(target: HTMLElement): { kind: LockKind; id: number } {
  const row = target.closest(".states") as HTMLElement;
  return { kind: row.dataset.kind as LockKind, id: +row.dataset.id! };
}

function rowHighlightOn(event: Event): void {
  const { kind, id } = rowFromEvent(event.currentTarget as HTMLElement);
  if (kind !== "burg") return; // only burg labels exist on the map to cross-highlight against
  const label = select("#labels").select(`[data-label-type='burg'][data-id='${id}']`);
  if (label.size()) label.classed("drag", true);
}

function rowHighlightOff(): void {
  select("#labels").selectAll("text[data-label-type='burg'].drag").classed("drag", false);
}

function zoomIntoRow(this: HTMLElement): void {
  const { kind, id } = rowFromEvent(this);
  const rows = getLockedRows();
  const row = rows.find(r => r.kind === kind && r.id === id);
  if (row) zoomTo(row.x, row.y, 8, 2000);
}

function toggleRowLock(this: HTMLElement): void {
  const { kind, id } = rowFromEvent(this);

  if (kind === "state") {
    const s = pack.states[id];
    s.lock = !s.lock;
    s.userLocked = s.lock;
  } else if (kind === "province") {
    pack.provinces[id].lock = !pack.provinces[id].lock;
  } else {
    pack.burgs[id].lock = !pack.burgs[id].lock;
  }

  locksTable.refresh();
}

function openRowEditor(this: HTMLElement): void {
  const { kind, id } = rowFromEvent(this);

  if (kind === "state") void Controllers.StatesEditor.open();
  else if (kind === "province") void Controllers.ProvincesEditor.open();
  else void Controllers.BurgEditor.open(id);
}

export const LocksOverview = { open };
