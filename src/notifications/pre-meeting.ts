import { App, Notice } from "obsidian";
import { CalendarConfig, Meeting } from "../types";
import { NoteIndex } from "../notes/duplicate-detector";

/**
 * Only schedule notifications for meetings within this horizon. setTimeout
 * silently overflows past ~24.85 days (32-bit int) and fires immediately,
 * which was spamming the user with notices for every meeting weeks/months
 * out. The manager re-runs reschedule() on every fetch (default every 15
 * min), so anything entering the next 25h gets picked up in time.
 */
const SCHEDULE_HORIZON_MS = 25 * 60 * 60 * 1000;

export interface NotificationDeps {
	app: App;
	noteIndex: NoteIndex;
	getCalendars: () => CalendarConfig[];
	getMeetings: () => Meeting[];
	getEnabled: () => boolean;
	getLeadMinutes: () => number;
	onClickMeeting: (meeting: Meeting) => void;
}

export class PreMeetingScheduler {
	private timeouts: number[] = [];

	constructor(private readonly deps: NotificationDeps) {}

	reschedule(): void {
		this.clear();
		if (!this.deps.getEnabled()) return;
		const leadMs = Math.max(0, this.deps.getLeadMinutes()) * 60_000;
		const now = Date.now();
		const horizon = now + SCHEDULE_HORIZON_MS;
		const meetings = this.deps.getMeetings();
		for (const meeting of meetings) {
			const fireAt = meeting.start.getTime() - leadMs;
			if (fireAt <= now) continue;
			if (fireAt > horizon) continue;
			if (this.deps.noteIndex.findExistingNote(meeting.dedupKey)) continue;
			const delay = fireAt - now;
			const handle = window.setTimeout(() => {
				this.notify(meeting);
			}, delay);
			this.timeouts.push(handle);
		}
	}

	clear(): void {
		for (const t of this.timeouts) window.clearTimeout(t);
		this.timeouts = [];
	}

	private notify(meeting: Meeting): void {
		const minutes = Math.max(
			0,
			Math.round((meeting.start.getTime() - Date.now()) / 60_000)
		);
		const text = `${meeting.title} starts in ${minutes} min — open prep note`;
		const notice = new Notice(text, 30_000);
		const el = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
		if (el) {
			el.addClass("meetings-plus-notice-clickable");
			el.addEventListener("click", () => {
				this.deps.onClickMeeting(meeting);
				notice.hide();
			});
		}
	}
}
