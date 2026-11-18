// Ticking a task line from the sidebar, as plain functions (no Obsidian imports).

import { BLOCK_ID } from "./parse";
import { HarvestOptions, joinLines, recountNote, splitLines } from "./transform";

const TASK = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[(.)\](?:[ \t](.*))?$/;
const DONE_DATE = /[ \t]*✅[ \t]*\d{4}-\d{2}-\d{2}/g;

export interface TaskLine {
	done: boolean;
	/** Text after the checkbox, without the done date and the block id */
	text: string;
	/** Trailing block id without the caret */
	blockId: string | null;
}

/** Which task to tick: its block id when it has one, else the line as it was shown. */
export interface TaskRef {
	/** Zero-based index into the text split on line breaks */
	line: number;
	/** The whole line, without its line ending */
	raw: string;
	blockId: string | null;
}

function split(rest: string): [body: string, blockId: string | null] {
	const id = BLOCK_ID.exec(rest);
	if (!id) return [rest.trimEnd(), null];
	return [rest.slice(0, id.index).trimEnd(), id[1] ?? null];
}

/** A checkbox line, or null for any other line. */
export function readTaskLine(line: string): TaskLine | null {
	const m = TASK.exec(line);
	if (!m) return null;
	const [body, blockId] = split(m[3] ?? "");
	return {
		done: m[2] !== " ",
		text: body.replace(DONE_DATE, "").trim(),
		blockId,
	};
}

/**
 * The line ticked ("[x]" and " ✅ date" before a trailing block id) or
 * unticked ("[ ]", done date removed). Null when it isn't a checkbox line.
 */
export function setLineDone(line: string, done: boolean, date: string): string | null {
	const m = TASK.exec(line);
	if (!m) return null;
	const [body, blockId] = split(m[3] ?? "");
	let text = body.replace(DONE_DATE, "").trimEnd();
	if (done) text = `${text} ✅ ${date}`;
	const id = blockId ? ` ^${blockId}` : "";
	return `${m[1] ?? ""}[${done ? "x" : " "}] ${text}${id}`;
}

/**
 * The note with one task ticked or unticked; every line keeps its own line
 * ending. A harvested task (^mp- id) also brings the Harvest properties up to
 * date. The same string comes back when the task is no longer there.
 */
export function setTaskDone(
	text: string,
	ref: TaskRef,
	done: boolean,
	date: string,
	options: HarvestOptions
): string {
	const lines = splitLines(text);
	const id = ref.blockId;
	let at: number;
	if (id) {
		at = lines.findIndex(([line]) => readTaskLine(line)?.blockId === id);
	} else if (lines[ref.line]?.[0] === ref.raw) {
		at = ref.line;
	} else {
		at = lines.findIndex(([line]) => line === ref.raw);
	}
	const line = lines[at];
	if (!line || readTaskLine(line[0])?.done === done) return text;
	const edited = setLineDone(line[0], done, date);
	if (edited === null || edited === line[0]) return text;
	line[0] = edited;
	const result = joinLines(lines);
	return id?.startsWith("mp-") ? recountNote(result, options) : result;
}
