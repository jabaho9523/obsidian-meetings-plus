import { CalendarConfig } from "./types";
import { SETTINGS_VERSION } from "./constants";

export interface MeetingsPlusSettings {
	version: number;
	refreshIntervalMinutes: number;
	requestTimeoutSeconds: number;
	lookAheadDays: number;
	/** How many past days the user can navigate back to. 0 disables. */
	lookBackDays: number;
	enableNotifications: boolean;
	notificationLeadMinutes: number;
	runTemplaterOnNewNotes: boolean;
	openDashboardOnStart: boolean;
	calendars: CalendarConfig[];
	/** Persisted cache. Keyed by calendarId. */
	cache: Record<string, PersistedCacheEntry>;
	/** dedupKeys hidden for the rest of today */
	skippedToday: { key: string; until: number }[];
}

export interface PersistedCacheEntry {
	fetchedAt: number;
	/** Serialized meetings — Date fields become ISO strings */
	meetings: SerializedMeeting[];
}

export interface SerializedMeeting {
	dedupKey: string;
	uid: string;
	/** Absent in caches written before 0.4.1 */
	recurring?: boolean;
	calendarId: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string;
	description: string;
	organizer: string;
	attendees: string[];
	meetingUrl: string;
}

export const DEFAULT_TEMPLATE = `---
type: meeting
calendar: {{calendar}}
date: {{date}}
start: {{start:HH:mm}}
end: {{end:HH:mm}}
attendees: [{{attendees}}]
organizer: {{organizer}}
meeting_uid: {{uid}}
meeting_dedup_key: {{dedup_key}}
tags: {{tags}}
cssclasses: [meetings-plus-note]
---

# {{title}}

**When**: {{start:YYYY-MM-DD HH:mm}} – {{end:HH:mm}} ({{duration}} min)
**Where**: {{location}}
**Link**: {{meeting_url}}

## Attendees
{{attendees_list}}

## Agenda


## Notes


## Action items

`;

export const DEFAULT_TITLE_PATTERN = "{{date}} - {{title}}";

export const DEFAULT_CALENDAR_COLOR = "#4a90e2";

export function makeDefaultCalendar(
	id: string,
	overrides: Partial<CalendarConfig> = {}
): CalendarConfig {
	return {
		id,
		name: "",
		url: "",
		color: DEFAULT_CALENDAR_COLOR,
		enabled: true,
		folder: "Meetings",
		template: DEFAULT_TEMPLATE,
		titlePattern: DEFAULT_TITLE_PATTERN,
		tags: [],
		noteDestination: "file",
		appendToDailyNote: false,
		excludeAllDay: true,
		...overrides,
	};
}

export const DEFAULT_SETTINGS: MeetingsPlusSettings = {
	version: SETTINGS_VERSION,
	refreshIntervalMinutes: 15,
	requestTimeoutSeconds: 10,
	lookAheadDays: 7,
	lookBackDays: 7,
	enableNotifications: false,
	notificationLeadMinutes: 5,
	runTemplaterOnNewNotes: false,
	openDashboardOnStart: false,
	calendars: [],
	cache: {},
	skippedToday: [],
};
