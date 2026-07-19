import { Menu, setIcon } from "obsidian";
import { CalendarConfig, Meeting, TimeFormat } from "../../types";
import { formatMeetingTime } from "../../util/time";

export interface MeetingRowOptions {
	parent: HTMLElement;
	meeting: Meeting;
	calendar: CalendarConfig | undefined;
	hasNote: boolean;
	timeFormat: TimeFormat;
	onActivate: (meeting: Meeting) => void;
	onContextMenu: (meeting: Meeting, evt: MouseEvent) => void;
}

export function renderMeetingRow(opts: MeetingRowOptions): void {
	const { meeting, calendar, hasNote, timeFormat } = opts;
	const row = opts.parent.createDiv({ cls: "meetings-plus-row" });
	if (hasNote) row.addClass("meetings-plus-row-has-note");

	const dot = row.createDiv({ cls: "meetings-plus-calendar-dot" });
	if (calendar) dot.style.background = calendar.color;

	const time = row.createDiv({ cls: "meetings-plus-row-time" });
	if (meeting.allDay) {
		time.setText("All-day");
	} else {
		const startLabel = formatMeetingTime(meeting.start, timeFormat);
		const endLabel = formatMeetingTime(meeting.end, timeFormat);
		time.setText(`${startLabel}–${endLabel}`);
	}

	const main = row.createDiv({ cls: "meetings-plus-row-main" });
	main.createDiv({
		cls: "meetings-plus-row-title",
		text: meeting.title,
	});
	const metaParts: string[] = [];
	if (meeting.location) metaParts.push(meeting.location);
	if (meeting.attendees.length > 0) {
		metaParts.push(`${meeting.attendees.length} attendees`);
	}
	if (metaParts.length > 0) {
		main.createDiv({
			cls: "meetings-plus-row-meta",
			text: metaParts.join(" · "),
		});
	}

	const trail = row.createDiv({ cls: "meetings-plus-row-trail" });
	if (hasNote) {
		const icon = trail.createSpan({
			cls: "meetings-plus-row-icon",
			attr: { "aria-label": "Note exists" },
		});
		setIcon(icon, "file-check");
	}
	if (meeting.meetingUrl) {
		const link = trail.createSpan({
			cls: "meetings-plus-row-icon",
			attr: { "aria-label": "Has meeting link" },
		});
		setIcon(link, "video");
	}

	row.addEventListener("click", () => opts.onActivate(meeting));
	row.addEventListener("contextmenu", (evt) => {
		evt.preventDefault();
		opts.onContextMenu(meeting, evt);
	});
}

export function buildRowContextMenu(
	meeting: Meeting,
	handlers: {
		onCreateOrOpen: () => void;
		onOpenLink: (() => void) | null;
		onCopyLink: (() => void) | null;
		onSkip: () => void;
	}
): Menu {
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle("Create / open note")
			.setIcon("file-plus-2")
			.onClick(handlers.onCreateOrOpen)
	);
	if (handlers.onOpenLink) {
		menu.addItem((item) =>
			item
				.setTitle("Open meeting link")
				.setIcon("video")
				.onClick(handlers.onOpenLink!)
		);
	}
	if (handlers.onCopyLink) {
		menu.addItem((item) =>
			item
				.setTitle("Copy meeting link")
				.setIcon("copy")
				.onClick(handlers.onCopyLink!)
		);
	}
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Skip (don't show again today)")
			.setIcon("eye-off")
			.onClick(handlers.onSkip)
	);
	void meeting;
	return menu;
}
