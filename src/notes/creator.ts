import { App, Notice, TFile, moment, normalizePath } from "obsidian";
import { CalendarConfig, Meeting } from "../types";
import { renderTemplate, sanitizeFilename } from "./template";
import { NoteIndex } from "./duplicate-detector";
import { runTemplaterIfAvailable } from "../integrations/templater";
import { ensureDailyNote } from "./daily-note";

export interface CreateOptions {
	app: App;
	meeting: Meeting;
	calendar: CalendarConfig;
	runTemplater: boolean;
	openInNewPane: boolean;
	noteIndex: NoteIndex;
}

export async function createOrOpenMeetingNote(
	opts: CreateOptions
): Promise<TFile | null> {
	const { app, meeting, calendar, noteIndex } = opts;

	// Existing standalone note → just open it, regardless of destination.
	const existing = noteIndex.findExistingNote(meeting.dedupKey);
	if (existing) {
		await openFile(app, existing, opts.openInNewPane);
		return existing;
	}

	// Rescheduled-meeting fallback: same UID, different start date.
	// Recurring occurrences share one UID, so a single existing note would
	// wrongly match from the second occurrence on — skip them entirely.
	const rescheduled = meeting.recurring
		? null
		: noteIndex.findNoteByUid(meeting.uid);
	if (rescheduled) {
		// 1. Update frontmatter
		await app.fileManager.processFrontMatter(
			rescheduled,
			(fm: Record<string, unknown>) => {
				fm["meeting_dedup_key"] = meeting.dedupKey;
				fm["date"] = moment(meeting.start).format("YYYY-MM-DD");
				fm["start"] = moment(meeting.start).format("HH:mm");
				fm["end"] = moment(meeting.end).format("HH:mm");
			}
		);

		// 2. Update the "**When**:" line the default template renders as
		// "**When**: YYYY-MM-DD HH:mm – HH:mm (N min)". Silently no-ops
		// for custom templates without this line.
		const durationMin = Math.round(
			(meeting.end.getTime() - meeting.start.getTime()) / 60_000
		);
		const newWhenLine = `**When**: ${moment(meeting.start).format("YYYY-MM-DD HH:mm")} – ${moment(meeting.end).format("HH:mm")} (${durationMin} min)`;
		const bodyBefore = await app.vault.read(rescheduled);
		const bodyAfter = bodyBefore.replace(
			/^\*\*When\*\*: \d{4}-\d{2}-\d{2} \d{2}:\d{2} – \d{2}:\d{2} \(\d+ min\)$/m,
			newWhenLine
		);
		if (bodyAfter !== bodyBefore) {
			await app.vault.modify(rescheduled, bodyAfter);
		}

		// 3. Rename file to match new date (updates backlinks automatically)
		const newTitle = renderTemplate(calendar.titlePattern, {
			meeting,
			calendar,
		});
		const newBaseName = sanitizeFilename(newTitle) || "Untitled meeting";
		const folder = rescheduled.parent?.path ?? "";
		let newPath = joinPath(folder, `${newBaseName}.md`);
		if (newPath !== rescheduled.path) {
			newPath = await uniquePath(app, newPath);
			await app.fileManager.renameFile(rescheduled, newPath);
		}

		new Notice(
			`Meetings Plus: found rescheduled note for "${meeting.title}"`
		);
		await openFile(app, rescheduled, opts.openInNewPane);
		return rescheduled;
	}

	switch (calendar.noteDestination) {
		case "none":
			new Notice(
				`Meetings Plus: note creation disabled for "${calendar.name}"`
			);
			return null;
		case "daily-note":
		case "daily-note-event-date":
			return appendToDailyNoteSection(opts);
		case "file":
		default:
			return createStandaloneFile(opts);
	}
}

async function createStandaloneFile(opts: CreateOptions): Promise<TFile | null> {
	const { app, meeting, calendar } = opts;
	const folder = (calendar.folder || "").trim();
	if (folder) await ensureFolder(app, folder);

	const titleBody = renderTemplate(calendar.titlePattern, {
		meeting,
		calendar,
	});
	const baseName = sanitizeFilename(titleBody) || "Untitled meeting";
	const path = await uniquePath(app, joinPath(folder, `${baseName}.md`));

	const body = renderTemplate(calendar.template, { meeting, calendar });
	const file = await app.vault.create(path, body);

	if (opts.runTemplater) {
		try {
			await runTemplaterIfAvailable(app, file);
		} catch (e) {
			console.warn(
				"[Meetings Plus] Templater post-processing failed",
				e
			);
		}
	}

	await openFile(app, file, opts.openInNewPane);
	return file;
}

const SECTION_MARKER_RE = (key: string): RegExp =>
	new RegExp(
		`<!--\\s*mp:section\\s+dedup=${escapeRegex(key)}\\s*-->[\\s\\S]*?<!--\\s*mp:section/end\\s+dedup=${escapeRegex(key)}\\s*-->`,
		"m"
	);

async function appendToDailyNoteSection(
	opts: CreateOptions
): Promise<TFile | null> {
	const { app, meeting, calendar } = opts;
	const noteDate =
		calendar.noteDestination === "daily-note-event-date"
			? meeting.start
			: new Date();
	const file = await ensureDailyNote(app, noteDate);
	if (!file) {
		new Notice(
			"Could not create or open the daily note. Check the daily notes core plugin settings."
		);
		return null;
	}

	const body = stripFrontmatter(
		renderTemplate(calendar.template, { meeting, calendar })
	).trim();
	const sectionBlock = buildSection(meeting.dedupKey, body);

	const original = await app.vault.read(file);
	const re = SECTION_MARKER_RE(meeting.dedupKey);
	let next: string;
	if (re.test(original)) {
		next = original.replace(re, sectionBlock);
	} else {
		const sep =
			original.length === 0 || original.endsWith("\n") ? "" : "\n";
		next = `${original}${sep}\n${sectionBlock}\n`;
	}
	if (next !== original) {
		await app.vault.modify(file, next);
	}

	if (opts.runTemplater) {
		try {
			await runTemplaterIfAvailable(app, file);
		} catch (e) {
			console.warn(
				"[Meetings Plus] Templater post-processing failed",
				e
			);
		}
	}

	await openFile(app, file, opts.openInNewPane);
	return file;
}

function buildSection(dedupKey: string, body: string): string {
	return [
		`<!-- mp:section dedup=${dedupKey} -->`,
		body,
		`<!-- mp:section/end dedup=${dedupKey} -->`,
	].join("\n");
}

function stripFrontmatter(text: string): string {
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return text;
	return text.slice(end + 4).replace(/^\n+/, "");
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalized = normalizePath(folder);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing) return;
	try {
		await app.vault.createFolder(normalized);
	} catch {
		/* already exists or race */
	}
}

function joinPath(folder: string, name: string): string {
	if (!folder) return normalizePath(name);
	return normalizePath(`${folder}/${name}`);
}

async function uniquePath(app: App, path: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(path)) return path;
	const dot = path.lastIndexOf(".");
	const stem = dot > 0 ? path.slice(0, dot) : path;
	const ext = dot > 0 ? path.slice(dot) : "";
	let i = 2;
	while (i < 1000) {
		const candidate = `${stem} (${i})${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
		i++;
	}
	return path;
}

async function openFile(
	app: App,
	file: TFile,
	newPane: boolean
): Promise<void> {
	const leaf = app.workspace.getLeaf(newPane ? "tab" : false);
	await leaf.openFile(file);
}
