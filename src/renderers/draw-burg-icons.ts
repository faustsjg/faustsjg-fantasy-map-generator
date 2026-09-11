import { select } from "d3";
import { Layers } from "@/components/layers";
import type { Burg } from "@/generators/burgs-generator";
import { Scene, ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";

interface BurgSceneItem {
  id: string;
  data: Burg;
}

const scene = new Scene<BurgSceneItem>();
const layer = ViewportLayers.register({ id: "burgIcons", render: reconcileBurgIcons });

export const drawBurgIcons = (): void => {
  TIME && console.time("drawBurgIcons");
  createIconGroups();
  scene.replace(pack.burgs.filter(b => !b.removed).map(b => ({ id: String(b.i), data: b })));
  layer.render();
  TIME && console.timeEnd("drawBurgIcons");
};

/** drop the icons, keeping the burg groups: they carry the styles edited in the Style editor */
export const removeBurgIcons = (): void => {
  scene.invalidate();
  for (const icon of Array.from(document.querySelectorAll("#icons use, #icons circle"))) icon.remove();
};

export const removeBurgIcon = (burgId: number): void => {
  scene.remove(String(burgId));
  const existingIcon = document.getElementById(`burg${burgId}`);
  if (existingIcon) existingIcon.remove();

  const existingAnchor = document.getElementById(`anchor${burgId}`);
  if (existingAnchor) existingAnchor.remove();
};

function createIconGroups(): void {
  // save existing styles and remove all groups
  document.querySelectorAll("g#burgIcons > g").forEach(group => {
    style.burgIcons[group.id] = Array.from(group.attributes).reduce((acc: { [key: string]: string }, attribute) => {
      acc[attribute.name] = attribute.value;
      return acc;
    }, {});
    group.remove();
  });

  document.querySelectorAll("g#anchors > g").forEach(group => {
    style.anchors[group.id] = Array.from(group.attributes).reduce((acc: { [key: string]: string }, attribute) => {
      acc[attribute.name] = attribute.value;
      return acc;
    }, {});
    group.remove();
  });

  // create groups for each burg group and apply stored or default style
  const defaultIconStyle = style.burgIcons.town || Object.values(style.burgIcons)[0] || {};
  const defaultAnchorStyle = style.anchors.town || Object.values(style.anchors)[0] || {};
  const sortedGroups = [...options.burgs.groups].sort((a, b) => a.order - b.order);
  for (const { name } of sortedGroups) {
    const burgGroup = select("#burgIcons").append("g");
    const iconStyles = style.burgIcons[name] || defaultIconStyle;
    Object.entries(iconStyles).forEach(([key, value]) => {
      burgGroup.attr(key, value);
    });
    burgGroup.attr("id", name);

    const anchorGroup = select("#anchors").append("g");
    const anchorStyles = style.anchors[name] || defaultAnchorStyle;
    Object.entries(anchorStyles).forEach(([key, value]) => {
      anchorGroup.attr(key, value);
    });
    anchorGroup.attr("id", name);
  }
}

/**
 * Materialize only the burg icons the viewport can show: an id-diff against what's already
 * there, never a full rebuild. A reconcile fires on every pan/zoom frame, and replacing the node
 * under the pointer between mousedown and mouseup makes the browser swallow the click - the same
 * reasoning the labels and emblems layers already follow.
 */
function reconcileBurgIcons(context: ViewportRenderContext): void {
  if (!scene.valid || !Layers.isOn("burgIcons")) return;
  const { root, bounds } = context;

  for (const { name } of options.burgs.groups) {
    const iconsGroup = root.querySelector<SVGGElement>(`#burgIcons > g#${CSS.escape(name)}`);
    if (!iconsGroup) continue;

    const visible = [...scene.values()].map(item => item.data).filter(b => b.group === name && isVisible(b, bounds));

    const icon = iconsGroup.dataset.icon || "#icon-circle";
    reconcileGroup(iconsGroup, "burg", visible, icon);

    const portGroup = root.querySelector<SVGGElement>(`#anchors > g#${CSS.escape(name)}`);
    if (!portGroup) continue;
    reconcileGroup(
      portGroup,
      "anchor",
      visible.filter(b => b.port),
      "#icon-anchor"
    );
  }
}

function reconcileGroup(group: SVGGElement, prefix: "burg" | "anchor", burgs: Burg[], href: string): void {
  const visibleIds = new Set(burgs.map(b => `${prefix}${b.i}`));
  for (const use of group.querySelectorAll(":scope > use")) {
    if (!visibleIds.has(use.id)) use.remove();
  }

  const missing = burgs.filter(b => !group.querySelector(`:scope > #${prefix}${b.i}`));
  if (missing.length) {
    group.insertAdjacentHTML(
      "beforeend",
      missing
        .map(b => `<use id="${prefix}${b.i}" data-id="${b.i}" href="${href}" x="${b.x}" y="${b.y}"></use>`)
        .join("")
    );
  }
}

function isVisible(b: Burg, bounds: ViewportRenderContext["bounds"]): boolean {
  return b.x >= bounds.x0 && b.x <= bounds.x1 && b.y >= bounds.y0 && b.y <= bounds.y1;
}
