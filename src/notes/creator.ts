import { App, MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import { moment } from "../util/time";
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
	const existing = noteIndex.findExistingNoteVerified(meeting.dedupKey);
	if (existing) {
		await openFile(app, existing, opts.openInNewPane);
		return existing;
	}

	// Notes written by 0.5.6 and earlier carry a UTC-dated key, which names the
	// wrong day for all-day and early-morning events east of UTC. Adopt those
	// notes and rewrite the key, so this costs a lookup only once per note.
	const legacyKeyed =
		meeting.legacyDedupKey === meeting.dedupKey
			? null
			: noteIndex.findExistingNoteVerified(meeting.legacyDedupKey);
	if (legacyKeyed) {
		await app.fileManager.processFrontMatter(
			legacyKeyed,
			(fm: Record<string, unknown>) => {
				fm["meeting_dedup_key"] = meeting.dedupKey;
			}
		);
		await openFile(app, legacyKeyed, opts.openInNewPane);
		return legacyKeyed;
	}

	// Rescheduled-meeting fallback: same UID, different start date.
	// Recurring occurrences share one UID, so a single existing note would
	// wrongly match from the second occurrence on — skip them entirely.
	const rescheduled = meeting.recurring
		? null
		: noteIndex.findNoteByUidVerified(meeting.uid);
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

const markerSource = (kind: "section" | "section/end", key: string): string =>
	`<!--\\s*mp:${kind}\\s+dedup=${key}\\s*-->`;

const SECTION_MARKER_RE = (key: string): RegExp =>
	new RegExp(
		`${markerSource("section", escapeRegex(key))}[\\s\\S]*?${markerSource("section/end", escapeRegex(key))}`,
		"m"
	);

/** Matches a line consisting solely of a start or end section marker. */
export const SECTION_MARKER_LINE_RE = new RegExp(
	`^\\s*(?:${markerSource("section", ".+?")}|${markerSource("section/end", ".+?")})\\s*$`
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

	const original = await app.vault.read(file);
	let existing = SECTION_MARKER_RE(meeting.dedupKey).exec(original);
	if (!existing && meeting.legacyDedupKey !== meeting.dedupKey) {
		// Sections written by 0.5.6 and earlier carry the UTC-dated key.
		// Rekey only the two marker lines; the body is left untouched.
		const legacy = SECTION_MARKER_RE(meeting.legacyDedupKey).exec(original);
		if (legacy) {
			const key = escapeRegex(meeting.legacyDedupKey);
			const rekeyed = legacy[0]
				.replace(
					new RegExp(`^${markerSource("section", key)}`),
					() => `<!-- mp:section dedup=${meeting.dedupKey} -->`
				)
				.replace(
					new RegExp(`${markerSource("section/end", key)}$`),
					() => `<!-- mp:section/end dedup=${meeting.dedupKey} -->`
				);
			await app.vault.modify(
				file,
				original.slice(0, legacy.index) +
					rekeyed +
					original.slice(legacy.index + legacy[0].length)
			);
			existing = legacy;
		}
	}
	if (existing) {
		const line = original.slice(0, existing.index).split("\n").length - 1;
		const leaf = app.workspace.getLeaf(opts.openInNewPane ? "tab" : false);
		await leaf.openFile(file);
		if (leaf.view instanceof MarkdownView) {
			const pos = { line, ch: 0 };
			leaf.view.editor.setCursor(pos);
			leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
		}
		return file;
	}

	const body = stripFrontmatter(
		renderTemplate(calendar.template, { meeting, calendar })
	).trim();
	const sectionBlock = buildSection(meeting.dedupKey, body);
	const sep = original.length === 0 || original.endsWith("\n") ? "" : "\n";
	await app.vault.modify(file, `${original}${sep}\n${sectionBlock}\n`);

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
