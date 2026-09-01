// The "About" dialog: what the generator is, where to get help and how to support it.
// A component, not a controller — it is opened over the map but knows nothing about it

import { ensureEl, link } from "@/utils";

const COMMUNITY = {
  discord: link("https://discordapp.com/invite/X7E84HU", "Discord"),
  reddit: link("https://www.reddit.com/r/FantasyMapGenerator", "Reddit"),
  patreon: link("https://www.patreon.com/azgaar", "Patreon")
};

const PROJECTS = {
  armoria: link("https://azgaar.github.io/Armoria", "Armoria"),
  deorum: link("https://deorum.vercel.app", "Deorum")
};

const WIKI = "https://github.com/Azgaar/Fantasy-Map-Generator/wiki";
const GUIDES = {
  quickStart: link(`${WIKI}/Quick-Start-Tutorial`, "Quick start tutorial"),
  qaa: link(`${WIKI}/Q&A`, "Q&A page"),
  video: link("https://youtube.com/playlist?list=PLtgiuDC8iVR2gIG8zMTRn7T_L0arl9h1C", "Video tutorial")
};

const LINKS = [
  link(`https://github.com/${__RELEASES_REPO__}`, "This fork's GitHub repository"),
  link(`https://github.com/${__RELEASES_REPO__}/issues`, "Report a bug / request a feature"),
  link("https://github.com/Azgaar/Fantasy-Map-Generator", "Upstream: Azgaar's Fantasy Map Generator"),
  link("https://github.com/Azgaar/Fantasy-Map-Generator/blob/master/LICENSE", "License"),
  link(`${WIKI}/Changelog`, "Upstream changelog"),
  link(`${WIKI}/Hotkeys`, "Hotkeys"),
  link("https://trello.com/b/7x832DG4/fantasy-map-generator", "Upstream devboard")
];

function render(): string {
  return /* html */ `<b>Faustsjg Fantasy Map Generator</b> is a free, open-source fork of Azgaar's <i>Fantasy Map Generator</i> (FMG), adding a temporal
    dimension — the same map viewed across eras, with civilizations that rise, expand, and fall — plus optional
    AI-assisted terrain and lore. It means that you own all created maps and can use them as you wish.

    <p>
      The base generator's development is community-backed, you can donate to Azgaar on ${COMMUNITY.patreon}. You can also help creating overviews, tutorials and spreding the word about the
      Generator.
    </p>

    <p>
      For questions about the base generator, Azgaar's community on ${COMMUNITY.discord} and ${COMMUNITY.reddit} is the best place to ask. Before asking questions, please check out the
      ${GUIDES.quickStart}, the ${GUIDES.qaa}, and ${GUIDES.video}.
    </p>

    <ul style="columns:2">${LINKS.map(item => `<li>${item}</li>`).join("")}</ul>

    <p>Azgaar's other projects:
      <ul>
        <li>${PROJECTS.armoria}: a tool for creating heraldic coats of arms</li>
        <li>${PROJECTS.deorum}: a vast gallery of customizable fantasy characters</li>
      </ul>
    </p>

    <p>Chinese localization: <a href="https://www.8desk.top" target="_blank">8desk.top</a></p>`;
}

/** Show info about the generator in a popup */
export function showInfo(): void {
  ensureEl("alertMessage").innerHTML = render();

  $("#alert").dialog({
    resizable: false,
    title: document.title,
    width: "28em",
    buttons: {
      OK: function (this: HTMLElement) {
        $(this).dialog("close");
      }
    },
    position: { my: "center", at: "center", of: "svg" }
  });
}

export const AppInfo = { open: showInfo };

window.showInfo = showInfo;
