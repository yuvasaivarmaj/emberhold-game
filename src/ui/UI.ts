// Menus, loading screen, HUD and the settings panel.
import type { UserSettings } from '../core/Settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private settingsReturn: 'start' | 'pause' = 'start';
  onEnter: (() => void) | null = null;
  onResume: (() => void) | null = null;
  onSettingsChange: ((s: UserSettings, qualityChanged: boolean) => void) | null = null;
  onHourChange: ((h: number) => void) | null = null;
  getHour: (() => number) | null = null;

  constructor(private settings: UserSettings) {
    $('enter').addEventListener('click', () => this.onEnter?.());
    $('resume').addEventListener('click', () => this.onResume?.());
    document.querySelectorAll('[data-open-settings]').forEach((b) =>
      b.addEventListener('click', () => this.openSettings($('pause').hidden ? 'start' : 'pause')));
    $('settings-close').addEventListener('click', () => this.closeSettings());
    this.bindSettings();
  }

  progress(p: number, text: string) {
    $('bar-fill').style.width = `${Math.round(p * 100)}%`;
    $('load-status').textContent = text;
  }

  showStart(info: string) {
    $('loading').hidden = true;
    $('start').hidden = false;
    $('renderer-info').textContent = info;
  }

  playing() {
    $('start').hidden = true;
    $('pause').hidden = true;
    $('settings').hidden = true;
    $('hud').hidden = false;
  }

  paused() {
    if (!$('settings').hidden) return;
    $('pause').hidden = false;
  }

  error(msg: string) {
    $('loading').hidden = true;
    $('start').hidden = true;
    $('error').hidden = false;
    $('error-text').textContent = msg;
  }

  toast(big: string, small: string, ms = 5200) {
    const t = $('toast');
    t.innerHTML = '';
    const b = document.createElement('div'); b.className = 'big'; b.textContent = big;
    const s = document.createElement('div'); s.className = 'small'; s.textContent = small;
    t.append(b, s);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => t.classList.remove('show'), ms);
  }

  hideHint() { $('hint').style.opacity = '0'; }

  clock(hour: number) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    const part = hour < 5 ? 'Night' : hour < 7.5 ? 'Dawn' : hour < 11.5 ? 'Morning' : hour < 14 ? 'Midday'
      : hour < 17.5 ? 'Afternoon' : hour < 20 ? 'Dusk' : 'Night';
    $('clock').textContent = `${part} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  fps(text: string | null) {
    const f = $('fps');
    f.hidden = text === null;
    if (text !== null) f.textContent = text;
  }

  private openSettings(from: 'start' | 'pause') {
    this.settingsReturn = from;
    $('start').hidden = true;
    $('pause').hidden = true;
    $('settings').hidden = false;
    if (this.getHour) {
      ($('s-hour') as HTMLInputElement).value = String(this.getHour());
      this.refreshOutputs();
    }
  }

  private closeSettings() {
    $('settings').hidden = true;
    if (this.settingsReturn === 'start') $('start').hidden = false;
    else $('pause').hidden = false;
  }

  private bindSettings() {
    const s = this.settings;
    const q = $<HTMLSelectElement>('s-quality');
    const fov = $<HTMLInputElement>('s-fov');
    const sens = $<HTMLInputElement>('s-sens');
    const vol = $<HTMLInputElement>('s-vol');
    const hour = $<HTMLInputElement>('s-hour');
    const ts = $<HTMLSelectElement>('s-ts');
    const inv = $<HTMLInputElement>('s-invert');
    const bob = $<HTMLInputElement>('s-bob');
    const fps = $<HTMLInputElement>('s-fps');
    const hands = $<HTMLInputElement>('s-hands');
    const adaptive = $<HTMLInputElement>('s-adaptive');
    q.value = s.quality; fov.value = String(s.fov); sens.value = String(s.sensitivity);
    vol.value = String(s.volume); ts.value = String(s.timeScale); inv.checked = s.invertY;
    bob.checked = s.headBob; fps.checked = s.showFps; hands.checked = s.showHands; adaptive.checked = s.adaptiveResolution;
    this.refreshOutputs();
    const changed = (quality = false) => { this.refreshOutputs(); this.onSettingsChange?.(s, quality); };
    q.addEventListener('change', () => { s.quality = q.value as any; changed(true); });
    fov.addEventListener('input', () => { s.fov = +fov.value; changed(); });
    sens.addEventListener('input', () => { s.sensitivity = +sens.value; changed(); });
    vol.addEventListener('input', () => { s.volume = +vol.value; changed(); });
    ts.addEventListener('change', () => { s.timeScale = +ts.value; changed(); });
    inv.addEventListener('change', () => { s.invertY = inv.checked; changed(); });
    bob.addEventListener('change', () => { s.headBob = bob.checked; changed(); });
    fps.addEventListener('change', () => { s.showFps = fps.checked; changed(); });
    hands.addEventListener('change', () => { s.showHands = hands.checked; changed(); });
    adaptive.addEventListener('change', () => { s.adaptiveResolution = adaptive.checked; changed(); });
    hour.addEventListener('input', () => { this.onHourChange?.(+hour.value); this.refreshOutputs(); });
  }

  private refreshOutputs() {
    const s = this.settings;
    $('o-fov').textContent = `${s.fov}°`;
    $('o-sens').textContent = s.sensitivity.toFixed(2);
    $('o-vol').textContent = `${Math.round(s.volume * 100)}%`;
    const h = +($('s-hour') as HTMLInputElement).value;
    const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
    $('o-hour').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}
