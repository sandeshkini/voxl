// Mouse, wheel/trackpad and touch input on the desktop surface.
import { cmd } from '../protocol';
import type { App } from './app';
import { createTouch } from './touch';
import type { Zoom } from './zoom';

/** DOM button -> X button (left, middle, right, back, forward). */
const BUTTONS = [1, 2, 3, 8, 9];

/** Pointer mode's speed: a slow finger moves the pointer as far as it moves over the picture (precise), a
 * quick flick up to three times as far, like a laptop trackpad (the old cos viewer's curve). */
const padGain = (dx: number, dy: number, dt: number) =>
	1 + Math.min(2, (Math.hypot(dx, dy) / Math.max(dt, 1)) * 1.5);

export function setupPointer(
	app: App,
	zoom: Zoom,
	onInteract: () => void,
	pad: { on: boolean; show(x: number, y: number): void }
) {
	const { surface, send } = app;

	function toDesk(p: { clientX: number; clientY: number }): [number, number] {
		const r = surface.getBoundingClientRect();
		const x = Math.round(((p.clientX - r.left) * app.desk.w) / r.width);
		const y = Math.round(((p.clientY - r.top) * app.desk.h) / r.height);
		return [
			Math.max(0, Math.min(app.desk.w - 1, x)),
			Math.max(0, Math.min(app.desk.h - 1, y)),
		];
	}
	let lastMove = '';
	/** Where the remote pointer is, in desktop pixels (trackpad mode moves it from here). */
	const cur = { x: 0, y: 0 };
	function moveDesk(x: number, y: number, force = false) {
		cur.x = x;
		cur.y = y;
		// Pointer mode keeps the fraction, so slow finger moves add up instead of rounding away.
		const s = cmd.move(Math.round(x), Math.round(y));
		if (s !== lastMove || force) {
			lastMove = s;
			send(s);
		}
		if (pad.on) pad.show(x / app.desk.w, y / app.desk.h);
	}
	function move(p: { clientX: number; clientY: number }, force = false) {
		if (!app.desk.w) return;
		moveDesk(...toDesk(p), force);
	}
	function moveBy(dx: number, dy: number, dt: number) {
		if (!app.desk.w) return;
		if (!cur.x && !cur.y) {
			cur.x = app.desk.w / 2;
			cur.y = app.desk.h / 2;
		}
		const k = deskPerPx() * padGain(dx, dy, dt);
		moveDesk(
			Math.max(0, Math.min(app.desk.w - 1, cur.x + dx * k)),
			Math.max(0, Math.min(app.desk.h - 1, cur.y + dy * k)),
			true
		);
		// Zoomed in, the view follows the pointer so it never leaves the screen.
		const r = surface.getBoundingClientRect();
		zoom.follow(
			r.left + (cur.x / app.desk.w) * r.width,
			r.top + (cur.y / app.desk.h) * r.height
		);
	}

	// Scroll is sent in desktop pixels, batched per frame; the server turns it into
	// smooth (pixel-precise) scrolling, or wheel clicks on X servers that can't.
	let sx = 0,
		sy = 0,
		queued = false;
	function queueScroll(dx: number, dy: number) {
		sx += dx;
		sy += dy;
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			if (Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5) return;
			send(cmd.scroll(sx, sy));
			sx = 0;
			sy = 0;
		});
	}
	/** Desktop pixels per on-screen pixel. */
	const deskPerPx = () => app.desk.w / surface.getBoundingClientRect().width;

	const touch = createTouch(app, {
		moveTo: (x, y) => move({ clientX: x, clientY: y }, true),
		queueScroll,
		deskPerPx,
		zoom,
		trackpad: () => pad.on,
		moveBy,
	});

	surface.addEventListener('pointermove', (e) => {
		if (e.pointerType === 'touch') touch.move(e);
		else move(e);
	});
	surface.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		onInteract();
		if (e.pointerType === 'touch') {
			touch.down(e);
			return;
		}
		app.kbd.focus({ preventScroll: true });
		move(e);
		try {
			surface.setPointerCapture(e.pointerId);
		} catch {}
		send(cmd.button(BUTTONS[e.button] || 1, true));
	});
	surface.addEventListener('pointerup', (e) => {
		e.preventDefault();
		if (e.pointerType === 'touch') {
			touch.up(e);
			return;
		}
		move(e);
		send(cmd.button(BUTTONS[e.button] || 1, false));
	});
	surface.addEventListener('pointercancel', (e) => {
		if (e.pointerType === 'touch') touch.cancel(e);
		else send(cmd.releaseAll);
	});
	surface.addEventListener('contextmenu', (e) => e.preventDefault());
	surface.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			move(e);
			const k =
				(e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
			queueScroll(e.deltaX * k, e.deltaY * k);
		},
		{ passive: false }
	);
}
