import { App, TFile } from "obsidian";

export function findExistingNote(
	app: App,
	dedupKey: string
): TFile | null {
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;
		if (fm["meeting_dedup_key"] === dedupKey) return file;
	}
	return null;
}

export function findNoteByUidAndStart(
	app: App,
	uid: string,
	startISODate: string
): TFile | null {
	const files = app.vault.getMarkdownFiles();
	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) continue;
		if (fm["meeting_uid"] !== uid) continue;
		const start = String(fm["start"] ?? "");
		const date = String(fm["date"] ?? "");
		if (date === startISODate || start.startsWith(startISODate)) {
			return file;
		}
	}
	return null;
}

/**
 * Find a meeting note by iCal UID alone, ignoring start date.
 * Returns the file only when exactly ONE note carries this UID — multiple
 * matches means it's a recurring event with per-occurrence notes, where we
 * can't safely identify which occurrence was rescheduled.
 */
export function findNoteByUid(app: App, uid: string): TFile | null {
	const matches: TFile[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (fm?.["meeting_uid"] === uid) matches.push(file);
	}
	return matches.length === 1 ? (matches.at(0) ?? null) : null;
}
