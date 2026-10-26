// Story progress and player position, kept in the browser so Continue picks up where you left off.

export interface SaveData {
  v: 1;
  chapter: string;        // story chapter id
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  hour: number;
  flags: Record<string, boolean | number | string>;
  savedAt: number;        // ms since epoch
  playSeconds: number;
}

const KEY = 'emberhold.save.v1';

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 ? d : null;
  } catch { return null; }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function timeAgo(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
