import { moment } from "../util/time";
import { CalendarConfig, Meeting } from "../types";

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
		case "duration":
			return String(
				Math.max(
					0,
					Math.round(
						(meeting.end.getTime() - meeting.start.getTime()) /
							60000
					)
				)
			);
		case "location":
			return meeting.location;
		case "meeting_url":
			return meeting.meetingUrl;
		case "description":
			return meeting.description;
		case "organizer":
			return meeting.organizer;
		case "attendees":
			return meeting.attendees.join(", ");
		case "attendees_list":
			return meeting.attendees.map((a) => `- ${a}`).join("\n");
		case "attendees_wikilinks":
			return meeting.attendees.map((a) => `[[${a}]]`).join(", ");
		case "calendar":
			return calendar.name;
		case "uid":
			return meeting.uid;
		case "dedup_key":
			return meeting.dedupKey;
		case "tags":
			return formatTagsYaml(calendar.tags);
		default:
			return "";
	}
}

function formatDate(d: Date, fmt: string | undefined): string {
	const fallback = fmt ? fmt : undefined;
	try {
		return moment(d).format(fallback);
	} catch {
		return d.toISOString();
	}
}

function formatTagsYaml(tags: string[]): string {
	if (!tags || tags.length === 0) return "[]";
	return `[${tags.join(", ")}]`;
}

export function sanitizeFilename(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
