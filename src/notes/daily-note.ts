import { App, TFile, normalizePath } from "obsidian";
import {
	appHasDailyNotesPluginLoaded,
	createDailyNote,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import { moment } from "../util/time";
import { CalendarConfig, Meeting, TimeFormat } from "../types";
import { NoteIndex } from "./duplicate-detector";
import { formatMeetingTime } from "../util/time";
import { runTemplaterIfAvailable } from "../integrations/templater";

const BLOCK_START = "<!-- meetings-plus:start -->";
const BLOCK_END = "<!-- meetings-plus:end -->";

export interface EnsuredDailyNote {
	file: TFile;
	created: boolean;
}

const pendingDailyNoteCreations = new WeakMap<
	App,
	Map<string, Promise<EnsuredDailyNote | null>>
>();
const pendingDailyNoteUpdates = new WeakMap<App, Promise<void>>();

export interface UpdateOptions {
	app: App;
	calendars: CalendarConfig[];
	meetings: Meeting[];
	timeFormat: TimeFormat;
	noteIndex: NoteIndex;
	runTemplater: boolean;
}

export function updateDailyNote(opts: UpdateOptions): Promise<void> {
	const previous = pendingDailyNoteUpdates.get(opts.app) ?? Promise.resolve();
	const current = previous
		.catch(() => undefined)
		.then(() => updateDailyNoteOnce(opts));
	pendingDailyNoteUpdates.set(opts.app, current);
	return current.finally(() => {
		if (pendingDailyNoteUpdates.get(opts.app) === current) {
			pendingDailyNoteUpdates.delete(opts.app);
		}
	});
}

async function updateDailyNoteOnce(opts: UpdateOptions): Promise<void> {
	const { app, calendars, meetings, timeFormat, noteIndex, runTemplater } = opts;

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
	const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
	const todays = meetings
		.filter((m) => eligibleCalendarIds.has(m.calendarId))
		.filter((m) => m.start >= today && m.start < tomorrow)
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	const dailyNote = await ensureDailyNote(app);
	if (!dailyNote) {
		console.warn(
			"[Meetings Plus] Daily note: could not find or create today's daily note"
		);
		return;
	}
	const { file, created } = dailyNote;

	const original = await app.vault.read(file);
	const next = replaceBlock(original, buildBlock(app, todays, timeFormat, noteIndex));
	if (next !== original) {
		await app.vault.modify(file, next);
	}
	if (created && runTemplater) {
		try {
			await runTemplaterIfAvailable(app, file);
		} catch (e) {
			console.warn(
				"[Meetings Plus] Templater post-processing failed for the daily note",
				e
			);
		}
	}
}

function buildBlock(
	app: App,
	meetings: Meeting[],
	timeFormat: TimeFormat,
	noteIndex: NoteIndex
): string {
	const lines: string[] = [BLOCK_START, "## Today's meetings", ""];
	if (meetings.length === 0) {
		lines.push("- No meetings today.");
	} else {
		for (const m of meetings) {
			const time = formatMeetingTime(m.start, timeFormat);
			const existing = noteIndex.findNoteForMeeting(m);
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
): Promise<EnsuredDailyNote | null> {
	if (!appHasDailyNotesPluginLoaded()) {
		console.warn(
			"[Meetings Plus] Daily note: no Daily Notes or Periodic Notes plugin is enabled"
		);
		return null;
	}

	let settings: ReturnType<typeof getDailyNoteSettings>;
	try {
		settings = getDailyNoteSettings();
	} catch (error) {
		console.warn("[Meetings Plus] Daily note: could not read note settings", error);
		return null;
	}
	const format = settings?.format || "YYYY-MM-DD";
	const folder = (settings?.folder ?? "").trim();
	const filename = moment(date).format(format);
	const path = normalizePath(
		folder ? `${folder}/${filename}.md` : `${filename}.md`
	);

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return { file: existing, created: false };

	let pendingByPath = pendingDailyNoteCreations.get(app);
	if (!pendingByPath) {
		pendingByPath = new Map();
		pendingDailyNoteCreations.set(app, pendingByPath);
	}

	const pendingCreation = pendingByPath.get(path);
	if (pendingCreation) {
		const result = await pendingCreation;
		return result ? { ...result, created: false } : null;
	}

	const creation = (async (): Promise<EnsuredDailyNote | null> => {
		try {
			const file = await createDailyNote(
				moment(date) as unknown as Parameters<typeof createDailyNote>[0]
			);
			if (file) return { file, created: true };
		} catch (error) {
			console.warn(
				"[Meetings Plus] Daily note: template-aware creation failed",
				{ path, error }
			);
		}

		const createdElsewhere = app.vault.getAbstractFileByPath(path);
		if (createdElsewhere instanceof TFile) {
			return { file: createdElsewhere, created: false };
		}

		console.warn(
			"[Meetings Plus] Daily note: creation returned no file; no blank fallback was created",
			{ path }
		);
		return null;
	})();
	pendingByPath.set(path, creation);

	try {
		return await creation;
	} finally {
		if (pendingByPath.get(path) === creation) {
			pendingByPath.delete(path);
		}
	}
}

function startOfDay(d: Date): Date {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
