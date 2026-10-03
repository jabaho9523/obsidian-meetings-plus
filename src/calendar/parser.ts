import ICAL from "ical.js";
import {
	AttendeeRole,
	AttendeeStatus,
	AttendeeType,
	BusyStatus,
	CalendarConfig,
	EventPrivacy,
	EventStatus,
	GeoPoint,
	Meeting,
	MeetingAttendee,
} from "../types";

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

interface MinimalProperty {
	name: string;
	getFirstValue(): unknown;
	getValues(): unknown[];
	getParameter(name: string): string | string[] | undefined;
}

interface MinimalComponent {
	getFirstPropertyValue<T>(name: string): T | null;
	getFirstProperty(name: string): MinimalProperty | null;
	getAllProperties(name?: string): MinimalProperty[];
	getAllSubcomponents(name: string): MinimalComponent[];
}

interface MinimalTime {
	toJSDate(): Date;
	isDate: boolean;
	zone?: { tzid?: string };
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
	if (calendar.excludeDeclined && meeting.myResponse === "declined") {
		return false;
	}
	if (calendar.excludeOutOfOffice && meeting.busyStatus === "oof") {
		return false;
	}
	if (calendar.excludeFreeTime && meeting.busyStatus === "free") return false;
	if (seen.has(meeting.dedupKey)) return false;
	seen.add(meeting.dedupKey);
	return true;
}

interface BuildOptions {
	/** The occurrence's own VEVENT — the override when one exists */
	source: MinimalEvent;
	/** The series master, used as a fallback for properties the override omits */
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
	const isException = Boolean(sc.getFirstProperty("recurrence-id"));

	/** Override value if the override defines one, else the master's. */
	const firstValue = <T>(name: string): T | null =>
		sc.getFirstPropertyValue<T>(name) ?? mc.getFirstPropertyValue<T>(name);
	const allProps = (name: string): MinimalProperty[] => {
		const own = sc.getAllProperties(name);
		return own.length > 0 ? own : mc.getAllProperties(name);
	};
	const allSubs = (name: string): MinimalComponent[] => {
		const own = sc.getAllSubcomponents(name);
		return own.length > 0 ? own : mc.getAllSubcomponents(name);
	};

	const allDay = Boolean(master.startDate?.isDate);
	const title =
		(source.summary ?? master.summary ?? "").toString().trim() ||
		"(no title)";
	const location = (source.location ?? master.location ?? "").toString();
	const description = stripHTML(
		(source.description ?? master.description ?? "").toString()
	);

	const organizerProp =
		sc.getFirstProperty("organizer") ?? mc.getFirstProperty("organizer");
	const organizerEmail = cleanContact(
		String(source.organizer ?? master.organizer ?? "")
	);
	const organizerName =
		firstParam(organizerProp, "cn") || organizerEmail || "";

	const attendeeDetails = allProps("attendee").map(parseAttendee);
	const attendees = attendeeDetails.map((a) => a.name).filter(Boolean);
	const myResponse = findOwnResponse(attendeeDetails, calendar.myEmail);

	const conferenceUrl =
		pickConferenceUrl(allProps("conference")) ||
		asString(firstValue<unknown>("x-google-conference"));
	const teamsUrl = asString(
		firstValue<unknown>("x-microsoft-skypeteamsmeetingurl")
	);
	const eventUrl = asString(firstValue<unknown>("url"));
	const meetingUrl =
		teamsUrl ||
		conferenceUrl ||
		detectMeetingUrl(location) ||
		detectMeetingUrl(description) ||
		detectMeetingUrl(eventUrl) ||
		detectGenericUrl(description) ||
		detectGenericUrl(location) ||
		detectGenericUrl(eventUrl) ||
		"";

	const categories: string[] = [];
	for (const prop of allProps("categories")) {
		for (const value of safeValues(prop)) {
			const text = asString(value).trim();
			if (text) categories.push(text);
		}
	}

	const rrule = mc.getFirstPropertyValue<unknown>("rrule");

	const dedupKey = `${calendar.id}::${master.uid}::${localDateKey(start)}`;
	const legacyDedupKey = `${calendar.id}::${master.uid}::${start
		.toISOString()
		.slice(0, 10)}`;

	return {
		dedupKey,
		legacyDedupKey,
		uid: master.uid,
		recurring,
		isException,
		calendarId: calendar.id,
		title,
		start,
		end,
		allDay,
		location,
		description,
		organizer: organizerName,
		organizerEmail,
		attendees,
		attendeeDetails,
		myResponse,
		meetingUrl,
		conferenceUrl,
		url: eventUrl,
		categories,
		status: normalizeStatus(asString(firstValue<unknown>("status"))),
		busyStatus: readBusyStatus(firstValue),
		privacy: normalizePrivacy(asString(firstValue<unknown>("class"))),
		priority: asNumber(firstValue<unknown>("priority")),
		sequence: asNumber(firstValue<unknown>("sequence")) ?? 0,
		created: asDate(firstValue<unknown>("created")),
		lastModified: asDate(firstValue<unknown>("last-modified")),
		timezone: readTimezone(master),
		recurrenceRule: rrule ? asString(rrule) : "",
		recurrenceText: describeRecurrence(rrule),
		geo: readGeo(firstValue<unknown>("geo")),
		attachments: allProps("attach")
			.map((p) => asString(p.getFirstValue()).trim())
			.filter(Boolean),
		reminderMinutes: readReminderMinutes(allSubs("valarm")),
	};
}

/** Local calendar day, so occurrence keys agree with what the sidebar shows. */
function localDateKey(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function firstParam(
	prop: MinimalProperty | null | undefined,
	name: string
): string {
	if (!prop) return "";
	let raw: string | string[] | undefined;
	try {
		raw = prop.getParameter(name);
	} catch {
		return "";
	}
	if (Array.isArray(raw)) return asString(raw[0]).trim();
	return asString(raw).trim();
}

function safeValues(prop: MinimalProperty): unknown[] {
	try {
		return prop.getValues();
	} catch {
		const single = prop.getFirstValue();
		return single === null || single === undefined ? [] : [single];
	}
}

function parseAttendee(prop: MinimalProperty): MeetingAttendee {
	const value = cleanContact(asString(prop.getFirstValue()).trim());
	const paramEmail = cleanContact(firstParam(prop, "email"));
	const email = value.includes("@") ? value : paramEmail;
	const cn = firstParam(prop, "cn");
	return {
		// Matches the historical behaviour: CN when present, else the address.
		name: cn || email || value,
		email,
		status: normalizePartstat(firstParam(prop, "partstat")),
		role: normalizeRole(firstParam(prop, "role")),
		type: normalizeCutype(firstParam(prop, "cutype")),
		rsvp: firstParam(prop, "rsvp").toUpperCase() === "TRUE",
	};
}

/**
 * Your own reply, found by matching the calendar's configured address against
 * the attendee list. Several addresses can be configured for accounts with
 * aliases; the first attendee that matches any of them wins.
 */
function findOwnResponse(
	attendees: MeetingAttendee[],
	myEmail: string | undefined
): AttendeeStatus {
	const mine = splitAddresses(myEmail);
	if (mine.length === 0) return "";
	for (const attendee of attendees) {
		const email = attendee.email.trim().toLowerCase();
		if (email && mine.includes(email)) return attendee.status;
	}
	return "";
}

function splitAddresses(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(/[,;\s]+/)
		.map((part) => cleanContact(part.trim()).toLowerCase())
		.filter(Boolean);
}

function normalizePartstat(raw: string): AttendeeStatus {
	switch (raw.toUpperCase()) {
		case "ACCEPTED":
			return "accepted";
		case "DECLINED":
			return "declined";
		case "TENTATIVE":
			return "tentative";
		case "DELEGATED":
			return "delegated";
		case "NEEDS-ACTION":
			return "needs-action";
		default:
			return "";
	}
}

function normalizeRole(raw: string): AttendeeRole {
	switch (raw.toUpperCase()) {
		case "CHAIR":
			return "chair";
		case "OPT-PARTICIPANT":
			return "optional";
		case "NON-PARTICIPANT":
			return "non-participant";
		default:
			// RFC 5545 default is REQ-PARTICIPANT.
			return "required";
	}
}

function normalizeCutype(raw: string): AttendeeType {
	switch (raw.toUpperCase()) {
		case "ROOM":
			return "room";
		case "RESOURCE":
			return "resource";
		case "GROUP":
			return "group";
		case "INDIVIDUAL":
		case "":
			return "individual";
		default:
			return "unknown";
	}
}

function normalizeStatus(raw: string): EventStatus {
	switch (raw.toUpperCase()) {
		case "TENTATIVE":
			return "tentative";
		case "CANCELLED":
			return "cancelled";
		default:
			return "confirmed";
	}
}

function normalizePrivacy(raw: string): EventPrivacy {
	switch (raw.toUpperCase()) {
		case "PRIVATE":
			return "private";
		case "CONFIDENTIAL":
			return "confidential";
		case "PUBLIC":
			return "public";
		default:
			return "";
	}
}

function readBusyStatus(
	firstValue: <T>(name: string) => T | null
): BusyStatus {
	const ms = asString(
		firstValue<unknown>("x-microsoft-cdo-busystatus")
	).toUpperCase();
	switch (ms) {
		case "FREE":
			return "free";
		case "TENTATIVE":
			return "tentative";
		case "BUSY":
			return "busy";
		case "OOF":
			return "oof";
		case "WORKINGELSEWHERE":
			return "working-elsewhere";
	}
	// TRANSP is the standards-compliant fallback: transparent means the event
	// does not block time.
	const transp = asString(firstValue<unknown>("transp")).toUpperCase();
	if (transp === "TRANSPARENT") return "free";
	if (transp === "OPAQUE") return "busy";
	return "";
}

/** Prefer a video conference entry, else the first CONFERENCE property. */
function pickConferenceUrl(props: MinimalProperty[]): string {
	let fallback = "";
	for (const prop of props) {
		const uri = asString(prop.getFirstValue()).trim();
		if (!uri) continue;
		if (!fallback) fallback = uri;
		if (firstParam(prop, "feature").toUpperCase().includes("VIDEO")) {
			return uri;
		}
	}
	return fallback;
}

function readTimezone(master: MinimalEvent): string {
	const param = firstParam(
		master.component.getFirstProperty("dtstart"),
		"tzid"
	);
	if (param) return param;
	return asString(master.startDate?.zone?.tzid).trim();
}

function readGeo(raw: unknown): GeoPoint | null {
	if (raw === null || raw === undefined) return null;
	let parts: unknown[];
	if (Array.isArray(raw)) {
		parts = raw;
	} else {
		parts = asString(raw).split(/[;,]/);
	}
	const lat = Number(parts[0]);
	const lon = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat, lon };
}

/** Minutes before the start that the first VALARM fires. */
function readReminderMinutes(alarms: MinimalComponent[]): number | null {
	for (const alarm of alarms) {
		const trigger = alarm.getFirstPropertyValue<unknown>("trigger");
		if (!trigger || typeof trigger !== "object") continue;
		const toSeconds = (trigger as { toSeconds?: unknown }).toSeconds;
		if (typeof toSeconds !== "function") continue;
		let seconds: number;
		try {
			seconds = Number(
				(toSeconds as () => number).call(trigger)
			);
		} catch {
			continue;
		}
		if (!Number.isFinite(seconds)) continue;
		// Negative durations mean "before the start", which is the only form
		// worth surfacing as a lead time.
		return Math.round(-seconds / 60);
	}
	return null;
}

const WEEKDAY_LABEL: Record<string, string> = {
	SU: "Sun",
	MO: "Mon",
	TU: "Tue",
	WE: "Wed",
	TH: "Thu",
	FR: "Fri",
	SA: "Sat",
};

const FREQ_UNIT: Record<string, string> = {
	SECONDLY: "second",
	MINUTELY: "minute",
	HOURLY: "hour",
	DAILY: "day",
	WEEKLY: "week",
	MONTHLY: "month",
	YEARLY: "year",
};

function describeRecurrence(rrule: unknown): string {
	if (!rrule || typeof rrule !== "object") return "";
	const rule = rrule as {
		freq?: string;
		interval?: number;
		count?: number;
		until?: unknown;
		parts?: Record<string, unknown>;
	};
	const unit = FREQ_UNIT[asString(rule.freq).toUpperCase()];
	if (!unit) return "";
	const interval =
		typeof rule.interval === "number" && rule.interval > 1
			? rule.interval
			: 1;
	let text = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;

	const byday = rule.parts?.["BYDAY"];
	if (Array.isArray(byday) && byday.length > 0) {
		const days = byday
			.map((d) => asString(d).toUpperCase().replace(/^[+-]?\d+/, ""))
			.map((d) => WEEKDAY_LABEL[d] ?? "")
			.filter(Boolean);
		if (days.length > 0) text += ` on ${days.join(", ")}`;
	}
	if (typeof rule.count === "number" && rule.count > 0) {
		text += `, ${rule.count} times`;
	}
	const until = asDate(rule.until);
	if (until) text += `, until ${localDateKey(until)}`;
	return text;
}

function asString(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	// ICAL.Recur, ICAL.Duration and friends serialize through their own
	// toString(). Anything left with the default one would only stringify to
	// "[object Object]", so treat it as absent.
	const toString = (value as { toString?: unknown }).toString;
	if (
		typeof toString === "function" &&
		toString !== Object.prototype.toString
	) {
		try {
			const out = (toString as () => unknown).call(value);
			return typeof out === "string" ? out : "";
		} catch {
			return "";
		}
	}
	return "";
}

function asNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/** ICAL.Time values expose toJSDate(); plain strings and Dates also occur. */
function asDate(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	if (typeof value === "object") {
		const toJSDate = (value as { toJSDate?: unknown }).toJSDate;
		if (typeof toJSDate === "function") {
			try {
				const d = (toJSDate as () => Date).call(value);
				return d instanceof Date && !Number.isNaN(d.getTime())
					? d
					: null;
			} catch {
				return null;
			}
		}
	}
	if (typeof value === "string") {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return null;
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
