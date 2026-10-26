// Player-adjustable settings and graphics quality presets.

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface GrassLayerSpec { radius: number; spacing: number; width: number; height: number; segments: number }

export interface QualityPreset {
  pixelRatio: number;      // max device pixel ratio
  renderScale: number;     // internal resolution multiplier
  shadows: boolean;
  shadowMapSize: number;
  cascades: number;
  shadowFar: number;
  envSize: number;
  grassNear: GrassLayerSpec;
  grassFar: GrassLayerSpec | null;
  treeDensity: number;
  treeFullDistance: number;
  treeMidDistance: number;
  viewScale: number;       // terrain LOD distance multiplier
  bloom: boolean;
  msaa: number;
  fxaa: boolean;
}

export const PRESETS: Record<QualityLevel | 'test', QualityPreset> = {
  // Minimal settings used by automated screenshot tests on software renderers.
  test: {
    pixelRatio: 1, renderScale: 0.5, shadows: true, shadowMapSize: 1024, cascades: 2, shadowFar: 200,
    envSize: 32,
    grassNear: { radius: 10, spacing: 0.3, width: 0.12, height: 1.0, segments: 2 },
    grassFar: null,
    treeDensity: 0.12, treeFullDistance: 40, treeMidDistance: 90, viewScale: 0.5, bloom: false, msaa: 0, fxaa: false,
  },
  low: {
    pixelRatio: 1, renderScale: 0.75, shadows: true, shadowMapSize: 1024, cascades: 2, shadowFar: 220,
    envSize: 64,
    grassNear: { radius: 18, spacing: 0.17, width: 0.07, height: 1.0, segments: 3 },
    grassFar: { radius: 42, spacing: 0.5, width: 0.15, height: 1.0, segments: 2 },
    treeDensity: 0.45, treeFullDistance: 45, treeMidDistance: 140, viewScale: 0.7, bloom: false, msaa: 0, fxaa: true,
  },
  medium: {
    pixelRatio: 1, renderScale: 1, shadows: true, shadowMapSize: 2048, cascades: 3, shadowFar: 350,
    envSize: 128,
    grassNear: { radius: 24, spacing: 0.15, width: 0.07, height: 1.0, segments: 3 },
    grassFar: { radius: 60, spacing: 0.5, width: 0.16, height: 1.05, segments: 2 },
    treeDensity: 0.75, treeFullDistance: 70, treeMidDistance: 230, viewScale: 1, bloom: true, msaa: 0, fxaa: true,
  },
  high: {
    pixelRatio: 1.5, renderScale: 1, shadows: true, shadowMapSize: 2048, cascades: 4, shadowFar: 500,
    envSize: 128,
    grassNear: { radius: 30, spacing: 0.115, width: 0.06, height: 1.0, segments: 3 },
    grassFar: { radius: 80, spacing: 0.42, width: 0.15, height: 1.05, segments: 2 },
    treeDensity: 1, treeFullDistance: 110, treeMidDistance: 330, viewScale: 1.3, bloom: true, msaa: 4, fxaa: false,
  },
  ultra: {
    pixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 4096, cascades: 4, shadowFar: 700,
    envSize: 256,
    grassNear: { radius: 36, spacing: 0.095, width: 0.055, height: 1.0, segments: 4 },
    grassFar: { radius: 100, spacing: 0.36, width: 0.14, height: 1.05, segments: 2 },
    treeDensity: 1.25, treeFullDistance: 160, treeMidDistance: 460, viewScale: 1.7, bloom: true, msaa: 4, fxaa: false,
  },
};

export interface UserSettings {
  quality: QualityLevel;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  volume: number;
  headBob: boolean;
  showFps: boolean;
  timeScale: number;
}

const KEY = 'emberhold.settings.v1';

export function guessQuality(): QualityLevel {
  const mem = (navigator as any).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || mem <= 4 || cores <= 4) return 'low';
  if (mem >= 16 && cores >= 12) return 'high';
  return 'medium';
}

export function loadSettings(): UserSettings {
  const defaults: UserSettings = {
    quality: guessQuality(), fov: 72, sensitivity: 1, invertY: false, volume: 0.8,
    headBob: true, showFps: false, timeScale: 1,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return defaults;
}

export function saveSettings(s: UserSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
