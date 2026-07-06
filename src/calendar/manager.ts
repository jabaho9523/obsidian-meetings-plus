import { App } from "obsidian";
import { MeetingsPlusSettings } from "../settings";
import { CalendarConfig, FetchStatus, Meeting } from "../types";
import { TypedEventBus } from "../util/events";
import { fetchICS } from "./fetcher";
import { parseICS } from "./parser";
import { MeetingCache } from "./cache";

/**
 * Fixed parse window. The user's `lookAheadDays` / `lookBackDays` settings
 * control what the sidebar *shows*; parsing more here gives the date picker
 * room to jump without re-fetching.
 */
const PARSE_WINDOW_DAYS = 180;
const PARSE_BACK_DAYS = 30;

export interface CalendarManagerEvents extends Record<string, unknown> {
	"refresh:started": { calendarId: string | null };
	"refresh:completed": { calendarId: string | null; ok: boolean };
}

export interface SaveCallback {
	(): Promise<void>;
}

export class CalendarManager {
	readonly events = new TypedEventBus<CalendarManagerEvents>();
	readonly cache: MeetingCache;
	private status = new Map<string, FetchStatus>();
	private timerHandle: number | null = null;
	private inFlight = new Set<string>();

	constructor(
		private readonly app: App,
		private readonly getSettings: () => MeetingsPlusSettings,
		private readonly persistCache: SaveCallback
	) {
		this.cache = new MeetingCache(this.getSettings().cache);
		void this.app; // currently unused, kept for symmetry / future extensions
	}

	getStatus(calendarId: string): FetchStatus {
		return this.status.get(calendarId) ?? { kind: "idle" };
	}

	getAllMeetings(): Meeting[] {
		return this.cache.getAll();
	}

	getMeetingByKey(dedupKey: string): Meeting | undefined {
		for (const m of this.cache.getAll()) {
			if (m.dedupKey === dedupKey) return m;
		}
		return undefined;
	}

	start(): void {
		this.scheduleNextTick();
		void this.refreshAll();
	}

	stop(): void {
		if (this.timerHandle !== null) {
			window.clearInterval(this.timerHandle);
			this.timerHandle = null;
		}
		this.events.clear();
	}

	onSettingsChanged(): void {
		this.scheduleNextTick();
	}

	dropCalendar(calendarId: string): void {
		this.cache.clear(calendarId);
		this.status.delete(calendarId);
		void this.persistCache();
	}

	async refreshAll(): Promise<void> {
		const settings = this.getSettings();
		const enabled = settings.calendars.filter((c) => c.enabled && c.url);
		if (enabled.length === 0) {
			this.events.emit("refresh:completed", {
				calendarId: null,
				ok: true,
			});
			return;
		}
		this.events.emit("refresh:started", { calendarId: null });
		const results = await Promise.all(
			enabled.map((c) => this.refreshOne(c).catch(() => false))
		);
		const ok = results.every(Boolean);
		this.events.emit("refresh:completed", { calendarId: null, ok });
	}

	async refreshCalendar(calendarId: string): Promise<boolean> {
		const cal = this.getSettings().calendars.find(
			(c) => c.id === calendarId
		);
		if (!cal || !cal.enabled || !cal.url) return false;
		return this.refreshOne(cal);
	}

	private async refreshOne(cal: CalendarConfig): Promise<boolean> {
		if (this.inFlight.has(cal.id)) return false;
		this.inFlight.add(cal.id);
		this.status.set(cal.id, {
			kind: "fetching",
			startedAt: Date.now(),
		});
		this.events.emit("refresh:started", { calendarId: cal.id });

		try {
			const settings = this.getSettings();
			const timeoutMs = settings.requestTimeoutSeconds * 1000;
			const result = await fetchICS(cal.url, { timeoutMs });
			const now = new Date();
			const todayStart = startOfToday(now);
			const windowStart = new Date(
				todayStart.getTime() -
					PARSE_BACK_DAYS * 24 * 60 * 60 * 1000
			);
			const windowEnd = new Date(
				todayStart.getTime() +
					PARSE_WINDOW_DAYS * 24 * 60 * 60 * 1000
			);
			const meetings = parseICS(result.body, {
				calendar: cal,
				windowStart,
				windowEnd,
			});
			const fetchedAt = Date.now();
			this.cache.set(cal.id, meetings, fetchedAt);
			this.status.set(cal.id, {
				kind: "success",
				fetchedAt,
				count: meetings.length,
			});
			await this.persistCache();
			this.events.emit("refresh:completed", {
				calendarId: cal.id,
				ok: true,
			});
			return true;
		} catch (e) {
			const message =
				e instanceof Error ? e.message : "Unknown error";
			this.status.set(cal.id, {
				kind: "error",
				fetchedAt: Date.now(),
				message,
			});
			console.warn(`[Meetings Plus] Calendar fetch failed for ${cal.name}`);
			this.events.emit("refresh:completed", {
				calendarId: cal.id,
				ok: false,
			});
			return false;
		} finally {
			this.inFlight.delete(cal.id);
		}
	}

	private scheduleNextTick(): void {
		if (this.timerHandle !== null) {
			window.clearInterval(this.timerHandle);
			this.timerHandle = null;
		}
		const minutes = Math.max(1, this.getSettings().refreshIntervalMinutes);
		this.timerHandle = window.setInterval(
			() => {
				void this.refreshAll();
			},
			minutes * 60 * 1000
		);
	}
}

function startOfToday(now: Date): Date {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d;
}
