// Harvest: find T:/Q:/A: lines in a note, as plain functions (no Obsidian imports).

export interface HarvestPrefixes {
	task: string;
	question: string;
	answer: string;
}

export const DEFAULT_PREFIXES: HarvestPrefixes = {
	task: "T:",
	question: "Q:",
	answer: "A:",
};

export type HarvestKind = "task" | "question" | "answer";

/**
 * How the line is written: "prefix" is an unharvested T:/Q:/A: line,
 * "checkbox" a harvested task, "things" a task sent to Things.
 */
export type HarvestForm = "prefix" | "checkbox" | "things";

export interface HarvestItem {
	/** Zero-based index into the text split on line breaks */
	line: number;
	kind: HarvestKind;
	form: HarvestForm;
	/** Leading whitespace, as written */
	indent: string;
	list: boolean;
	/** The list marker with its trailing space ("- ", "1. "); "" on a plain line */
	marker: string;
	/** Text after the prefix, without the trailing block id */
	text: string;
	names: string[];
	due: string | null;
	scheduled: string | null;
	deadline: string | null;
	/** Trailing block id without the caret */
	blockId: string | null;
	/** Questions only */
	answered: boolean;
	/** Checkbox form only: any status other than a space */
	done: boolean;
	/** Things form only */
	thingsId: string | null;
}

export interface HarvestCounts {
	/** T: lines not yet converted */
	unharvested: number;
	openTasks: number;
	things: number;
	openQuestions: number;
}

const LINE = /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+)?(.*)$/;
const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const CHECKBOX = /^\[(.)\](?:[ \t]+(.*))?$/;
const THINGS = /^→[ \t]+(.*?)[ \t]*\[Things\]\(things:\/\/\/show\?id=([^)\s]+)\)$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const DATE = "[ \\t]*(\\d{4}-\\d{2}-\\d{2})";
const DUE = new RegExp("📅" + DATE);
const SCHEDULED = new RegExp("⏳" + DATE);
const DEADLINE = new RegExp("⏰" + DATE);
const DATE_MARKERS = new RegExp("[ \\t]*(?:📅|⏳|⏰|✅)" + DATE, "g");

function width(indent: string): number {
	return indent.replace(/\t/g, "    ").length;
}

function namesIn(text: string): string[] {
	const names: string[] = [];
	const re = /(?:^|\s)@(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const name = (m[1] ?? "").replace(/[.,;:!?)]+$/, "");
		if (name) names.push(name);
	}
	return names;
}

function dateIn(text: string, re: RegExp): string | null {
	return re.exec(text)?.[1] ?? null;
}

/** Lines that can't hold items: front matter and fenced code blocks. */
function skippedLines(lines: string[]): boolean[] | null {
	const skip = lines.map(() => false);
	let i = 0;
	if ((lines[0] ?? "").trimEnd() === "---") {
		let end = -1;
		for (let j = 1; j < lines.length; j++) {
			if ((lines[j] ?? "").trimEnd() === "---") {
				end = j;
				break;
			}
		}
		if (end < 0) return null;
		for (let j = 0; j <= end; j++) skip[j] = true;
		i = end + 1;
	}
	let fence: string | null = null;
	for (; i < lines.length; i++) {
		const m = FENCE.exec(lines[i] ?? "");
		const mark = m?.[1] ?? "";
		if (fence === null) {
			if (m) {
				fence = mark;
				skip[i] = true;
			}
			continue;
		}
		skip[i] = true;
		if (
			m &&
			mark.charAt(0) === fence.charAt(0) &&
			mark.length >= fence.length &&
			(m[2] ?? "").trim() === ""
		) {
			fence = null;
		}
	}
	return skip;
}

function prefixKind(rest: string, prefixes: HarvestPrefixes): [HarvestKind, string] | null {
	const kinds: [HarvestKind, string][] = [
		["task", prefixes.task],
		["question", prefixes.question],
		["answer", prefixes.answer],
	];
	for (const [kind, prefix] of kinds) {
		if (!prefix || !rest.startsWith(prefix)) continue;
		const after = rest.slice(prefix.length);
		if (after !== "" && !/^[ \t]/.test(after)) continue;
		return [kind, after.trim()];
	}
	return null;
}

/**
 * Items in a note. A note with unclosed front matter has none.
 * Works on LF and CRLF text; `line` indexes `text.split(/\r?\n/)`.
 */
export function parseHarvest(
	text: string,
	prefixes: HarvestPrefixes = DEFAULT_PREFIXES,
): HarvestItem[] {
	const lines = text.split(/\r?\n/);
	const skip = skippedLines(lines);
	if (!skip) return [];

	const items: HarvestItem[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (skip[i]) continue;
		const m = LINE.exec(lines[i] ?? "");
		if (!m) continue;
		const indent = m[1] ?? "";
		const marker = m[2] ?? "";
		let rest = (m[3] ?? "").trimEnd();
		const list = marker !== "";

		let blockId: string | null = null;
		const id = BLOCK_ID.exec(rest);
		if (id) {
			blockId = id[1] ?? null;
			rest = rest.slice(0, id.index).trimEnd();
		}

		let kind: HarvestKind;
		let form: HarvestForm = "prefix";
		let itemText: string;
		let done = false;
		let thingsId: string | null = null;

		const prefixed = prefixKind(rest, prefixes);
		const ours = list && blockId !== null && blockId.startsWith("mp-");
		const box = ours ? CHECKBOX.exec(rest) : null;
		const things = ours ? THINGS.exec(rest) : null;
		if (prefixed) {
			[kind, itemText] = prefixed;
			if (!itemText) continue;
		} else if (box) {
			kind = "task";
			form = "checkbox";
			done = box[1] !== " ";
			itemText = (box[2] ?? "").trim();
		} else if (things) {
			kind = "task";
			form = "things";
			itemText = things[1] ?? "";
			thingsId = things[2] ?? null;
		} else {
			continue;
		}

		items.push({
			line: i,
			kind,
			form,
			indent,
			list,
			marker,
			text: itemText,
			names: namesIn(itemText),
			due: dateIn(itemText, DUE),
			scheduled: dateIn(itemText, SCHEDULED),
			deadline: dateIn(itemText, DEADLINE),
			blockId,
			answered: false,
			done,
			thingsId,
		});
	}

	const answerAt = new Map<number, HarvestItem>();
	for (const item of items) {
		if (item.kind === "answer") answerAt.set(item.line, item);
	}
	for (const q of items) {
		if (q.kind !== "question") continue;
		const own = width(q.indent);
		for (let i = q.line + 1; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (line.trim() === "") continue;
			const w = width(/^[ \t]*/.exec(line)?.[0] ?? "");
			if (w <= own) break;
			if (answerAt.has(i)) {
				q.answered = true;
				break;
			}
		}
	}
	return items;
}

/** "mp-" and six base36 characters. */
export function newBlockId(): string {
	let id = "mp-";
	for (let i = 0; i < 6; i++) {
		id += Math.floor(Math.random() * 36).toString(36);
	}
	return id;
}

/**
 * "- T: x" → "- [ ] x ^mp-xxxxxx". Keeps indent, list marker, dates and names.
 * A plain line becomes a "- " list item. A block id already on the line is
 * kept instead of `newId`, since a line can only have one.
 */
export function toCheckboxLine(item: HarvestItem, newId: string): string {
	const marker = item.marker || "- ";
	return `${item.indent}${marker}[ ] ${item.text} ^${item.blockId ?? newId}`;
}

/** "- → x [Things](things:///show?id=…) ^mp-xxxxxx", without the date markers. */
export function toThingsLine(item: HarvestItem, thingsId: string): string {
	const marker = item.marker || "- ";
	const title = item.text.replace(DATE_MARKERS, "").trim();
	const id = item.blockId ? ` ^${item.blockId}` : "";
	return `${item.indent}${marker}→ ${title} [Things](things:///show?id=${thingsId})${id}`;
}

export function openQuestions(items: HarvestItem[]): string[] {
	return items
		.filter((item) => item.kind === "question" && !item.answered)
		.map((item) => item.text);
}

export function counts(items: HarvestItem[]): HarvestCounts {
	const tasks = items.filter((item) => item.kind === "task");
	return {
		unharvested: tasks.filter((item) => item.form === "prefix").length,
		openTasks: tasks.filter((item) => item.form === "checkbox" && !item.done).length,
		things: tasks.filter((item) => item.form === "things").length,
		openQuestions: openQuestions(items).length,
	};
}
