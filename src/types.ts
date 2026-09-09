import { TFile } from "obsidian";

/**
 * Where clicking a meeting writes its note.
 * - "file": separate .md file in the calendar's configured folder (default)
 * - "daily-note": appended as a section inside today's daily note
 * - "none": disabled — clicking just opens the meeting link if there is one
 */
export type NoteDestination =
	| "file"
	| "daily-note"
	| "daily-note-event-date"
	| "none";

export type TimeFormat = "24h" | "12h";

/** ICS ATTENDEE;PARTSTAT — how the invitee replied. "" when absent. */
export type AttendeeStatus =
	| "accepted"
	| "declined"
	| "tentative"
	| "delegated"
	| "needs-action"
	| "";

/** ICS ATTENDEE;ROLE — RFC 5545 defaults to REQ-PARTICIPANT. */
export type AttendeeRole = "chair" | "required" | "optional" | "non-participant";

/** ICS ATTENDEE;CUTYPE — separates people from booked rooms and equipment. */
export type AttendeeType =
	| "individual"
	| "group"
	| "room"
	| "resource"
	| "unknown";

/** ICS STATUS. CANCELLED events are dropped during parsing. */
export type EventStatus = "confirmed" | "tentative" | "cancelled";

/**
 * Free/busy intent. Read from X-MICROSOFT-CDO-BUSYSTATUS when present
 * (Outlook), otherwise derived from the standard TRANSP property.
 */
export type BusyStatus =
	| "free"
	| "tentative"
	| "busy"
	| "oof"
	| "working-elsewhere"
	| "";

/** ICS CLASS. */
export type EventPrivacy = "public" | "private" | "confidential" | "";

export interface GeoPoint {
	lat: number;
	lon: number;
}

export interface MeetingAttendee {
	/** CN parameter when present, otherwise the bare email address */
	name: string;
	/** Email address from the mailto: value or the EMAIL parameter */
	email: string;
	/** Reply state (PARTSTAT) */
	status: AttendeeStatus;
	/** Required / optional / chair (ROLE) */
	role: AttendeeRole;
	/** Person, room, or equipment (CUTYPE) */
	type: AttendeeType;
	/** Whether the organizer requested a reply (RSVP) */
	rsvp: boolean;
}

export interface CalendarConfig {
	/** Stable internal ID, generated when calendar is added */
	id: string;
	/** Display name shown in UI */
	name: string;
	/** ICS feed URL (may include basic auth: https://user:pass@host/cal.ics) */
	url: string;
	/** Color hex for visual distinction in the sidebar (e.g. "#4a90e2") */
	color: string;
	/** Enabled / disabled toggle */
	enabled: boolean;
	/** Folder where standalone meeting notes get created */
	folder: string;
	/** Template body — supports {{variable}} substitution */
	template: string;
	/** Note title pattern (e.g. "{{date}} - {{title}}") */
	titlePattern: string;
	/** Tags to add to frontmatter of every note from this calendar */
	tags: string[];
	/** Where new meeting notes go */
	noteDestination: NoteDestination;
	/** Also maintain a "## Today's meetings" index list inside the daily note */
	appendToDailyNote: boolean;
	/** Filter out all-day events */
	excludeAllDay: boolean;
	/**
	 * Your address on this feed, used to find your own ATTENDEE entry so
	 * `excludeDeclined` knows which reply is yours. Accepts several addresses
	 * separated by commas, for accounts with aliases.
	 */
	myEmail: string;
	/** Filter out meetings you replied DECLINED to. Needs `myEmail`. */
	excludeDeclined: boolean;
	/** Filter out out-of-office blocks */
	excludeOutOfOffice: boolean;
	/** Filter out events that do not block time (shown as free) */
	excludeFreeTime: boolean;
}

export interface Meeting {
	/** Stable dedup key: calendar id, ICS UID, and local occurrence date */
	dedupKey: string;
	/**
	 * dedupKey as written by versions <= 0.5.6, which used the UTC date and so
	 * named the wrong day for all-day and early-morning events east of UTC.
	 * Kept only so notes created back then are still recognized.
	 */
	legacyDedupKey: string;
	/** ICS UID (may repeat across recurrences) */
	uid: string;
	/** Whether this meeting is an occurrence of a recurring event */
	recurring: boolean;
	/** Whether this occurrence overrides the series (has a RECURRENCE-ID) */
	isException: boolean;
	/** Which calendar this meeting came from */
	calendarId: string;
	/** Meeting title (ICS SUMMARY) */
	title: string;
	/** Start datetime */
	start: Date;
	/** End datetime. For all-day events this is the exclusive DTEND. */
	end: Date;
	/** Whether this is an all-day event */
	allDay: boolean;
	/** Location string (ICS LOCATION) */
	location: string;
	/** Description / body (ICS DESCRIPTION) */
	description: string;
	/** Organizer display name (CN parameter, falling back to the address) */
	organizer: string;
	/** Organizer email address */
	organizerEmail: string;
	/** Attendee display names — kept for template backwards compatibility */
	attendees: string[];
	/** Full attendee records, including reply status, role, and type */
	attendeeDetails: MeetingAttendee[];
	/**
	 * Your own reply, matched via the calendar's `myEmail`. "" when no address
	 * is configured or the feed carries no attendee entry for you.
	 */
	myResponse: AttendeeStatus;
	/** Detected Teams / Zoom / Meet / Webex link from description or location */
	meetingUrl: string;
	/** RFC 7986 CONFERENCE URI, or the Google Meet X-property */
	conferenceUrl: string;
	/** ICS URL property — the event's canonical web page */
	url: string;
	/** ICS CATEGORIES, flattened across all properties */
	categories: string[];
	/** ICS STATUS (cancelled events never reach the UI) */
	status: EventStatus;
	/** Free/busy intent (Outlook X-property, or derived from TRANSP) */
	busyStatus: BusyStatus;
	/** ICS CLASS */
	privacy: EventPrivacy;
	/** ICS PRIORITY (0-9), null when unset */
	priority: number | null;
	/** ICS SEQUENCE — bumped by the organizer on every revision */
	sequence: number;
	/** ICS CREATED */
	created: Date | null;
	/** ICS LAST-MODIFIED */
	lastModified: Date | null;
	/** IANA timezone the event was authored in ("UTC", "floating", or "") */
	timezone: string;
	/** Raw RRULE, e.g. "FREQ=WEEKLY;BYDAY=TU" */
	recurrenceRule: string;
	/** Human-readable RRULE, e.g. "Every week on Tue" */
	recurrenceText: string;
	/** GEO coordinates */
	geo: GeoPoint | null;
	/** ATTACH URIs */
	attachments: string[];
	/** Lead time of the first VALARM, in minutes before the start */
	reminderMinutes: number | null;
	/** Has the user already created a note for this meeting? */
	existingNote?: TFile;
}

export type FetchStatus =
	| { kind: "idle" }
	| { kind: "fetching"; startedAt: number }
	| { kind: "success"; fetchedAt: number; count: number }
	| { kind: "error"; fetchedAt: number; message: string };

export interface CalendarStatus {
	calendarId: string;
	status: FetchStatus;
}
