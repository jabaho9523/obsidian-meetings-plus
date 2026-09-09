import { moment } from "../util/time";
import { CalendarConfig, Meeting, MeetingAttendee } from "../types";

export interface TemplateContext {
	meeting: Meeting;
	calendar: CalendarConfig;
}

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]+))?\s*\}\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
	return template.replace(VAR_RE, (_match, name: string, fmt?: string) => {
		const value = resolveVariable(name, fmt, ctx);
		return value;
	});
}

function resolveVariable(
	name: string,
	fmt: string | undefined,
	ctx: TemplateContext
): string {
	const { meeting, calendar } = ctx;
	switch (name) {
		case "title":
			return meeting.title;
		case "date":
			return formatDate(meeting.start, "YYYY-MM-DD");
		case "start":
			return formatDate(meeting.start, fmt);
		case "end":
			return formatDate(meeting.end, fmt);
		case "end_date":
			// All-day DTEND is exclusive, so the last day the event covers is
			// one instant before it. Harmless for timed events.
			return formatDate(
				new Date(meeting.end.getTime() - 1),
				fmt ?? "YYYY-MM-DD"
			);
		case "duration":
			return String(durationMinutes(meeting));
		case "duration_hm":
			return formatDurationHM(durationMinutes(meeting));
		case "location":
			return meeting.location;
		case "meeting_url":
			return meeting.meetingUrl;
		case "conference_url":
			return meeting.conferenceUrl;
		case "event_url":
			return meeting.url;
		case "description":
			return meeting.description;
		case "organizer":
			return meeting.organizer;
		case "organizer_email":
			return meeting.organizerEmail;
		case "attendees":
			return meeting.attendees.join(", ");
		case "attendees_list":
			return meeting.attendees.map((a) => `- ${a}`).join("\n");
		case "attendees_wikilinks":
			return meeting.attendees.map((a) => `[[${a}]]`).join(", ");
		case "attendees_emails":
			return people(meeting)
				.map((a) => a.email)
				.filter(Boolean)
				.join(", ");
		case "attendees_table":
			return attendeesTable(meeting);
		case "attendee_count":
			return String(people(meeting).length);
		case "required_attendees":
			return names(people(meeting).filter((a) => a.role !== "optional"));
		case "optional_attendees":
			return names(people(meeting).filter((a) => a.role === "optional"));
		case "attendees_accepted":
			return names(byStatus(meeting, "accepted"));
		case "attendees_declined":
			return names(byStatus(meeting, "declined"));
		case "attendees_tentative":
			return names(byStatus(meeting, "tentative"));
		case "attendees_pending":
			return names(byStatus(meeting, "needs-action"));
		case "rooms":
			return names(
				meeting.attendeeDetails.filter(
					(a) => a.type === "room" || a.type === "resource"
				)
			);
		case "categories":
			return meeting.categories.join(", ");
		case "categories_yaml":
			return formatListYaml(meeting.categories);
		case "status":
			return meeting.status;
		case "busy_status":
			return meeting.busyStatus;
		case "privacy":
			return meeting.privacy;
		case "priority":
			return meeting.priority === null ? "" : String(meeting.priority);
		case "sequence":
			return String(meeting.sequence);
		case "created":
			return meeting.created ? formatDate(meeting.created, fmt) : "";
		case "last_modified":
			return meeting.lastModified
				? formatDate(meeting.lastModified, fmt)
				: "";
		case "timezone":
			return meeting.timezone;
		case "recurrence":
			return meeting.recurrenceText;
		case "recurrence_rule":
			return meeting.recurrenceRule;
		case "is_recurring":
			return String(meeting.recurring);
		case "is_exception":
			return String(meeting.isException);
		case "all_day":
			return String(meeting.allDay);
		case "reminder_minutes":
			return meeting.reminderMinutes === null
				? ""
				: String(meeting.reminderMinutes);
		case "geo":
			return meeting.geo ? `${meeting.geo.lat}, ${meeting.geo.lon}` : "";
		case "geo_url":
			return meeting.geo
				? `https://www.openstreetmap.org/?mlat=${meeting.geo.lat}&mlon=${meeting.geo.lon}`
				: "";
		case "attachments":
			return meeting.attachments.join(", ");
		case "attachments_list":
			return meeting.attachments.map((a) => `- ${a}`).join("\n");
		case "calendar":
			return calendar.name;
		case "uid":
			return meeting.uid;
		case "dedup_key":
			return meeting.dedupKey;
		case "tags":
			return formatListYaml(calendar.tags);
		default:
			return "";
	}
}

function durationMinutes(meeting: Meeting): number {
	return Math.max(
		0,
		Math.round((meeting.end.getTime() - meeting.start.getTime()) / 60000)
	);
}

function formatDurationHM(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/** Attendees that are actual people, i.e. not booked rooms or equipment. */
function people(meeting: Meeting): MeetingAttendee[] {
	return meeting.attendeeDetails.filter(
		(a) => a.type !== "room" && a.type !== "resource"
	);
}

function byStatus(meeting: Meeting, status: string): MeetingAttendee[] {
	return people(meeting).filter((a) => a.status === status);
}

function names(attendees: MeetingAttendee[]): string {
	return attendees
		.map((a) => a.name)
		.filter(Boolean)
		.join(", ");
}

function attendeesTable(meeting: Meeting): string {
	const rows = meeting.attendeeDetails;
	if (rows.length === 0) return "";
	const lines = ["| Name | Response | Role |", "| --- | --- | --- |"];
	for (const a of rows) {
		const label = a.type === "room" || a.type === "resource" ? a.type : a.role;
		lines.push(
			`| ${escapeCell(a.name)} | ${a.status || "—"} | ${label} |`
		);
	}
	return lines.join("\n");
}

function escapeCell(value: string): string {
	return value.replace(/\|/g, "\\|");
}

function formatDate(d: Date, fmt: string | undefined): string {
	const fallback = fmt ? fmt : undefined;
	try {
		return moment(d).format(fallback);
	} catch {
		return d.toISOString();
	}
}

function formatListYaml(values: string[]): string {
	if (!values || values.length === 0) return "[]";
	return `[${values.join(", ")}]`;
}

export function sanitizeFilename(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
