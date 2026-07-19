import { Meeting } from "../types";
import { PersistedCacheEntry, SerializedMeeting } from "../settings";

export interface CacheEntry {
	fetchedAt: number;
	meetings: Meeting[];
}

export class MeetingCache {
	private entries = new Map<string, CacheEntry>();

	constructor(initial: Record<string, PersistedCacheEntry> = {}) {
		for (const [calId, entry] of Object.entries(initial)) {
			this.entries.set(calId, {
				fetchedAt: entry.fetchedAt,
				meetings: entry.meetings.map(deserialize),
			});
		}
	}

	get(calendarId: string): CacheEntry | undefined {
		return this.entries.get(calendarId);
	}

	set(calendarId: string, meetings: Meeting[], fetchedAt: number): void {
		this.entries.set(calendarId, { fetchedAt, meetings });
	}

	clear(calendarId: string): void {
		this.entries.delete(calendarId);
	}

	getAll(): Meeting[] {
		const all: Meeting[] = [];
		for (const entry of this.entries.values()) {
			all.push(...entry.meetings);
		}
		all.sort((a, b) => a.start.getTime() - b.start.getTime());
		return all;
	}

	serialize(): Record<string, PersistedCacheEntry> {
		const out: Record<string, PersistedCacheEntry> = {};
		for (const [calId, entry] of this.entries.entries()) {
			out[calId] = {
				fetchedAt: entry.fetchedAt,
				meetings: entry.meetings.map(serialize),
			};
		}
		return out;
	}
}

function serialize(m: Meeting): SerializedMeeting {
	return {
		dedupKey: m.dedupKey,
		uid: m.uid,
		recurring: m.recurring,
		calendarId: m.calendarId,
		title: m.title,
		start: m.start.toISOString(),
		end: m.end.toISOString(),
		allDay: m.allDay,
		location: m.location,
		description: m.description,
		organizer: m.organizer,
		attendees: m.attendees,
		meetingUrl: m.meetingUrl,
	};
}

function deserialize(s: SerializedMeeting): Meeting {
	return {
		dedupKey: s.dedupKey,
		uid: s.uid,
		// Entries cached before the flag existed: assume recurring so the
		// reschedule fallback stays off until the next refresh re-parses.
		recurring: s.recurring ?? true,
		calendarId: s.calendarId,
		title: s.title,
		start: new Date(s.start),
		end: new Date(s.end),
		allDay: s.allDay,
		location: s.location,
		description: s.description,
		organizer: s.organizer,
		attendees: s.attendees,
		meetingUrl: s.meetingUrl,
	};
}
