// Flat 2D "Satellite" layer: reuses the 3D view's erosion bake + satellite
// texture shader (draw-satellite-texture.ts) to synthesize a photorealistic
// top-down image, without ever creating a 3D scene, camera, or mesh - the
// shader is a fullscreen-triangle pass, purely a function of grid/pack data,
// so it's already a flat top-down bake. Generated once per map (cached by
// mapId), then displayed as a plain <image>.
import * as ErosionBake from "./erosion-bake";
import { disposeSatelliteTexture, generateSatelliteTexture, getLastSatelliteRenderTarget } from "./draw-satellite-texture";
import { loadTHREE } from "./load-three";
import { createEl, ensureEl } from "../utils/nodeUtils";
import { tip } from "../components/tooltips";

const BAKE_PARAMS: ErosionBake.BakeParams = { strength: 30, riverDepth: 10, octaves: 2, bakeResolution: 1024 };
const HEIGHT_SCALE = 50; // matches the 3D view's default "Height scale"
const MAX_OUTPUT = 2048;

let cachedDataUrl: string | null = null;
let cachedMapId: number | null = null;
let bakingPromise: Promise<void> | null = null;

async function bakeSatelliteImage(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const loaded = await loadTHREE();
  if (!loaded) return null;

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });

  try {
    const bakeResult = await ErosionBake.bake(renderer, BAKE_PARAMS);
    if (!bakeResult) return null;

    const texture = generateSatelliteTexture(renderer, bakeResult, { scale: HEIGHT_SCALE, maxOutput: MAX_OUTPUT });
    if (!texture) return null;

    const target = getLastSatelliteRenderTarget();
    if (!target) return null;

    const { width, height } = target;
    const buffer = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);

    // WebGL render targets read back bottom-up; flip rows for a normal top-down image.
    // The shader's alpha channel isn't image transparency - it packs "land
    // coverage" for the 3D scene's water-animation material (near 0 over open
    // ocean, so its separate animated water plane shows through). This is a
    // flat standalone image with no water plane underneath, so force full
    // opacity and just keep the RGB.
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d")!;
    const imageData = ctx.createImageData(width, height);
    const rowBytes = width * 4;
    for (let y = 0; y < height; y++) {
      const srcStart = (height - 1 - y) * rowBytes;
      const row = buffer.subarray(srcStart, srcStart + rowBytes);
      const destStart = y * rowBytes;
      for (let x = 0; x < rowBytes; x += 4) {
        imageData.data[destStart + x] = row[x];
        imageData.data[destStart + x + 1] = row[x + 1];
        imageData.data[destStart + x + 2] = row[x + 2];
        imageData.data[destStart + x + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    return { dataUrl: out.toDataURL("image/png"), width, height };
  } catch (error) {
    ERROR && console.error("Satellite image bake failed:", error);
    return null;
  } finally {
    disposeSatelliteTexture();
    renderer.dispose();
  }
}

function renderImage(dataUrl: string): void {
  const container = ensureEl<SVGGElement>("satelliteImage");
  container.innerHTML = "";
  const image = createEl<SVGImageElement>("image", "satelliteImageContent", {
    x: "0",
    y: "0",
    width: String(graphWidth),
    height: String(graphHeight),
    preserveAspectRatio: "none",
    href: dataUrl
  });
  container.append(image);
}

export function drawSatelliteImage(): void {
  if (cachedMapId === mapId && cachedDataUrl) {
    renderImage(cachedDataUrl);
    return;
  }

  if (bakingPromise) return; // already in flight, the pending render will pick it up

  tip("Baking satellite image...", false, "warn", 8000);
  bakingPromise = bakeSatelliteImage()
    .then(result => {
      if (!result) {
        tip("Satellite image generation failed", false, "error", 4000);
        return;
      }
      cachedDataUrl = result.dataUrl;
      cachedMapId = mapId;
      renderImage(result.dataUrl);
    })
    .finally(() => {
      bakingPromise = null;
    });
}
