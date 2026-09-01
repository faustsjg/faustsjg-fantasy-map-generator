import { fileURLToPath, URL } from "node:url";

/**
 * The desktop app ships the same renderer, minus the parts that only make sense on the web:
 * Google Analytics (a program that phones home on launch is a different bargain than a web page),
 * and the PWA plumbing, which `public/main.js` already skips under Electron
 */
const stripWebOnlyTags = {
  name: "strip-web-only-tags",
  transformIndexHtml: (html: string) =>
    html
      .replace(/<script async src="https:\/\/www\.googletagmanager\.com[^>]*><\/script>\s*/, "")
      .replace(/<script>\s*window\.dataLayer[\s\S]*?<\/script>\s*/, "")
      .replace(/<link rel="manifest"[^>]*>\s*/, "")
};

// GITHUB_REPOSITORY (e.g. "faustsjg/azgaar-cronoatles") is set by GitHub Actions
// on every run — deriving the base path from it means a repo rename doesn't
// silently break every asset URL in the next deploy.
const githubRepoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default ({ mode }: { mode: string }) => ({
  root: "./src",
  base:
    mode === "electron"
      ? "./"
      : process.env.NETLIFY
        ? "/"
        : process.env.GITHUB_PAGES
          ? `/${githubRepoName ?? "Fantasy-Map-Generator"}/`
          : "/Fantasy-Map-Generator/",
  plugins: mode === "electron" ? [stripWebOnlyTags] : [],
  build: {
    outDir: mode === "electron" ? "../dist-electron/renderer" : "../dist",
    assetsDir: "./",
    emptyOutDir: mode === "electron"
  },
  publicDir: "../public",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
