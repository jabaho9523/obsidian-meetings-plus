import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
	PLUGIN_NAME,
	RIBBON_ICON,
	VIEW_TYPE_MEETINGS_PLUS,
} from "./constants";
import {
	MeetingsPlusSettings,
	DEFAULT_SETTINGS,
} from "./settings";
import { MeetingsPlusSettingTab } from "./settings-tab";
import { CalendarManager } from "./calendar/manager";
import { MeetingsPlusView } from "./ui/MeetingsPlusView";
import { Meeting } from "./types";
import { createOrOpenMeetingNote } from "./notes/creator";
import { updateDailyNote } from "./notes/daily-note";
import { PreMeetingScheduler } from "./notifications/pre-meeting";
import { NoteIndex } from "./notes/duplicate-detector";

export default class MeetingsPlusPlugin extends Plugin {
	settings!: MeetingsPlusSettings;
	manager!: CalendarManager;
	noteIndex!: NoteIndex;
	private scheduler!: PreMeetingScheduler;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.pruneSkipped();

		this.noteIndex = new NoteIndex(this);

		this.manager = new CalendarManager(
			this.app,
			() => this.settings,
			async () => {
				this.settings.cache = this.manager.cache.serialize();
				await this.saveData(this.settings);
			}
		);

		this.scheduler = new PreMeetingScheduler({
			app: this.app,
			noteIndex: this.noteIndex,
			getCalendars: () => this.settings.calendars,
			getMeetings: () => this.manager.getAllMeetings(),
			getEnabled: () => this.settings.enableNotifications,
			getLeadMinutes: () => this.settings.notificationLeadMinutes,
			onClickMeeting: (m) => {
				void this.openOrCreateNote(m);
			},
		});

		this.registerView(
			VIEW_TYPE_MEETINGS_PLUS,
			(leaf: WorkspaceLeaf) => new MeetingsPlusView(leaf, this)
		);

		this.addRibbonIcon(RIBBON_ICON, `Open ${PLUGIN_NAME}`, () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "refresh-calendars",
			name: "Refresh all calendars",
			callback: () => {
				void this.manager.refreshAll();
			},
		});

		this.addCommand({
			id: "create-note-next-meeting",
			name: "Create note for next meeting",
			callback: () => {
				const next = this.findNextMeeting();
				if (!next) {
					new Notice(`${PLUGIN_NAME}: no upcoming meetings`);
					return;
				}
				void this.openOrCreateNote(next);
			},
		});

		this.addCommand({
			id: "open-next-meeting-link",
			name: "Open next meeting link",
			callback: () => {
				const next = this.findNextMeeting();
				if (!next || !next.meetingUrl) {
					new Notice(`${PLUGIN_NAME}: no link on next meeting`);
					return;
				}
				window.open(next.meetingUrl, "_blank");
			},
		});

		this.addCommand({
			id: "update-daily-note",
			name: "Update today's daily note now",
			callback: () => {
				void (async () => {
					try {
						await this.refreshDailyNote();
						new Notice(`${PLUGIN_NAME}: daily note updated`);
					} catch (e) {
						console.warn(
							"[Meetings Plus] manual daily note update failed",
							e
						);
						new Notice(
							`${PLUGIN_NAME}: daily note update failed — check console`
						);
					}
				})();
			},
		});

		this.addSettingTab(new MeetingsPlusSettingTab(this.app, this));

		this.manager.events.on("refresh:completed", () => {
			this.scheduler.reschedule();
			void this.refreshDailyNote();
		});

		this.app.workspace.onLayoutReady(() => {
			this.manager.start();
			if (this.settings.openDashboardOnStart) {
				void this.activateView();
			}
		});
	}

	onunload(): void {
		this.scheduler?.clear();
		this.manager?.stop();
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<MeetingsPlusSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(loaded ?? {}),
			cache: { ...(loaded?.cache ?? {}) },
			calendars: (loaded?.calendars ?? []).map(migrateCalendar),
			skippedToday: loaded?.skippedToday ?? [],
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_MEETINGS_PLUS);
		if (existing.length > 0) {
			void workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf =
			workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({
			type: VIEW_TYPE_MEETINGS_PLUS,
			active: true,
		});
		void workspace.revealLeaf(leaf);
	}

	async openOrCreateNote(meeting: Meeting): Promise<void> {
		const calendar = this.settings.calendars.find(
			(c) => c.id === meeting.calendarId
		);
		if (!calendar) {
			new Notice(`${PLUGIN_NAME}: calendar not found`);
			return;
		}
		try {
			await createOrOpenMeetingNote({
				app: this.app,
				meeting,
				calendar,
				runTemplater: this.settings.runTemplaterOnNewNotes,
				openInNewPane: true,
				noteIndex: this.noteIndex,
			});
			void this.refreshDailyNote();
		} catch (e) {
			console.warn("[Meetings Plus] note creation failed", e);
			new Notice(`${PLUGIN_NAME}: failed to create note`);
		}
	}

	private findNextMeeting(): Meeting | null {
		const now = Date.now();
		for (const m of this.manager.getAllMeetings()) {
			if (m.end.getTime() > now) return m;
		}
		return null;
	}

	private pruneSkipped(): void {
		const now = Date.now();
		this.settings.skippedToday = this.settings.skippedToday.filter(
			(s) => s.until > now
		);
	}

	private async refreshDailyNote(): Promise<void> {
		try {
			await updateDailyNote({
				app: this.app,
				calendars: this.settings.calendars,
				meetings: this.manager.getAllMeetings(),
				timeFormat: this.settings.timeFormat,
				noteIndex: this.noteIndex,
			});
		} catch (e) {
			console.warn("[Meetings Plus] daily note update failed", e);
		}
	}
}

/**
 * Bring older calendar configs forward when the schema changes between
 * releases. Returning a new object keeps the input immutable.
 */
function migrateCalendar(c: unknown): import("./types").CalendarConfig {
	const obj = (c ?? {}) as Record<string, unknown>;
	const legacyCreateNotes = obj["createNotes"];
	const noteDestination = obj["noteDestination"];
	let destination: import("./types").NoteDestination;
	if (
		noteDestination === "file" ||
		noteDestination === "daily-note" ||
		noteDestination === "daily-note-event-date" ||
		noteDestination === "none"
	) {
		destination = noteDestination;
	} else if (legacyCreateNotes === false) {
		destination = "none";
	} else {
		destination = "file";
	}
	return {
		id: pickString(obj["id"], ""),
		name: pickString(obj["name"], ""),
		url: pickString(obj["url"], ""),
		color: pickString(obj["color"], "#4a90e2"),
		enabled: obj["enabled"] !== false,
		folder: pickString(obj["folder"], ""),
		template: pickString(obj["template"], ""),
		titlePattern: pickString(obj["titlePattern"], "{{date}} - {{title}}"),
		tags: Array.isArray(obj["tags"]) ? (obj["tags"] as string[]) : [],
		noteDestination: destination,
		appendToDailyNote: obj["appendToDailyNote"] === true,
		excludeAllDay: obj["excludeAllDay"] !== false,
	};
}

function pickString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}
