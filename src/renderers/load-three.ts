// Lazy-loads the three.min.js UMD build (sets the ambient global THREE).
// Its own module so both view-3d-renderer.ts and draw-satellite-image.ts can
// depend on it without a cycle (view-3d-renderer.ts imports from
// components/layers.ts, which draw-satellite-image.ts is registered into).
let threeLoadPromise: Promise<boolean> | null = null;

export function loadTHREE(): Promise<boolean> {
  if (typeof THREE !== "undefined" && THREE) return Promise.resolve(true);
  if (!threeLoadPromise) {
    threeLoadPromise = new Promise(resolve => {
      const script = document.createElement("script");
      script.src = "libs/three.min.js";
      document.head.append(script);
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
    });
  }

  return threeLoadPromise;
}
