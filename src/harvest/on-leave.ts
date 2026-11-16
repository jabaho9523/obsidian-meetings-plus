// Harvest when leaving a note: decides when, the caller does the work
// (no Obsidian imports).

export interface LeaveDeps {
	delayMs: number;
	/** Harvest on, on-leave on, in scope and not another app's note */
	mayHarvest(path: string): boolean;
	/** Last-modified time, null when the file is gone */
	mtime(path: string): number | null;
	/** Still open in a visible pane in source mode with the cursor in it */
	busy(path: string): boolean;
	harvest(path: string): Promise<void>;
	setTimer(fn: () => void, ms: number): number;
	clearTimer(id: number): void;
}

export class LeaveWatcher {
	private active: string | null = null;
	/** mtime when the note was first seen, or after its last harvest */
	private baseline = new Map<string, number>();
	private timers = new Map<string, number>();

	constructor(private readonly deps: LeaveDeps) {}

	/** Call with the active note's path whenever it may have changed. */
	setActive(path: string | null): void {
		if (path === this.active) return;
		const previous = this.active;
		this.active = path;
		if (path !== null) {
			this.cancel(path);
			if (!this.baseline.has(path)) {
				const mtime = this.deps.mtime(path);
				if (mtime !== null) this.baseline.set(path, mtime);
			}
		}
		if (previous !== null) this.schedule(previous);
	}

	clear(): void {
		for (const id of this.timers.values()) this.deps.clearTimer(id);
		this.timers.clear();
	}

	private cancel(path: string): void {
		const id = this.timers.get(path);
		if (id === undefined) return;
		this.deps.clearTimer(id);
		this.timers.delete(path);
	}

	private schedule(path: string): void {
		this.cancel(path);
		this.timers.set(
			path,
			this.deps.setTimer(() => this.fire(path), this.deps.delayMs)
		);
	}

	private fire(path: string): void {
		this.timers.delete(path);
		if (path === this.active) return;
		if (!this.deps.mayHarvest(path)) return;
		const mtime = this.deps.mtime(path);
		if (mtime === null) {
			this.baseline.delete(path);
			return;
		}
		if (this.baseline.get(path) === mtime) return;
		if (this.deps.busy(path)) return;
		void this.deps.harvest(path).then(() => {
			const after = this.deps.mtime(path);
			if (after !== null) this.baseline.set(path, after);
		});
	}
}
