// Touch extras: a trackpad mode (one finger moves a visible pointer relatively, like a
// laptop trackpad) and latched modifier keys (tap one, then type or click: it is
// released after that key or click). Both need a touch screen and an input-capable viewer.
import { cmd } from '../protocol';
import type { App } from './app';
import { el } from './app';
import type { Clipboard } from './clipboard';
import type { Zoom } from './zoom';

type ModifierKeysym = (code: string) => number | undefined;
type Keys = { modifierKeysym: ModifierKeysym; tap: (keysym: number) => void };

/** The keys a soft keyboard lacks: the tray's second row. */
const KEYSYMS: Record<string, number> = {
	esc: 0xff1b,
	tab: 0xff09,
	left: 0xff51,
	up: 0xff52,
	right: 0xff53,
	down: 0xff54,
	enter: 0xff0d,
};
const KEY_V = 0x76;

const MODS: Record<string, string> = {
	cmd: 'MetaLeft',
	opt: 'AltLeft',
	ctrl: 'ControlLeft',
	shift: 'ShiftLeft',
};
const ALT_L = 0xffe9,
	SHIFT_L = 0xffe1;

export function createTouchTools(
	app: App,
	{ modifierKeysym, tap }: Keys,
	clipboard: Clipboard,
	zoom: Zoom
) {
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

	// The tray's second row: Esc, Tab, arrows, Return and Paste.
	const keysBtn = el<HTMLButtonElement>('keys-btn');
	const keyRow = el('key-row');
	keysBtn.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	keysBtn.addEventListener('click', () => {
		const open = keyRow.classList.toggle('open');
		keysBtn.classList.toggle('on', open);
		keysBtn.setAttribute('aria-pressed', String(open));
	});
	for (const b of keyRow.querySelectorAll<HTMLElement>('button')) {
		b.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		b.addEventListener('click', () => {
			const name = b.dataset.key!;
			if (name === 'paste') void paste();
			else tap(KEYSYMS[name]);
			// A latched modifier applies to this key: arrows with ⇧, Tab with ⌃.
			if (latched.size) setTimeout(release, 30);
		});
	}
	/** This device's clipboard to the machine, then the machine's paste shortcut (the page cannot read the
	 * clipboard except in a tap like this one). */
	async function paste() {
		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;
			clipboard.noteLocal(text);
			app.send(cmd.clipboard(text));
			const m = modifierKeysym(app.remoteMac ? 'MetaLeft' : 'ControlLeft');
			if (m === undefined) return;
			// The machine's clipboard is set before the shortcut lands.
			setTimeout(() => {
				app.send(cmd.key(m, true));
				tap(KEY_V);
				app.send(cmd.key(m, false));
			}, 120);
		} catch {
			// Not allowed: the browser did not let this page read its clipboard.
		}
	}

	// Zoomed in: a "1×" button and a mini-map of where the view is.
	const resetBtn = el<HTMLButtonElement>('zoom-reset');
	const map = el('minimap');
	const rect = map.firstElementChild as HTMLElement;
	resetBtn.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	resetBtn.addEventListener('click', () => zoom.reset());
	zoom.onChange((z, x, y, w, h) => {
		const on = z > 1.01;
		resetBtn.hidden = map.hidden = !on;
		rect.style.left = `${x * 100}%`;
		rect.style.top = `${y * 100}%`;
		rect.style.width = `${w * 100}%`;
		rect.style.height = `${h * 100}%`;
	});

	// What the page does to release everything (tab hidden, window blur) frees them too.
	window.addEventListener('blur', release);
	return pad;
}
