// Which notes Harvest may edit, as plain functions (no Obsidian imports).

import { isAdoptedNote, isOwnNote, toText } from "../notes/foreign-match";

/**
 * "own" is a note Meetings Plus made, "foreign" a meeting note from another
 * app (adopted or not), "plain" any other note.
 */
export type NoteKind = "own" | "foreign" | "plain";

export type HarvestScopeMode = "own" | "folders";

export interface HarvestScope {
	mode: HarvestScopeMode;
	folders: string[];
}

export function noteKind(
	fm: Record<string, unknown> | undefined,
	calendarIds: string[]
): NoteKind {
	if (isOwnNote(fm, calendarIds)) return "own";
	if (!fm) return "plain";
	const meeting =
		isAdoptedNote(fm) ||
		toText(fm["meeting_uid"]) !== "" ||
		toText(fm["meeting_dedup_key"]) !== "";
	return meeting ? "foreign" : "plain";
}

/** In one of the folders or their subfolders. "/" is the whole vault. */
export function inFolders(path: string, folders: string[]): boolean {
	return folders.some((folder) => {
		const root = folder.replace(/^\/+|\/+$/g, "");
		return root === "" || path.startsWith(`${root}/`);
	});
}

/** Notes the scope setting covers, other apps' meeting notes included. */
export function coveredBy(path: string, kind: NoteKind, scope: HarvestScope): boolean {
	return scope.mode === "folders"
		? inFolders(path, scope.folders)
		: kind !== "plain";
}

/**
 * A harvest the user runs on one note is always allowed. One that runs by
 * itself (leaving a note, all notes in scope) needs the note to be in scope
 * and not another app's.
 */
export function mayHarvest(
	trigger: "user" | "auto",
	path: string,
	kind: NoteKind,
	scope: HarvestScope
): boolean {
	if (trigger === "user") return true;
	return kind !== "foreign" && coveredBy(path, kind, scope);
}
