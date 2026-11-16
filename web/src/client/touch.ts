// Touch: tap = click, drag = left-drag, long press = right click, pinch = zoom the
// view in or out, two fingers = scroll. The content follows the fingers: two fingers
// move a zoomed-in view, and scroll the desktop once the view reaches its edge.
// Pointer mode (the phone's default): the finger moves a pointer like a trackpad; tap clicks where
// it is, two-finger tap right-clicks, hold still then move drags, two fingers scroll, pinch zooms.
import { cmd } from '../protocol';
import type { App } from './app';
import type { Zoom } from './zoom';

const SLOP = 10;
const LONG_PRESS = 550;
/** Pointer mode: a still finger this long holds the button for a drag (the old cos viewer's 450 ms). */
const PAD_HOLD = 450;
/** Pointer mode: a finger that has travelled no more than this is still (a tap or a hold). */
const STILL = 3;
/** A tap this soon (GTK's and Qt's double-click time) and this close (CSS px) after
 * the last one clicks the same spot, so double-taps double-click even though the
 * finger lands a little off. */
const MULTI_TAP_MS = 400;
const MULTI_TAP_PX = 24;

interface Hooks {
	/** Move the remote pointer to a client (CSS pixel) position. */
	moveTo(x: number, y: number): void;
	queueScroll(dx: number, dy: number): void;
	deskPerPx(): number;
	zoom: Zoom;
	/** Trackpad mode: one finger moves the pointer relatively instead of pointing at the spot. */
	trackpad(): boolean;
	/** Move the remote pointer by a finger movement in CSS pixels, `dt` ms after the last one. */
	moveBy(dx: number, dy: number, dt: number): void;
}

export function createTouch(app: App, hooks: Hooks) {
	const { send } = app;
	const pts = new Map<number, { x: number; y: number }>();
	/** 'two': two fingers down, not yet moved enough to tell a scroll from a pinch. */
	let mode: 'pending' | 'drag' | 'two' | 'scroll' | 'pinch' | 'done' | null =
		null;
	let start = { x: 0, y: 0 };
	/** When the finger last moved (pointer mode's speed: quick flicks go further). */
	let lastT = 0;
	/** How far the finger has travelled (pointer mode: a finger that has moved isn't a hold). */
	let travel = 0;
	let downT = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastMid: [number, number] = [0, 0];
	let startMid: [number, number] = [0, 0];
	let startSpread = 0;
	let lastTap = { x: 0, y: 0, t: -Infinity };
	/** The gesture began in trackpad mode; `held`: its left button is down (a long press drags). */
	let pad = false,
		held = false,
		twoAt = 0;
	const mid = (): [number, number] => {
		let x = 0,
			y = 0;
		for (const p of pts.values()) {
			x += p.x;
			y += p.y;
		}
		return [x / pts.size, y / pts.size];
	};
	/** Mean distance of the fingers from their centroid (half the gap for two). */
	const spread = () => {
		const [mx, my] = mid();
		let d = 0;
		for (const p of pts.values()) d += Math.hypot(p.x - mx, p.y - my);
		return d / pts.size;
	};
	/** Measure the gesture from where the fingers are now (they were added or lifted). */
	const rebase = () => {
		startMid = lastMid = mid();
		startSpread = spread();
		if (mode === 'pinch') hooks.zoom.begin(...startMid, startSpread);
	};
	const click = (button: number) => {
		send(cmd.button(button, true));
		send(cmd.button(button, false));
	};

	function down(e: PointerEvent) {
		try {
			app.surface.setPointerCapture(e.pointerId);
		} catch {}
		pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pts.size === 1) {
			mode = 'pending';
			pad = hooks.trackpad();
			// Put the machine's pointer where the drawn one is (a fresh connection, or the mouse moved there),
			// so a tap or hold acts at the arrow the user sees.
			if (pad) hooks.moveBy(0, 0, 16);
			held = false;
			start = { x: e.clientX, y: e.clientY };
			lastT = performance.now();
			travel = 0;
			downT = performance.now();
			timer = setTimeout(
				() => {
					if (mode !== 'pending') return;
					// Pointer mode: only a finger held still holds the button; a slow nudge keeps moving.
					if (pad && travel > STILL) return;
					if (pad) {
						// Trackpad: a long press holds the left button, so the next move drags.
						send(cmd.button(1, true));
						held = true;
						mode = 'drag';
					} else {
						hooks.moveTo(start.x, start.y);
						click(3);
						mode = 'done';
					}
					navigator.vibrate?.(10);
				},
				pad ? PAD_HOLD : LONG_PRESS
			);
		} else {
			if (pts.size === 2) {
				clearTimeout(timer);
				if (mode === 'drag' && (!pad || held)) send(cmd.button(1, false));
				held = false;
				mode = 'two';
				twoAt = performance.now();
			}
			rebase();
		}
	}
	function move(e: PointerEvent) {
		const p = pts.get(e.pointerId);
		if (!p) return;
		const dx = e.clientX - p.x,
			dy = e.clientY - p.y;
		p.x = e.clientX;
		p.y = e.clientY;
		if (pad && pts.size === 1 && (mode === 'pending' || mode === 'drag')) {
			// Pointer mode: the pointer follows every bit of the finger (no dead zone), like a trackpad.
			const now = performance.now();
			hooks.moveBy(dx, dy, now - lastT);
			lastT = now;
			travel += Math.hypot(dx, dy);
			// Like the old cos viewer: any real travel (8 px of path, not just distance from the start) makes it a
			// move, so a slow nudge never turns into a drag.
			if (mode === 'pending' && travel > 8) {
				clearTimeout(timer);
				mode = 'drag';
			}
		} else if (
			mode === 'pending' &&
			Math.hypot(p.x - start.x, p.y - start.y) > SLOP
		) {
			clearTimeout(timer);
			mode = 'drag';
			hooks.moveTo(start.x, start.y);
			send(cmd.button(1, true));
		} else if (mode === 'drag' && !pad) hooks.moveTo(p.x, p.y);
		if (pts.size < 2) return;
		if (mode === 'two') {
			// A pinch changes the fingers' gap faster than it moves their centroid
			// (twice as fast with one finger still); a scroll moves them together.
			const [mx, my] = mid();
			const moved = Math.hypot(mx - startMid[0], my - startMid[1]);
			const gap = 2 * Math.abs(spread() - startSpread);
			if (gap > SLOP && gap > moved) {
				mode = 'pinch';
				rebase();
			} else if (moved > SLOP) mode = 'scroll';
		}
		if (mode === 'pinch') hooks.zoom.pinch(...mid(), spread());
		else if (mode === 'scroll') {
			const m = mid(),
				k = hooks.deskPerPx();
			// Pointer mode scrolls the machine (the view follows the pointer by itself); Touch moves a
			// zoomed-in view first and scrolls once it reaches the edge.
			const [rx, ry] = pad
				? [m[0] - lastMid[0], m[1] - lastMid[1]]
				: hooks.zoom.pan(m[0] - lastMid[0], m[1] - lastMid[1]);
			hooks.queueScroll(-rx * k, -ry * k);
			lastMid = m;
		}
	}
	function up(e: PointerEvent) {
		if (!pts.delete(e.pointerId)) return;
		if (mode === 'pending') {
			clearTimeout(timer);
			const now = performance.now();
			if (pad) {
				// A tap: a still finger, or a quick one with a little wobble (the old viewer's 300 ms). A slow
				// nudge that ends in place is only a move.
				if (travel <= STILL || now - downT < 300) click(1);
				mode = 'done';
				if (pts.size === 0) mode = null;
				return;
			}
			const at =
				now - lastTap.t < MULTI_TAP_MS &&
				Math.hypot(start.x - lastTap.x, start.y - lastTap.y) < MULTI_TAP_PX
					? lastTap
					: start;
			lastTap = { x: at.x, y: at.y, t: now };
			hooks.moveTo(at.x, at.y);
			click(1);
			mode = 'done';
		} else if (mode === 'drag') {
			if (!pad || held) send(cmd.button(1, false));
			held = false;
			mode = 'done';
		} else if (mode === 'two' && pad && performance.now() - twoAt < 300) {
			click(3); // trackpad: a two-finger tap is a right click
			mode = 'done';
		} else if (mode === 'two' || mode === 'scroll' || mode === 'pinch') {
			if (pts.size < 2) mode = 'done';
			else rebase();
		}
		if (pts.size === 0) mode = null;
	}
	function cancel(e: PointerEvent) {
		clearTimeout(timer);
		if (mode === 'drag' && (!pad || held)) send(cmd.button(1, false));
		held = false;
		pts.delete(e.pointerId);
		mode = pts.size ? 'done' : null;
	}
	return { down, move, up, cancel };
}
