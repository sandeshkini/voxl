// Touch extras: a trackpad mode (one finger moves a visible pointer relatively, like a
// laptop trackpad) and latched modifier keys (tap one, then type or click: it is
// released after that key or click). Both need a touch screen and an input-capable viewer.
import { cmd } from '../protocol';
import type { App } from './app';
import { el } from './app';

type ModifierKeysym = (code: string) => number | undefined;

const MODS: Record<string, string> = {
	cmd: 'MetaLeft',
	opt: 'AltLeft',
	ctrl: 'ControlLeft',
	shift: 'ShiftLeft',
};
const ALT_L = 0xffe9,
	SHIFT_L = 0xffe1;

export function createTouchTools(app: App, modifierKeysym: ModifierKeysym) {
	const modeBtn = el<HTMLButtonElement>('pad-btn');
	const cursor = el('pad-cursor');
	const latched = new Map<string, number>();
	const pad = {
		on: false,
		/** Show the trackpad pointer at a fraction of the desktop. */
		show(fx: number, fy: number) {
			cursor.style.left = `${fx * 100}%`;
			cursor.style.top = `${fy * 100}%`;
		},
	};
	let shown = false;

	modeBtn.addEventListener('click', () => {
		pad.on = !pad.on;
		modeBtn.classList.toggle('on', pad.on);
		modeBtn.textContent = pad.on ? 'Pad' : 'Touch';
		modeBtn.setAttribute('aria-pressed', String(pad.on));
		cursor.hidden = !pad.on;
		if (pad.on && !shown) {
			shown = true;
			pad.show(0.5, 0.5);
		}
	});

	function keysym(name: string): number {
		const code = MODS[name];
		if (name === 'opt') return ALT_L;
		if (name === 'shift') return SHIFT_L;
		return modifierKeysym(code) ?? 0;
	}
	function toggle(btn: HTMLElement) {
		const name = btn.dataset.mod!;
		const ks = latched.get(name);
		if (ks !== undefined) {
			latched.delete(name);
			app.send(cmd.key(ks, false));
		} else {
			const k = keysym(name);
			latched.set(name, k);
			app.send(cmd.key(k, true));
		}
		btn.classList.toggle('on', latched.has(name));
		btn.setAttribute('aria-pressed', String(latched.has(name)));
	}
	const buttons = [
		...document.querySelectorAll<HTMLElement>('#pad-tools .mod'),
	];
	for (const b of buttons) {
		// Keep focus where it is, so the on-screen keyboard stays up.
		b.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		b.addEventListener('click', () => toggle(b));
	}
	function release() {
		for (const [name, ks] of latched) {
			app.send(cmd.key(ks, false));
			latched.delete(name);
		}
		for (const b of buttons) {
			b.classList.remove('on');
			b.setAttribute('aria-pressed', 'false');
		}
	}
	// One key or click uses them up. The click is handled first (pointer.ts registers earlier).
	app.surface.addEventListener('pointerup', () => latched.size && release());
	for (const t of ['keyup', 'input'] as const)
		app.kbd.addEventListener(t, (e) => {
			if (
				latched.size &&
				!(
					e instanceof KeyboardEvent && /^(Shift|Control|Alt|Meta)/.test(e.code)
				)
			)
				release();
		});
	// What the page does to release everything (tab hidden, window blur) frees them too.
	window.addEventListener('blur', release);
	return pad;
}
