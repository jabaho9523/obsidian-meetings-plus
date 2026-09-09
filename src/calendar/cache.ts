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
		legacyDedupKey: m.legacyDedupKey,
		uid: m.uid,
		recurring: m.recurring,
		isException: m.isException,
		calendarId: m.calendarId,
		title: m.title,
		start: m.start.toISOString(),
		end: m.end.toISOString(),
		allDay: m.allDay,
		location: m.location,
		description: m.description,
		organizer: m.organizer,
		organizerEmail: m.organizerEmail,
		attendees: m.attendees,
		attendeeDetails: m.attendeeDetails,
		meetingUrl: m.meetingUrl,
		conferenceUrl: m.conferenceUrl,
		url: m.url,
		categories: m.categories,
		status: m.status,
		busyStatus: m.busyStatus,
		privacy: m.privacy,
		priority: m.priority,
		sequence: m.sequence,
		created: m.created ? m.created.toISOString() : null,
		lastModified: m.lastModified ? m.lastModified.toISOString() : null,
		timezone: m.timezone,
		recurrenceRule: m.recurrenceRule,
		recurrenceText: m.recurrenceText,
		geo: m.geo,
		attachments: m.attachments,
		reminderMinutes: m.reminderMinutes,
	};
}

function deserialize(s: SerializedMeeting): Meeting {
	const start = new Date(s.start);
	return {
		dedupKey: s.dedupKey,
		// Caches from 0.5.6 and earlier predate the local-date key, so the
		// key they hold is itself the legacy one.
		legacyDedupKey: s.legacyDedupKey ?? s.dedupKey,
		uid: s.uid,
		// Entries cached before the flag existed: assume recurring so the
		// reschedule fallback stays off until the next refresh re-parses.
		recurring: s.recurring ?? true,
		isException: s.isException ?? false,
		calendarId: s.calendarId,
		title: s.title,
		start,
		end: new Date(s.end),
		allDay: s.allDay,
		location: s.location,
		description: s.description,
		organizer: s.organizer,
		organizerEmail: s.organizerEmail ?? "",
		attendees: s.attendees,
		attendeeDetails:
			s.attendeeDetails ??
			s.attendees.map((name) => ({
				name,
				email: name.includes("@") ? name : "",
				status: "" as const,
				role: "required" as const,
				type: "individual" as const,
				rsvp: false,
			})),
		meetingUrl: s.meetingUrl,
		conferenceUrl: s.conferenceUrl ?? "",
		url: s.url ?? "",
		categories: s.categories ?? [],
		status: s.status ?? "confirmed",
		busyStatus: s.busyStatus ?? "",
		privacy: s.privacy ?? "",
		priority: s.priority ?? null,
		sequence: s.sequence ?? 0,
		created: s.created ? new Date(s.created) : null,
		lastModified: s.lastModified ? new Date(s.lastModified) : null,
		timezone: s.timezone ?? "",
		recurrenceRule: s.recurrenceRule ?? "",
		recurrenceText: s.recurrenceText ?? "",
		geo: s.geo ?? null,
		attachments: s.attachments ?? [],
		reminderMinutes: s.reminderMinutes ?? null,
	};
}
