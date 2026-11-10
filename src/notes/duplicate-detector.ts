import { FrontMatterCache, Plugin, TFile } from "obsidian";
import { CalendarConfig, Meeting } from "../types";
import { moment } from "../util/time";
import { renderTemplate, sanitizeFilename } from "./template";
import { MeetingFacts, NoteFacts, pickForeignNote } from "./foreign-match";

interface IndexedMeta {
	dedupKey?: string;
	uid?: string;
	date: string;
	start: string;
}

/** YAML may hand back numbers or booleans; compare scalars as text. */
function toText(value: unknown): string {
	return typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? String(value)
		: "";
}

export function meetingFacts(
	meeting: Meeting,
	calendar: CalendarConfig | undefined
): MeetingFacts {
	const name = calendar
		? sanitizeFilename(renderTemplate(calendar.titlePattern, { meeting, calendar })) ||
			"Untitled meeting"
		: "";
	return {
		date: moment(meeting.start).format("YYYY-MM-DD"),
		start: moment(meeting.start).format("HH:mm"),
		name,
		title: meeting.title,
	};
}

export class NoteIndex {
	private dedupKeyToFile = new Map<string, TFile>();
	private uidToFiles = new Map<string, TFile[]>();
	private fileToMeta = new Map<string, IndexedMeta>();
	private initialized = false;

	constructor(private readonly plugin: Plugin) {
		plugin.registerEvent(
			plugin.app.metadataCache.on("changed", (file) => {
				this.onFileChanged(file);
			})
		);
		plugin.registerEvent(
			plugin.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.onFileDeleted(file);
				}
			})
		);
		plugin.registerEvent(
			plugin.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.onFileRenamed(file, oldPath);
				}
			})
		);
	}

	private initialize() {
		if (this.initialized) return;
		this.initialized = true;
		this.rebuild();
	}

	rebuild(): void {
		this.dedupKeyToFile.clear();
		this.uidToFiles.clear();
		this.fileToMeta.clear();
		const files = this.plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			this.indexFile(file);
		}
	}

	private indexFile(file: TFile) {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return;

		const dedupKey: unknown = fm["meeting_dedup_key"];
		const uid: unknown = fm["meeting_uid"];

		if (
			(typeof dedupKey === "string" && dedupKey) ||
			(typeof uid === "string" && uid)
		) {
			const meta: IndexedMeta = {
				date: toText(fm["date"]),
				start: toText(fm["start"]),
			};

			if (typeof dedupKey === "string" && dedupKey) {
				this.dedupKeyToFile.set(dedupKey, file);
				meta.dedupKey = dedupKey;
			}

			if (typeof uid === "string" && uid) {
				let list = this.uidToFiles.get(uid);
				if (!list) {
					list = [];
					this.uidToFiles.set(uid, list);
				}
				if (!list.includes(file)) {
					list.push(file);
				}
				meta.uid = uid;
			}

			this.fileToMeta.set(file.path, meta);
		}
	}

	private deindexFileByPath(path: string) {
		const meta = this.fileToMeta.get(path);
		if (!meta) return;

		if (meta.dedupKey && this.dedupKeyToFile.get(meta.dedupKey)?.path === path) {
			this.dedupKeyToFile.delete(meta.dedupKey);
		}

		if (meta.uid) {
			const list = this.uidToFiles.get(meta.uid);
			if (list) {
				const idx = list.findIndex(f => f.path === path);
				if (idx !== -1) {
					list.splice(idx, 1);
					if (list.length === 0) {
						this.uidToFiles.delete(meta.uid);
					}
				}
			}
		}

		this.fileToMeta.delete(path);
	}

	private onFileChanged(file: TFile) {
		if (!this.initialized) return;
		this.deindexFileByPath(file.path);
		this.indexFile(file);
	}

	private onFileDeleted(file: TFile) {
		if (!this.initialized) return;
		this.deindexFileByPath(file.path);
	}

	private onFileRenamed(file: TFile, oldPath: string) {
		if (!this.initialized) return;
		this.deindexFileByPath(oldPath);
		this.indexFile(file);
	}

	findExistingNote(dedupKey: string): TFile | null {
		this.initialize();
		return this.dedupKeyToFile.get(dedupKey) ?? null;
	}

	/**
	 * Index-only lookup that also accepts the UTC-dated key written by 0.5.6
	 * and earlier, so those notes still register as existing, and notes
	 * another app (HyperCap) made for the same meeting.
	 */
	findNoteForMeeting(
		meeting: Meeting,
		calendar: CalendarConfig | undefined
	): TFile | null {
		const hit = this.findExistingNote(meeting.dedupKey);
		if (hit) return hit;
		const legacy =
			meeting.legacyDedupKey === meeting.dedupKey
				? null
				: this.findExistingNote(meeting.legacyDedupKey);
		if (legacy) return legacy;
		const facts = meetingFacts(meeting, calendar);
		return (
			this.findNoteByUidAndDate(meeting.uid, facts.date) ??
			this.findForeignNote(facts)
		);
	}

	findNoteByUid(uid: string): TFile | null {
		this.initialize();
		const matches = this.uidToFiles.get(uid) ?? [];
		return matches.length === 1 ? (matches[0] ?? null) : null;
	}

	/** A note with this uid on this local date, recurring or not. */
	findNoteByUidAndDate(uid: string, date: string): TFile | null {
		this.initialize();
		const matches = this.uidToFiles.get(uid) ?? [];
		return (
			matches.find((f) => this.fileToMeta.get(f.path)?.date === date) ??
			null
		);
	}

	/**
	 * The single note with a meeting_uid, the meeting's date and start, and
	 * the file name Meetings Plus would give it or its title as first heading.
	 */
	findForeignNote(meeting: MeetingFacts): TFile | null {
		this.initialize();
		const files: TFile[] = [];
		for (const list of this.uidToFiles.values()) {
			for (const file of list) files.push(file);
		}
		return pickForeignNote(this.foreignCandidates(files, meeting), meeting);
	}

	private foreignCandidates(
		files: TFile[],
		meeting: MeetingFacts
	): { file: TFile; facts: NoteFacts }[] {
		const notes: { file: TFile; facts: NoteFacts }[] = [];
		for (const file of files) {
			const meta = this.fileToMeta.get(file.path);
			if (!meta?.uid) continue;
			if (meta.date !== meeting.date || meta.start !== meeting.start) continue;
			const heading =
				this.plugin.app.metadataCache
					.getFileCache(file)
					?.headings?.find((h) => h.level === 1)?.heading ?? "";
			notes.push({
				file,
				facts: {
					uid: meta.uid,
					date: meta.date,
					start: meta.start,
					name: file.basename,
					heading,
				},
			});
		}
		return notes;
	}

	private scanFiles(test: (fm: FrontMatterCache) => boolean): TFile[] {
		const matches: TFile[] = [];
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const fm =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm && test(fm)) matches.push(file);
		}
		return matches;
	}

	private scanFrontmatter(key: string, value: string): TFile[] {
		const matches: TFile[] = [];
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const fm =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm?.[key] === value) matches.push(file);
		}
		return matches;
	}

	private reindex(file: TFile) {
		this.deindexFileByPath(file.path);
		this.indexFile(file);
	}

	/**
	 * Authoritative variants for the note-creation path, where a false negative
	 * from a stale index would create a duplicate note. Everywhere else the fast
	 * index-only lookups are fine — a stale answer there is only cosmetic.
	 */
	findExistingNoteVerified(dedupKey: string): TFile | null {
		const hit = this.findExistingNote(dedupKey);
		if (hit) return hit;
		const matches = this.scanFrontmatter("meeting_dedup_key", dedupKey);
		for (const file of matches) this.reindex(file);
		return matches[0] ?? null;
	}

	findNoteByUidVerified(uid: string): TFile | null {
		const hit = this.findNoteByUid(uid);
		if (hit) return hit;
		const matches = this.scanFrontmatter("meeting_uid", uid);
		for (const file of matches) this.reindex(file);
		// More than one match means a recurring event with per-occurrence notes,
		// where we can't safely identify which occurrence was rescheduled.
		return matches.length === 1 ? (matches[0] ?? null) : null;
	}

	findNoteByUidAndDateVerified(uid: string, date: string): TFile | null {
		const hit = this.findNoteByUidAndDate(uid, date);
		if (hit) return hit;
		const matches = this.scanFiles(
			(fm) => fm["meeting_uid"] === uid && toText(fm["date"]) === date
		);
		for (const file of matches) this.reindex(file);
		return matches[0] ?? null;
	}

	findForeignNoteVerified(meeting: MeetingFacts): TFile | null {
		const hit = this.findForeignNote(meeting);
		if (hit) return hit;
		const matches = this.scanFiles(
			(fm) =>
				typeof fm["meeting_uid"] === "string" &&
				fm["meeting_uid"] !== "" &&
				toText(fm["date"]) === meeting.date &&
				toText(fm["start"]) === meeting.start
		);
		for (const file of matches) this.reindex(file);
		return pickForeignNote(this.foreignCandidates(matches, meeting), meeting);
	}
}
