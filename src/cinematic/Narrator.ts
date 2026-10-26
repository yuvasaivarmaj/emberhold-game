// Spoken narration (the browser's speech synthesis, as a stand-in until a real voice is
// recorded) with subtitles. Each line reports when it's finished so the film can wait for it.

export class Narrator {
  private voice: SpeechSynthesisVoice | null = null;
  private sub: HTMLElement;
  enabled = true;
  volume = 1;
  speaking = false;
  private hideTimer = 0;

  constructor() {
    this.sub = document.getElementById('subtitle')!;
    const pick = () => {
      const voices = window.speechSynthesis?.getVoices?.() ?? [];
      const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
      const prefer = ['Daniel', 'Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Arthur', 'Male'];
      this.voice = en.find((v) => prefer.some((p) => v.name.includes(p))) ?? en.find((v) => /GB|UK/.test(v.lang)) ?? en[0] ?? null;
    };
    pick();
    window.speechSynthesis?.addEventListener?.('voiceschanged', pick);
  }

  /** Estimated reading time, used when speech isn't available. */
  static duration(text: string) { return text.split(/\s+/).length / 2.35 + 1.4; }

  say(text: string): Promise<void> {
    clearTimeout(this.hideTimer);
    this.sub.textContent = text;
    this.sub.classList.add('show');
    this.speaking = true;
    const minTime = Narrator.duration(text) * 1000;
    const started = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const wait = Math.max(0, minTime * 0.85 - (performance.now() - started));
        setTimeout(() => {
          this.speaking = false;
          this.hideTimer = window.setTimeout(() => this.sub.classList.remove('show'), 400);
          resolve();
        }, wait);
      };
      const synth = window.speechSynthesis;
      if (this.enabled && synth && typeof SpeechSynthesisUtterance !== 'undefined') {
        try {
          const u = new SpeechSynthesisUtterance(text);
          if (this.voice) u.voice = this.voice;
          u.rate = 0.86;
          u.pitch = 0.78;
          u.volume = this.volume;
          u.onend = finish;
          u.onerror = finish;
          synth.speak(u);
          // Some browsers never fire onend; fall back to reading time.
          setTimeout(finish, minTime * 1.8 + 1500);
          return;
        } catch { /* fall through */ }
      }
      setTimeout(finish, minTime);
    });
  }

  stop() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    this.sub.classList.remove('show');
    this.speaking = false;
  }
}
