import { ItemView, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import MeetingsPlusPlugin from "../main";
import {
	PLUGIN_NAME,
	VIEW_TYPE_MEETINGS_PLUS,
} from "../constants";
import {
	CalendarConfig,
	CalendarStatus,
	Meeting,
} from "../types";
import { findExistingNote } from "../notes/duplicate-detector";
import {
	buildRowContextMenu,
	renderMeetingRow,
} from "./components/meeting-row";
import { renderStatusHeader } from "./components/status-header";
import { renderCurrentMeeting } from "./components/current-meeting";

const IMMINENT_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class MeetingsPlusView extends ItemView {
	private earlierTodayCollapsed = true;
	private focusedDay: string = dayKey(new Date());
	private unsubRefresh: (() => void) | null = null;
	private rerenderTimer: number | null = null;
	private pendingScrollKey: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: MeetingsPlusPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MEETINGS_PLUS;
	}

	getDisplayText(): string {
		return PLUGIN_NAME;
	}

	getIcon(): string {
		return "calendar-clock";
	}

	onOpen(): Promise<void> {
		const startedUnsub = this.plugin.manager.events.on(
			"refresh:started",
			() => this.render()
		);
		const completedUnsub = this.plugin.manager.events.on(
			"refresh:completed",
			() => this.render()
		);
		this.unsubRefresh = () => {
			startedUnsub();
			completedUnsub();
		};

		this.rerenderTimer = window.setInterval(
			() => this.render(),
			60_000
		);

		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.unsubRefresh?.();
		this.unsubRefresh = null;
		if (this.rerenderTimer !== null) {
			window.clearInterval(this.rerenderTimer);
			this.rerenderTimer = null;
		}
		this.contentEl.empty();
		return Promise.resolve();
	}

	render(): void {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({
			cls: "meetings-plus-container",
		});

		const calendars = this.plugin.settings.calendars;
		const statuses: CalendarStatus[] = calendars.map((c) => ({
			calendarId: c.id,
			status: this.plugin.manager.getStatus(c.id),
		}));

		const lookAhead = Math.max(1, this.plugin.settings.lookAheadDays);
		const lookBack = Math.max(
			0,
			Math.min(30, this.plugin.settings.lookBackDays)
		);
		const now = Date.now();
		const today = startOfDay(new Date(now));
		const todayKey = dayKey(today);
		const minKey = dayKey(new Date(today.getTime() - lookBack * DAY_MS));
		if (this.focusedDay < minKey) this.focusedDay = minKey;

		// daysWithMeetings is computed lazily below; pre-compute now for the
		// header (the picker needs it even before we render the agenda).
		// Honors disabled-calendar and skip-today filters via visibleMeetings().
		const allDaysWithMeetings = new Set<string>();
		for (const m of this.visibleMeetings()) {
			allDaysWithMeetings.add(dayKey(m.start));
			for (const dk of spannedDayKeys(m)) {
				allDaysWithMeetings.add(dk);
			}
		}

		renderStatusHeader({
			parent: root,
			calendars,
			statuses,
			lookAheadDays: lookAhead,
			focusedDay: this.focusedDay,
			today: todayKey,
			minDay: minKey,
			daysWithMeetings: allDaysWithMeetings,
			onRefresh: () => {
				void this.plugin.manager.refreshAll();
			},
			onOpenSettings: () => this.openSettings(),
			onPickDay: (k) => this.jumpToDay(k),
			onChangeDays: (n) => this.changeDays(n),
		});

		if (calendars.length === 0) {
			this.renderEmptyState(root);
			return;
		}

		const errorCalendars = statuses.filter(
			(s) => s.status.kind === "error"
		);
		if (errorCalendars.length > 0) {
			this.renderErrors(root, errorCalendars, calendars);
		}

		const meetings = this.visibleMeetings();
		const calIndex = indexById(calendars);
		const focusedDate = dateFromKey(this.focusedDay);

		const byDay = new Map<string, Meeting[]>();
		for (const m of meetings) {
			const k = dayKey(m.start);
			if (!byDay.has(k)) byDay.set(k, []);
			byDay.get(k)!.push(m);
			for (const dk of spannedDayKeys(m)) {
				if (!byDay.has(dk)) byDay.set(dk, []);
				byDay.get(dk)!.push(m);
			}
		}

		// Current/imminent card — only when focused on today
		if (this.focusedDay === todayKey) {
			const todays = byDay.get(todayKey) ?? [];
			const current = todays.find(
				(m) =>
					m.start.getTime() <= now + IMMINENT_WINDOW_MS &&
					m.end.getTime() > now
			);
			if (current) {
				renderCurrentMeeting({
					parent: root,
					meeting: current,
					calendar: calIndex.get(current.calendarId),
					hasNote: this.hasNote(current),
					onOpenNote: (m) => this.activate(m),
					onOpenLink: current.meetingUrl
						? (m) => this.openLink(m)
						: null,
				});
			}
		}

		const agenda = root.createDiv({ cls: "meetings-plus-agenda" });
		let emptyRun = 0;
		let renderedAny = false;

		for (let i = 0; i < lookAhead; i++) {
			const date = new Date(focusedDate.getTime() + i * DAY_MS);
			const key = dayKey(date);
			const dayMeetings = byDay.get(key) ?? [];
			const isFocusedDay = i === 0;
			const isTodayKey = key === todayKey;

			if (dayMeetings.length === 0 && !isFocusedDay) {
				emptyRun++;
				continue;
			}

			if (emptyRun > 0) {
				this.renderEmptyRun(agenda, emptyRun);
				emptyRun = 0;
			}

			renderedAny = true;
			const label = dayLabel(
				date,
				isTodayKey,
				isTomorrow(date, today),
				isYesterday(date, today)
			);
			this.renderDay(
				agenda,
				key,
				label,
				dayMeetings,
				calIndex,
				isTodayKey,
				key < todayKey,
				now,
				isFocusedDay
			);
		}

		if (emptyRun > 0) {
			this.renderEmptyRun(agenda, emptyRun);
		}

		if (!renderedAny && emptyRun === 0) {
			agenda.createDiv({
				cls: "meetings-plus-empty",
				text: "Nothing scheduled.",
			});
		}

		if (this.pendingScrollKey) {
			const target = this.pendingScrollKey;
			this.pendingScrollKey = null;
			window.requestAnimationFrame(() => {
				const el = this.contentEl.querySelector(
					`[data-day="${target}"]`
				);
				if (el instanceof HTMLElement) {
					el.scrollIntoView({ behavior: "smooth", block: "start" });
				}
			});
		}
	}

	private renderEmptyState(parent: HTMLElement): void {
		const box = parent.createDiv({ cls: "meetings-plus-empty-cta" });
		box.createEl("p", {
			text: "Add a calendar to start seeing meetings here.",
		});
		const btn = box.createEl("button", {
			cls: "mod-cta",
			text: "Open settings",
		});
		btn.addEventListener("click", () => this.openSettings());
	}

	private renderErrors(
		parent: HTMLElement,
		errors: CalendarStatus[],
		calendars: CalendarConfig[]
	): void {
		const wrap = parent.createDiv({ cls: "meetings-plus-errors" });
		for (const e of errors) {
			if (e.status.kind !== "error") continue;
			const cal = calendars.find((c) => c.id === e.calendarId);
			wrap.createDiv({
				cls: "meetings-plus-error-row",
				text: `${cal?.name ?? "Calendar"}: ${e.status.message}`,
			});
		}
	}

	private renderDay(
		parent: HTMLElement,
		key: string,
		label: string,
		meetings: Meeting[],
		calIndex: Map<string, CalendarConfig>,
		isToday: boolean,
		isPast: boolean,
		now: number,
		isFocusedDay: boolean
	): void {
		const day = parent.createDiv({ cls: "meetings-plus-day" });
		day.setAttribute("data-day", key);
		if (isToday) day.addClass("meetings-plus-day-today");
		if (isPast) day.addClass("meetings-plus-day-past");

		const header = day.createDiv({ cls: "meetings-plus-day-header" });
		header.createSpan({
			cls: "meetings-plus-day-label",
			text: label,
		});

		if (meetings.length === 0) {
			day.createDiv({
				cls: "meetings-plus-day-empty-inline",
				text: "No meetings",
			});
			return;
		}

		const body = day.createDiv({ cls: "meetings-plus-day-body" });

		// On today, hide the current/imminent meeting from the agenda list
		// (it's already shown in the highlighted card above).
		// Also split out earlier-today into a collapsible.
		let toRender = meetings;
		let earlier: Meeting[] = [];

		if (isToday && isFocusedDay) {
			const current = meetings.find(
				(m) =>
					m.start.getTime() <= now + IMMINENT_WINDOW_MS &&
					m.end.getTime() > now
			);
			earlier = meetings.filter((m) => m.end.getTime() <= now);
			toRender = meetings.filter(
				(m) =>
					m.end.getTime() > now &&
					(!current || m.dedupKey !== current.dedupKey)
			);
		}

		if (toRender.length === 0 && earlier.length === 0) {
			day.createDiv({
				cls: "meetings-plus-day-empty-inline",
				text: "Nothing else scheduled",
			});
		}

		for (const meeting of toRender) {
			renderMeetingRow({
				parent: body,
				meeting,
				calendar: calIndex.get(meeting.calendarId),
				hasNote: this.hasNote(meeting),
				onActivate: (m) => this.activate(m),
				onContextMenu: (m, evt) => this.showContextMenu(m, evt),
			});
		}

		if (earlier.length > 0) {
			this.renderEarlierToday(day, earlier, calIndex);
		}
	}

	private renderEarlierToday(
		parent: HTMLElement,
		meetings: Meeting[],
		calIndex: Map<string, CalendarConfig>
	): void {
		const section = parent.createDiv({
			cls: "meetings-plus-earlier-section",
		});
		if (this.earlierTodayCollapsed) {
			section.addClass("meetings-plus-collapsed");
		}
		const header = section.createDiv({
			cls: "meetings-plus-earlier-header",
		});
		const chevron = header.createSpan({ cls: "meetings-plus-chevron" });
		setIcon(chevron, "chevron-down");
		header.createSpan({ text: "Earlier today" });
		header.createSpan({
			cls: "meetings-plus-section-count",
			text: String(meetings.length),
		});
		header.addEventListener("click", () => {
			this.earlierTodayCollapsed = !this.earlierTodayCollapsed;
			this.render();
		});
		const body = section.createDiv({
			cls: "meetings-plus-earlier-body",
		});
		for (const meeting of meetings) {
			renderMeetingRow({
				parent: body,
				meeting,
				calendar: calIndex.get(meeting.calendarId),
				hasNote: this.hasNote(meeting),
				onActivate: (m) => this.activate(m),
				onContextMenu: (m, evt) => this.showContextMenu(m, evt),
			});
		}
	}

	private renderEmptyRun(parent: HTMLElement, count: number): void {
		const word = count === 1 ? "day" : "days";
		parent.createDiv({
			cls: "meetings-plus-empty-run",
			text: `${count} ${word} without events`,
		});
	}

	private jumpToDay(k: string): void {
		this.focusedDay = k;
		this.pendingScrollKey = k;
		this.render();
	}

	private changeDays(n: number): void {
		this.plugin.settings.lookAheadDays = n;
		void this.plugin.saveSettings();
		this.render();
	}

	private hasNote(meeting: Meeting): boolean {
		return Boolean(findExistingNote(this.app, meeting.dedupKey));
	}

	private visibleMeetings(): Meeting[] {
		const now = Date.now();
		const skipped = new Set(
			this.plugin.settings.skippedToday
				.filter((s) => s.until > now)
				.map((s) => s.key)
		);
		const enabledIds = new Set(
			this.plugin.settings.calendars
				.filter((c) => c.enabled)
				.map((c) => c.id)
		);
		return this.plugin.manager
			.getAllMeetings()
			.filter((m) => enabledIds.has(m.calendarId))
			.filter((m) => !skipped.has(m.dedupKey));
	}

	private activate(meeting: Meeting): void {
		void this.plugin.openOrCreateNote(meeting);
	}

	private openLink(meeting: Meeting): void {
		if (!meeting.meetingUrl) return;
		window.open(meeting.meetingUrl, "_blank");
	}

	private showContextMenu(meeting: Meeting, evt: MouseEvent): void {
		const menu = buildRowContextMenu(meeting, {
			onCreateOrOpen: () => this.activate(meeting),
			onOpenLink: meeting.meetingUrl
				? () => this.openLink(meeting)
				: null,
			onCopyLink: meeting.meetingUrl
				? () => {
						void navigator.clipboard.writeText(meeting.meetingUrl);
						new Notice("Meeting link copied");
					}
				: null,
			onSkip: () => {
				const until = endOfDay(new Date()).getTime();
				this.plugin.settings.skippedToday.push({
					key: meeting.dedupKey,
					until,
				});
				void this.plugin.saveSettings();
				this.render();
			},
		});
		menu.showAtMouseEvent(evt);
	}

	private openSettings(): void {
		const setting = (
			this.app as unknown as {
				setting?: {
					open: () => void;
					openTabById: (id: string) => void;
				};
			}
		).setting;
		if (setting) {
			setting.open();
			setting.openTabById(this.plugin.manifest.id);
		}
	}
}

function indexById(
	calendars: CalendarConfig[]
): Map<string, CalendarConfig> {
	const map = new Map<string, CalendarConfig>();
	for (const c of calendars) map.set(c.id, c);
	return map;
}

/**
 * Day keys an all-day event spans beyond its start day (iCal DTEND is
 * exclusive). Steps by calendar day rather than fixed 24h so DST-transition
 * days are neither skipped nor double-counted.
 */
function spannedDayKeys(m: Meeting): string[] {
	if (!m.allDay) return [];
	const keys: string[] = [];
	const endT = m.end.getTime();
	let d = new Date(
		m.start.getFullYear(),
		m.start.getMonth(),
		m.start.getDate() + 1
	);
	while (d.getTime() < endT) {
		keys.push(dayKey(d));
		d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
	}
	return keys;
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

function endOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(23, 59, 59, 999);
	return x;
}

export function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

function dateFromKey(k: string): Date {
	const [y, m, d] = k.split("-").map((x) => parseInt(x, 10));
	return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function isTomorrow(d: Date, today: Date): boolean {
	const tomorrow = new Date(today.getTime() + DAY_MS);
	return dayKey(d) === dayKey(tomorrow);
}

function isYesterday(d: Date, today: Date): boolean {
	const yesterday = new Date(today.getTime() - DAY_MS);
	return dayKey(d) === dayKey(yesterday);
}

function dayLabel(
	d: Date,
	isToday: boolean,
	isTom: boolean,
	isYest: boolean
): string {
	if (isToday) return "Today";
	if (isTom) return "Tomorrow";
	if (isYest) return "Yesterday";
	return moment(d).format("ddd, MMM D");
}
