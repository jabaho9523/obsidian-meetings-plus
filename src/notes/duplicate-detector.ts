import {
	FileSystemAdapter,
	FrontMatterCache,
	Platform,
	Plugin,
	TFile,
	normalizePath,
} from "obsidian";
import { CalendarConfig, Meeting } from "../types";
import { moment } from "../util/time";
import { renderTemplate, sanitizeFilename } from "./template";
import {
	MeetingFacts,
	NoteFacts,
	dateKey,
	firstHeading,
	inScope,
	isAdoptedNote,
	isOwnNote,
	pickSingle,
	sameNameOrHeading,
	sameSlot,
	startKey,
} from "./foreign-match";

type Lstat = typeof import("fs/promises").lstat;

interface IndexedMeta {
	dedupKey?: string;
	uid?: string;
	date: string;
	start: string | null;
}

export function meetingFacts(
	meeting: Meeting,
	calendar: CalendarConfig
): MeetingFacts {
	return {
		date: moment(meeting.start).format("YYYY-MM-DD"),
		start: moment(meeting.start).format("HH:mm"),
		name: sanitizeFilename(
			renderTemplate(calendar.titlePattern, { meeting, calendar })
		),
		title: meeting.title,
	};
}

/** The calendar's notes folder ("the chosen folder"), "" for the vault root. */
export function notesFolder(calendar: CalendarConfig): string {
	const folder = (calendar.folder || "").trim();
	return folder ? normalizePath(folder) : "";
}

export class NoteIndex {
	private dedupKeyToFile = new Map<string, TFile>();
	private uidToFiles = new Map<string, TFile[]>();
	private fileToMeta = new Map<string, IndexedMeta>();
	/** First "# " line per note, read from the file text on demand. */
	private headings = new Map<string, string>();
	private lstat: Lstat | null | undefined;
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
		this.headings.clear();
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
				date: dateKey(fm["date"]),
				start: startKey(fm["start"]),
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
		this.headings.delete(path);
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
		if (legacy || !calendar) return legacy;
		const facts = meetingFacts(meeting, calendar);
		const folder = notesFolder(calendar);
		return (
			this.findNoteByUidAndDate(meeting.uid, facts.date, folder) ??
			this.findForeignNote(facts, folder)
		);
	}

	/** Contract step 1, index only: same uid and date, recurring or not. */
	findNoteByUidAndDate(uid: string, date: string, folder: string): TFile | null {
		this.initialize();
		const matches = this.uidToFiles.get(uid) ?? [];
		return (
			matches.find(
				(f) =>
					inScope(f.path, folder) &&
					this.fileToMeta.get(f.path)?.date === date
			) ?? null
		);
	}

	/**
	 * Contract steps 2 and 3, index only. A heading not read yet counts as
	 * none until its file text is in; a stale answer here is only cosmetic.
	 */
	findForeignNote(meeting: MeetingFacts, folder: string): TFile | null {
		this.initialize();
		const matches: TFile[] = [];
		for (const list of this.uidToFiles.values()) {
			for (const file of list) {
				const meta = this.fileToMeta.get(file.path);
				if (!meta?.uid || !inScope(file.path, folder)) continue;
				const facts: NoteFacts = {
					uid: meta.uid,
					date: meta.date,
					start: meta.start,
					fileName: file.name,
					heading: "",
				};
				if (!sameSlot(facts, meeting)) continue;
				facts.heading = this.cachedHeading(file);
				if (sameNameOrHeading(facts, meeting)) matches.push(file);
			}
		}
		return pickSingle(matches);
	}

	private cachedHeading(file: TFile): string {
		const known = this.headings.get(file.path);
		if (known !== undefined) return known;
		this.plugin.app.vault.cachedRead(file).then(
			(text) => {
				this.headings.set(file.path, firstHeading(text));
			},
			() => undefined
		);
		return "";
	}

	isOwn(file: TFile, calendarIds: string[]): boolean {
		return isOwnNote(
			this.plugin.app.metadataCache.getFileCache(file)?.frontmatter,
			calendarIds
		);
	}

	isAdopted(file: TFile): boolean {
		return isAdoptedNote(
			this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
		);
	}

	/** Our own note with this uid, when exactly one exists. */
	findNoteByUid(uid: string, calendarIds: string[]): TFile | null {
		this.initialize();
		const matches = (this.uidToFiles.get(uid) ?? []).filter((f) =>
			this.isOwn(f, calendarIds)
		);
		return pickSingle(matches);
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

	private scanFolder(
		folder: string,
		test: (fm: FrontMatterCache) => boolean
	): TFile[] {
		const matches: TFile[] = [];
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			if (!inScope(file.path, folder)) continue;
			const fm =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm && test(fm)) matches.push(file);
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

	findNoteByUidVerified(uid: string, calendarIds: string[]): TFile | null {
		const hit = this.findNoteByUid(uid, calendarIds);
		if (hit) return hit;
		const matches = this.scanFrontmatter("meeting_uid", uid).filter((f) =>
			this.isOwn(f, calendarIds)
		);
		for (const file of matches) this.reindex(file);
		// More than one match means a recurring event with per-occurrence notes,
		// where we can't safely identify which occurrence was rescheduled.
		return pickSingle(matches);
	}

	/** Contract step 1 for the creation path: scans the folder, skips links. */
	async findNoteByUidAndDateVerified(
		uid: string,
		date: string,
		folder: string
	): Promise<TFile | null> {
		const matches = this.scanFolder(
			folder,
			(fm) => fm["meeting_uid"] === uid && dateKey(fm["date"]) === date
		);
		for (const file of matches) {
			this.reindex(file);
			if (!(await this.isLinked(file, folder))) return file;
		}
		return null;
	}

	/** Contract steps 2 and 3 for the creation path, headings from the text. */
	async findForeignNoteVerified(
		meeting: MeetingFacts,
		folder: string
	): Promise<TFile | null> {
		const slot = this.scanFolder(
			folder,
			(fm) =>
				typeof fm["meeting_uid"] === "string" &&
				fm["meeting_uid"] !== "" &&
				dateKey(fm["date"]) === meeting.date &&
				startKey(fm["start"]) === meeting.start
		);
		const matches: TFile[] = [];
		for (const file of slot) {
			this.reindex(file);
			if (await this.isLinked(file, folder)) continue;
			const heading = firstHeading(await this.plugin.app.vault.read(file));
			this.headings.set(file.path, heading);
			if (sameNameOrHeading({ fileName: file.name, heading }, meeting)) {
				matches.push(file);
			}
		}
		return pickSingle(matches);
	}

	/**
	 * Node's lstat through the desktop app's CommonJS require, loaded
	 * once on desktop. Null on mobile or when it can't be loaded.
	 */
	private loadLstat(): Lstat | null {
		if (this.lstat !== undefined) return this.lstat;
		this.lstat = null;
		if (Platform.isDesktop && Platform.isDesktopApp) {
			try {
				this.lstat = (
					window.require("fs/promises") as typeof import("fs/promises")
				).lstat;
			} catch (e) {
				console.warn(
					"[Meetings Plus] Node fs unavailable, skipping the symlink and hard-link check",
					e
				);
			}
		}
		return this.lstat;
	}

	/**
	 * Whether a folder below `folder` on the way to the note, or the note
	 * itself, is a symlink, or the note has more than one hard link. The vault
	 * API reports neither; this checks on desktop only, mobile can't.
	 */
	private async isLinked(file: TFile, folder: string): Promise<boolean> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return false;
		const lstat = this.loadLstat();
		if (!lstat) return false;
		const root = folder.replace(/^\/+|\/+$/g, "");
		const parts = (root ? file.path.slice(root.length + 1) : file.path).split("/");
		let path = root;
		try {
			for (let i = 0; i < parts.length; i++) {
				path = path ? `${path}/${parts[i] ?? ""}` : (parts[i] ?? "");
				const stat = await lstat(adapter.getFullPath(path));
				if (stat.isSymbolicLink()) return true;
				if (i === parts.length - 1 && stat.nlink > 1) return true;
			}
		} catch {
			return true;
		}
		return false;
	}
}
