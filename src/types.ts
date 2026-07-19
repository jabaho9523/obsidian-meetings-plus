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
}

export interface Meeting {
	/** Stable dedup key: combination of ICS UID and recurrence start */
	dedupKey: string;
	/** ICS UID (may repeat across recurrences) */
	uid: string;
	/** Whether this meeting is an occurrence of a recurring event */
	recurring: boolean;
	/** Which calendar this meeting came from */
	calendarId: string;
	/** Meeting title (ICS SUMMARY) */
	title: string;
	/** Start datetime */
	start: Date;
	/** End datetime */
	end: Date;
	/** Whether this is an all-day event */
	allDay: boolean;
	/** Location string (ICS LOCATION) */
	location: string;
	/** Description / body (ICS DESCRIPTION) */
	description: string;
	/** Organizer display name */
	organizer: string;
	/** Attendee display names */
	attendees: string[];
	/** Detected Teams / Zoom / Meet / Webex link from description or location */
	meetingUrl: string;
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
