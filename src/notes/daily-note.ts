import { App, TFile, normalizePath } from "obsidian";
import { moment } from "../util/time";
import { CalendarConfig, Meeting, TimeFormat } from "../types";
import { findExistingNote } from "./duplicate-detector";
import { formatMeetingTime } from "../util/time";

const BLOCK_START = "<!-- meetings-plus:start -->";
const BLOCK_END = "<!-- meetings-plus:end -->";

interface DailyNotesPluginSettings {
	folder?: string;
	format?: string;
	template?: string;
}

interface InternalPluginShape {
	enabled?: boolean;
	instance?: { options?: DailyNotesPluginSettings };
}

export interface UpdateOptions {
	app: App;
	calendars: CalendarConfig[];
	meetings: Meeting[];
	timeFormat: TimeFormat;
}

export async function updateDailyNote(opts: UpdateOptions): Promise<void> {
	const { app, calendars, meetings, timeFormat } = opts;

	const eligibleCalendarIds = new Set(
		calendars
			.filter((c) => c.enabled && c.appendToDailyNote)
			.map((c) => c.id)
	);
	if (eligibleCalendarIds.size === 0) {
		console.warn(
			"[Meetings Plus] Daily note: no calendar has 'Append to daily note' enabled"
		);
		return;
	}

	const today = startOfDay(new Date());
	const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
	const todays = meetings
		.filter((m) => eligibleCalendarIds.has(m.calendarId))
		.filter((m) => m.start >= today && m.start < tomorrow)
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	const file = await ensureDailyNote(app);
	if (!file) {
		console.warn(
			"[Meetings Plus] Daily note: could not find or create today's daily note"
		);
		return;
	}

	const original = await app.vault.read(file);
	const next = replaceBlock(original, buildBlock(app, todays, timeFormat));
	if (next !== original) {
		await app.vault.modify(file, next);
	}
}

function buildBlock(
	app: App,
	meetings: Meeting[],
	timeFormat: TimeFormat
): string {
	const lines: string[] = [BLOCK_START, "## Today's meetings", ""];
	if (meetings.length === 0) {
		lines.push("- No meetings today.");
	} else {
		for (const m of meetings) {
			const time = formatMeetingTime(m.start, timeFormat);
			const existing = findExistingNote(app, m.dedupKey);
			if (existing) {
				lines.push(`- **${time}** [[${existing.basename}]]`);
			} else {
				lines.push(`- **${time}** ${m.title} (no notes yet)`);
			}
		}
	}
	lines.push(BLOCK_END);
	return lines.join("\n");
}

function replaceBlock(content: string, block: string): string {
	const startIdx = content.indexOf(BLOCK_START);
	const endIdx = content.indexOf(BLOCK_END);
	if (startIdx >= 0 && endIdx > startIdx) {
		const before = content.slice(0, startIdx);
		const after = content.slice(endIdx + BLOCK_END.length);
		return `${before}${block}${after}`;
	}
	const sep = content.endsWith("\n") || content.length === 0 ? "" : "\n";
	return `${content}${sep}\n${block}\n`;
}

export async function ensureDailyNote(
	app: App,
	date: Date = new Date()
): Promise<TFile | null> {
	const settings = getDailyNotesSettings(app);
	const format = settings?.format || "YYYY-MM-DD";
	const folder = (settings?.folder ?? "").trim();
	const filename = moment(date).format(format);
	const path = normalizePath(
		folder ? `${folder}/${filename}.md` : `${filename}.md`
	);

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;

	if (folder) {
		const folderPath = normalizePath(folder);
		if (!app.vault.getAbstractFileByPath(folderPath)) {
			try {
				await app.vault.createFolder(folderPath);
			} catch {
				/* ignore */
			}
		}
	}

	try {
		return await app.vault.create(path, "");
	} catch {
		return null;
	}
}

function getDailyNotesSettings(app: App): DailyNotesPluginSettings | null {
	const internal = (
		app as unknown as {
			internalPlugins?: {
				plugins?: Record<string, InternalPluginShape>;
			};
		}
	).internalPlugins;
	const plugin = internal?.plugins?.["daily-notes"];
	if (!plugin?.enabled) return null;
	return plugin.instance?.options ?? {};
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
