import ICAL from "ical.js";
import { CalendarConfig, Meeting } from "../types";

const MEETING_URL_PATTERNS: RegExp[] = [
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i,
	/https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s"'<>]+/i,
	/https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i,
	/https:\/\/[a-z0-9.-]*webex\.com\/(?:meet|wbxmjs|join)\/[^\s"'<>]+/i,
];

const GENERIC_URL = /https?:\/\/[^\s"'<>]+/i;

const MAX_RECURRENCE_OCCURRENCES = 500;
// Unseeded iterators start at DTSTART, so a years-old daily event can have
// thousands of pre-window occurrences to skip. Skips are bounded separately
// from emitted occurrences so old events don't exhaust the budget (PR #9).
const MAX_RECURRENCE_ITERATIONS = 10_000;

/**
 * Microsoft/Outlook uses proprietary timezone labels that ical.js does not
 * recognize. The accompanying VTIMEZONE blocks define correct DST rules; we
 * just rewrite the label so ical.js can register them under an IANA name and
 * resolve recurrences properly.
 */
const MS_TZID_MAP: Record<string, string> = {
	"W. Europe Standard Time": "Europe/Berlin",
	"Central Europe Standard Time": "Europe/Budapest",
	"Central European Standard Time": "Europe/Warsaw",
	"Romance Standard Time": "Europe/Paris",
	"GMT Standard Time": "Europe/London",
	"Greenwich Standard Time": "Atlantic/Reykjavik",
	"FLE Standard Time": "Europe/Helsinki",
	"E. Europe Standard Time": "Europe/Bucharest",
	"GTB Standard Time": "Europe/Athens",
	"Russian Standard Time": "Europe/Moscow",
	"Turkey Standard Time": "Europe/Istanbul",
	"Israel Standard Time": "Asia/Jerusalem",
	"Egypt Standard Time": "Africa/Cairo",
	"South Africa Standard Time": "Africa/Johannesburg",
	"UTC": "UTC",
	"Pacific Standard Time": "America/Los_Angeles",
	"Mountain Standard Time": "America/Denver",
	"Central Standard Time": "America/Chicago",
	"Eastern Standard Time": "America/New_York",
	"Atlantic Standard Time": "America/Halifax",
	"Newfoundland Standard Time": "America/St_Johns",
	"SA Pacific Standard Time": "America/Bogota",
	"SA Eastern Standard Time": "America/Cayenne",
	"Hawaiian Standard Time": "Pacific/Honolulu",
	"Alaskan Standard Time": "America/Anchorage",
	"China Standard Time": "Asia/Shanghai",
	"Tokyo Standard Time": "Asia/Tokyo",
	"Korea Standard Time": "Asia/Seoul",
	"India Standard Time": "Asia/Kolkata",
	"Singapore Standard Time": "Asia/Singapore",
	"Taipei Standard Time": "Asia/Taipei",
	"AUS Eastern Standard Time": "Australia/Sydney",
	"AUS Central Standard Time": "Australia/Darwin",
	"E. Australia Standard Time": "Australia/Brisbane",
	"W. Australia Standard Time": "Australia/Perth",
	"New Zealand Standard Time": "Pacific/Auckland",
	"Arabian Standard Time": "Asia/Dubai",
	"Arab Standard Time": "Asia/Riyadh",
	"Iran Standard Time": "Asia/Tehran",
};

function rewriteOutlookTzids(ics: string): string {
	let out = ics;
	for (const [ms, iana] of Object.entries(MS_TZID_MAP)) {
		const escaped = ms.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// VTIMEZONE block header: "TZID:W. Europe Standard Time"
		out = out.replace(
			new RegExp(`^TZID:${escaped}\\s*$`, "gm"),
			`TZID:${iana}`
		);
		// Property parameter, quoted or unquoted: TZID="W. Europe Standard Time"
		out = out.replace(
			new RegExp(`TZID="${escaped}"`, "g"),
			`TZID="${iana}"`
		);
		out = out.replace(
			new RegExp(`TZID=${escaped}(?=[:;])`, "g"),
			`TZID=${iana}`
		);
	}
	return out;
}

interface AttendeeProperty {
	name: string;
	getFirstValue(): unknown;
	getParameter(name: string): string | undefined;
}

interface MinimalComponent {
	getFirstPropertyValue<T>(name: string): T | null;
	getAllProperties(name?: string): AttendeeProperty[];
}

interface MinimalTime {
	toJSDate(): Date;
	isDate: boolean;
}

interface MinimalEvent {
	uid: string;
	summary: string;
	location: string;
	description: string;
	organizer: string;
	startDate: MinimalTime;
	endDate: MinimalTime;
	component: MinimalComponent;
	isRecurring(): boolean;
	iterator(start?: MinimalTime): { next(): MinimalTime | null };
	getOccurrenceDetails(time: MinimalTime): {
		startDate: MinimalTime;
		endDate: MinimalTime;
		item: MinimalEvent;
	};
}

export interface ParseOptions {
	calendar: CalendarConfig;
	windowStart: Date;
	windowEnd: Date;
}

export function parseICS(ics: string, opts: ParseOptions): Meeting[] {
	const { calendar, windowStart, windowEnd } = opts;

	const jcal = ICAL.parse(rewriteOutlookTzids(ics));
	const root = new ICAL.Component(jcal);

	for (const vtz of root.getAllSubcomponents("vtimezone")) {
		const tzid = vtz.getFirstPropertyValue<string>("tzid");
		if (tzid && !ICAL.TimezoneService.has(tzid)) {
			try {
				ICAL.TimezoneService.register(vtz);
			} catch {
				/* ignore */
			}
		}
	}

	const meetings: Meeting[] = [];
	const seen = new Set<string>();

	// UIDs that have a series master in this feed. Used to tell an override
	// whose master we will expand anyway from an orphaned one we must keep.
	const vevents = root.getAllSubcomponents("vevent");
	const seriesUids = new Set<string>();
	for (const vevent of vevents) {
		if (!vevent.getFirstProperty("rrule")) continue;
		const uid = vevent.getFirstPropertyValue<string>("uid");
		if (uid) seriesUids.add(uid);
	}

	for (const vevent of vevents) {
		const event = new ICAL.Event(vevent) as unknown as MinimalEvent;
		const status = vevent.getFirstPropertyValue<string>("status");
		if (status === "CANCELLED") continue;

		if (event.isRecurring()) {
			const masterStart = event.startDate.toJSDate();
			const masterEnd = event.endDate.toJSDate();
			const masterAllDay = event.startDate.isDate;
			const masterHours = masterStart.getHours();
			const masterMinutes = masterStart.getMinutes();
			const masterDurationMs =
				masterEnd.getTime() - masterStart.getTime();

			// Do not seed the iterator with windowStart — doing so resets the
			// recurrence epoch and breaks INTERVAL>1 patterns (e.g.
			// FREQ=MONTHLY;INTERVAL=2 starting in February would skip June).
			// The existing `end <= windowStart` filter below handles skipping
			// past occurrences correctly without perturbing the epoch.
			const iter = event.iterator();
			let emitted = 0;
			let iterations = 0;
			// Decided once, from the first occurrence — see the note below.
			let iteratorDroppedTime = false;
			while (
				emitted < MAX_RECURRENCE_OCCURRENCES &&
				iterations < MAX_RECURRENCE_ITERATIONS
			) {
				iterations++;
				const next = iter.next();
				if (!next) break;
				let start: Date;
				let end: Date;
				let source = event;
				let overrideCancelled = false;
				try {
					const details = event.getOccurrenceDetails(next);
					start = details.startDate.toJSDate();
					end = details.endDate.toJSDate();
					// An overridden occurrence carries its own VEVENT, which
					// may have a different summary, location, or attendee list
					// than the series master. Read the occurrence's own data.
					source = details.item ?? event;
					// Single-occurrence cancellation: the override VEVENT has
					// its own STATUS:CANCELLED. ical.js still iterates the slot,
					// so we have to check the override item ourselves.
					const overrideStatus =
						source.component.getFirstPropertyValue<string>(
							"status"
						);
					if (overrideStatus === "CANCELLED") {
						overrideCancelled = true;
					}
				} catch {
					start = next.toJSDate();
					end = new Date(start.getTime() + masterDurationMs);
				}
				if (overrideCancelled) continue;
				// The first occurrence of an RRULE is DTSTART itself, so it
				// must carry the master's time-of-day. If it comes back at
				// local midnight instead, the iterator lost the time for the
				// whole series (an unmapped timezone label) and every
				// occurrence needs it restored. Deciding this once — rather
				// than per occurrence — is what keeps a legitimately
				// midnight-shifted occurrence intact: an event whose UTC
				// offset difference happens to land it on 00:00 local (and
				// therefore on the neighbouring calendar day) is correct as
				// computed and must not be rewritten.
				if (iterations === 1) {
					iteratorDroppedTime =
						!masterAllDay &&
						(masterHours !== 0 || masterMinutes !== 0) &&
						start.getHours() === 0 &&
						start.getMinutes() === 0;
				}
				if (iteratorDroppedTime) {
					const fixed = new Date(
						start.getFullYear(),
						start.getMonth(),
						start.getDate()
					);
					fixed.setHours(masterHours, masterMinutes, 0, 0);
					const shiftMs = fixed.getTime() - start.getTime();
					start = fixed;
					end = new Date(end.getTime() + shiftMs);
				}
				if (start >= windowEnd) break;
				if (end <= windowStart) continue;
				emitted++;
				const meeting = buildMeeting({
					source,
					master: event,
					start,
					end,
					calendar,
					recurring: true,
				});
				if (acceptable(meeting, calendar, seen)) meetings.push(meeting);
			}
		} else {
			// Override components (RECURRENCE-ID without an RRULE) are emitted
			// by their master's iterator above, so skip them here — otherwise
			// they double-count, and the master's stale copy of the occurrence
			// can win the dedup and shadow the edited one. An override whose
			// master is missing from the feed is still the only record of that
			// occurrence, so it is kept.
			if (
				vevent.getFirstProperty("recurrence-id") &&
				seriesUids.has(event.uid)
			) {
				continue;
			}
			const start = event.startDate.toJSDate();
			const end = event.endDate.toJSDate();
			if (end <= windowStart || start >= windowEnd) continue;
			const meeting = buildMeeting({
				source: event,
				master: event,
				start,
				end,
				calendar,
				recurring: false,
			});
			if (acceptable(meeting, calendar, seen)) meetings.push(meeting);
		}
	}

	meetings.sort((a, b) => a.start.getTime() - b.start.getTime());
	return meetings;
}

function acceptable(
	meeting: Meeting,
	calendar: CalendarConfig,
	seen: Set<string>
): boolean {
	if (calendar.excludeAllDay && meeting.allDay) return false;
	if (seen.has(meeting.dedupKey)) return false;
	seen.add(meeting.dedupKey);
	return true;
}

interface BuildOptions {
	/** The occurrence's own VEVENT — the override when one exists */
	source: MinimalEvent;
	/** The series master, a fallback for properties the override omits */
	master: MinimalEvent;
	start: Date;
	end: Date;
	calendar: CalendarConfig;
	recurring: boolean;
}

function buildMeeting(opts: BuildOptions): Meeting {
	const { source, master, start, end, calendar, recurring } = opts;
	const sc = source.component;
	const mc = master.component;

	const allDay = Boolean(master.startDate?.isDate);
	const title =
		(source.summary ?? master.summary ?? "").toString().trim() ||
		"(no title)";
	const location = (source.location ?? master.location ?? "").toString();
	const description = stripHTML(
		(source.description ?? master.description ?? "").toString()
	);
	const organizer = cleanContact(
		String(source.organizer ?? master.organizer ?? "")
	);

	// An override that omits a property inherits the master's value.
	const ownAttendees = sc.getAllProperties("attendee");
	const attendeeProps =
		ownAttendees.length > 0
			? ownAttendees
			: mc.getAllProperties("attendee");

	const attendees: string[] = [];
	for (const prop of attendeeProps) {
		const cn = prop.getParameter("cn");
		if (cn) {
			attendees.push(cn);
			continue;
		}
		const v = prop.getFirstValue();
		if (typeof v === "string") attendees.push(cleanContact(v));
	}

	const teamsUrl =
		sc.getFirstPropertyValue<string>(
			"x-microsoft-skypeteamsmeetingurl"
		) ??
		mc.getFirstPropertyValue<string>(
			"x-microsoft-skypeteamsmeetingurl"
		);
	const meetingUrl =
		(teamsUrl && String(teamsUrl)) ||
		detectMeetingUrl(location) ||
		detectMeetingUrl(description) ||
		detectGenericUrl(description) ||
		detectGenericUrl(location) ||
		"";

	const startISO = start.toISOString().slice(0, 10);
	const dedupKey = `${calendar.id}::${master.uid}::${startISO}`;

	return {
		dedupKey,
		uid: master.uid,
		recurring,
		calendarId: calendar.id,
		title,
		start,
		end,
		allDay,
		location,
		description,
		organizer,
		attendees,
		meetingUrl,
	};
}

function detectMeetingUrl(text: string): string {
	if (!text) return "";
	for (const re of MEETING_URL_PATTERNS) {
		const m = re.exec(text);
		if (m) return m[0];
	}
	return "";
}

function detectGenericUrl(text: string): string {
	if (!text) return "";
	const m = GENERIC_URL.exec(text);
	return m ? m[0] : "";
}

function stripHTML(input: string): string {
	if (!input) return "";
	return input
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\r\n/g, "\n")
		.trim();
}

function cleanContact(raw: string): string {
	if (!raw) return "";
	return raw.replace(/^mailto:/i, "");
}
