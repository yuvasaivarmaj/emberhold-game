// The conversation panel: who you're talking to, what they say, and what you can answer
// (1-4 to choose, E or Space to go on, Esc or walking away to leave).
import type { Talk, Node } from '../story/Dialogue';

const $ = (id: string) => document.getElementById(id)!;

export class TalkUI {
  private el = $('talk');
  private talk: Talk | null = null;
  private node: Node | null = null;
  open = false;
  /** Story flags set by what was said. */
  onSet: ((flag: string) => void) | null = null;
  onClose: (() => void) | null = null;

  start(name: string, who: string, talk: Talk) {
    this.talk = talk;
    this.open = true;
    this.el.hidden = false;
    (this.el.querySelector('.talk-name') as HTMLElement).textContent = name;
    (this.el.querySelector('.talk-who') as HTMLElement).textContent = who;
    this.show('start');
  }

  private show(id: string) {
    const n = this.talk?.[id];
    if (!n) { this.close(); return; }
    this.node = n;
    for (const f of n.set ?? []) this.onSet?.(f);
    (this.el.querySelector('.talk-text') as HTMLElement).textContent = n.text;
    const box = this.el.querySelector('.talk-choices') as HTMLElement;
    box.innerHTML = '';
    const choices = n.choices ?? [];
    choices.forEach((c, i) => {
      const d = document.createElement('div');
      d.innerHTML = `<kbd>${i + 1}</kbd>`;
      d.append(c.label);
      d.onclick = () => this.choose(i);
      box.append(d);
    });
    if (!choices.length) {
      const d = document.createElement('div');
      d.className = 'end';
      d.innerHTML = '<kbd>E</kbd> Leave';
      d.onclick = () => this.close();
      box.append(d);
    }
  }

  choose(i: number) {
    const c = this.node?.choices?.[i];
    if (!c) return;
    for (const f of c.set ?? []) this.onSet?.(f);
    if (c.next) this.show(c.next);
    else this.close();
  }

  /** E or Space: take the only answer, or leave if there are none. */
  advance() {
    const ch = this.node?.choices ?? [];
    if (ch.length === 1) this.choose(0);
    else if (!ch.length) this.close();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.talk = null; this.node = null;
    this.onClose?.();
  }
}
