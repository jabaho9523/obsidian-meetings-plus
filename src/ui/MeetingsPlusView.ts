import { ItemView, Notice, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { moment } from "../util/time";
import MeetingsPlusPlugin from "../main";
import {
	MAX_LOOK_BACK_DAYS,
	PLUGIN_NAME,
	VIEW_TYPE_MEETINGS_PLUS,
} from "../constants";
import {
	CalendarConfig,
	CalendarStatus,
	Meeting,
} from "../types";

import {
	buildRowContextMenu,
	renderMeetingRow,
} from "./components/meeting-row";
import { renderStatusHeader } from "./components/status-header";
import { renderCurrentMeeting } from "./components/current-meeting";
import { SidebarTask } from "../harvest/sidebar-tasks";

const IMMINENT_WINDOW_MS = 10 * 60 * 1000;

export class MeetingsPlusView extends ItemView {
	private earlierTodayCollapsed = true;
	private focusedDay: string = dayKey(new Date());
	private unsubRefresh: (() => void) | null = null;
	private rerenderTimer: number | null = null;
	private pendingScrollKey: string | null = null;
	private harvestButton: HTMLButtonElement | null = null;
	/** Paths of the notes whose task list is open under their meeting */
	private expandedNotes = new Set<string>();
	/** Paths of the notes with tasks in the last render */
	private taskNotes = new Set<string>();

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

		const { workspace } = this.app;
		this.registerEvent(
			workspace.on("active-leaf-change", () => this.updateHarvestButton())
		);
		this.registerEvent(
			workspace.on("file-open", () => this.updateHarvestButton())
		);

		const onTasksChanged = debounce(() => this.render(), 500, true);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				if (!this.plugin.sidebarTasks.enabled()) return;
				if (
					this.taskNotes.has(file.path) ||
					cache.listItems?.some((item) => item.task !== undefined)
				) {
					onTasksChanged();
				}
			})
		);

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
		this.taskNotes.clear();
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
			Math.min(MAX_LOOK_BACK_DAYS, this.plugin.settings.lookBackDays)
		);
		const now = Date.now();
		const today = startOfDay(new Date(now));
		const todayKey = dayKey(today);
		const minKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - lookBack));
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

		this.renderHarvestButton(root);

		if (calendars.length === 0) {
			this.renderEmptyState(root);
			this.renderOpenTasks(root);
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
					timeFormat: this.plugin.settings.timeFormat,
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
			const date = new Date(focusedDate.getFullYear(), focusedDate.getMonth(), focusedDate.getDate() + i);
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

		this.renderOpenTasks(root);

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

	private renderHarvestButton(parent: HTMLElement): void {
		this.harvestButton = null;
		if (!this.plugin.settings.harvestEnabled) return;
		const btn = parent.createEl("button", {
			cls: "meetings-plus-harvest-btn",
			text: "Harvest this note",
		});
		btn.addEventListener("click", () => {
			void this.plugin.harvester.harvestActive();
		});
		this.harvestButton = btn;
		this.updateHarvestButton();
	}

	private updateHarvestButton(): void {
		if (!this.harvestButton) return;
		this.harvestButton.disabled = !this.plugin.harvester.activeNote();
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
			this.renderRow(body, meeting, calIndex);
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
			this.renderRow(body, meeting, calIndex);
		}
	}

	private renderRow(
		parent: HTMLElement,
		meeting: Meeting,
		calIndex: Map<string, CalendarConfig>
	): void {
		const calendar = calIndex.get(meeting.calendarId);
		const note = this.plugin.noteIndex.findNoteForMeeting(meeting, calendar);
		const sidebarTasks = this.plugin.sidebarTasks;
		const count = note && sidebarTasks.enabled() ? sidebarTasks.count(note) : null;
		const withTasks = note !== null && count !== null && count.total > 0;
		const expanded = withTasks && this.expandedNotes.has(note.path);
		renderMeetingRow({
			parent,
			meeting,
			calendar,
			hasNote: Boolean(note),
			tasks: withTasks
				? {
						open: count.open,
						expanded,
						onToggle: () => {
							if (expanded) this.expandedNotes.delete(note.path);
							else this.expandedNotes.add(note.path);
							this.render();
						},
					}
				: undefined,
			timeFormat: this.plugin.settings.timeFormat,
			onActivate: (m) => this.activate(m),
			onContextMenu: (m, evt) => this.showContextMenu(m, evt),
		});
		if (!withTasks) return;
		this.taskNotes.add(note.path);
		if (expanded) this.renderTaskList(parent, sidebarTasks.tasks(note) ?? [], false);
	}

	private renderTaskList(
		parent: HTMLElement,
		tasks: SidebarTask[],
		withNote: boolean
	): void {
		const list = parent.createDiv({ cls: "meetings-plus-tasks" });
		for (const task of tasks) {
			const item = list.createDiv({ cls: "meetings-plus-task" });
			if (task.done) item.addClass("meetings-plus-task-done");
			const box = item.createEl("input", {
				type: "checkbox",
				cls: "task-list-item-checkbox",
			});
			box.checked = task.done;
			box.addEventListener("click", () => {
				void this.toggleTask(task);
			});
			item.createSpan({ cls: "meetings-plus-task-text", text: task.text });
			if (!withNote) continue;
			const link = item.createEl("a", {
				cls: "meetings-plus-task-note",
				text: task.file.basename,
			});
			link.addEventListener("click", () => {
				const anchor = task.blockId ? `#^${task.blockId}` : "";
				void this.app.workspace.openLinkText(task.file.path + anchor, "", false);
			});
		}
	}

	/** The "Open tasks" section, and the read of any note text the lists still need. */
	private renderOpenTasks(parent: HTMLElement): void {
		const sidebarTasks = this.plugin.sidebarTasks;
		if (!sidebarTasks.enabled()) return;
		const days = Math.max(1, this.plugin.settings.harvestOpenTasksDays);
		const { tasks, more } = sidebarTasks.openTasks(days);
		if (tasks.length > 0) {
			const section = parent.createDiv({ cls: "meetings-plus-open-tasks" });
			section
				.createDiv({ cls: "meetings-plus-day-header" })
				.createSpan({ cls: "meetings-plus-day-label", text: "Open tasks" });
			this.renderTaskList(section, tasks, true);
			if (more > 0) {
				section.createDiv({
					cls: "meetings-plus-tasks-more",
					text: `and ${more} more`,
				});
			}
			for (const task of tasks) this.taskNotes.add(task.file.path);
		}
		void sidebarTasks.load().then((read) => {
			if (read) this.render();
		});
	}

	private async toggleTask(task: SidebarTask): Promise<void> {
		try {
			await this.plugin.sidebarTasks.toggle(task);
		} catch (e) {
			console.warn("[Meetings Plus] could not tick task", task.file.path, e);
			new Notice(`${PLUGIN_NAME}: could not update ${task.file.basename}`);
		}
		this.render();
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
		const calendar = this.plugin.settings.calendars.find(
			(c) => c.id === meeting.calendarId
		);
		return Boolean(
			this.plugin.noteIndex.findNoteForMeeting(meeting, calendar)
		);
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
	const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
	return dayKey(d) === dayKey(tomorrow);
}

function isYesterday(d: Date, today: Date): boolean {
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
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
