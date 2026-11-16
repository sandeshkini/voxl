// Browser APIs voxl uses that TypeScript's DOM library doesn't include yet.

// Insertable streams for video (Chromium): write VideoFrames into a MediaStreamTrack.
interface MediaStreamTrackGenerator extends MediaStreamTrack {
	readonly writable: WritableStream<VideoFrame>;
}
declare var MediaStreamTrackGenerator: {
	prototype: MediaStreamTrackGenerator;
	new (init: { kind: 'video' | 'audio' }): MediaStreamTrackGenerator;
};

// Keyboard Lock (Chromium): capture reserved shortcuts in fullscreen.
interface Keyboard {
	lock(keyCodes?: string[]): Promise<void>;
	unlock(): void;
}
interface Navigator {
	readonly keyboard?: Keyboard;
}

// Read by the bench tools (measure.mjs) and handy in the console.
interface Window {
	fps: number;
	voxlStats: unknown;
	/** For a page that frames voxl and draws its own controls (main.ts). */
	voxlEmbed: {
		send(command: string): void;
		setClipboard(text: string): void;
		interact(): void;
		hello: Record<string, unknown> | null;
	};
}
