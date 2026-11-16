// Harvest of one note as a text transform (no Obsidian imports).

import {
	HarvestCounts,
	HarvestPrefixes,
	counts,
	newBlockId,
	openQuestions,
	parseHarvest,
	toCheckboxLine,
} from "./parse";

export interface HarvestOptions {
	prefixes: HarvestPrefixes;
	plainCheckboxes: boolean;
}

export interface HarvestResult {
	/** The note after harvest; the same string when nothing changed */
	text: string;
	/** Lines turned into checkboxes or given a block id in this run */
	converted: number;
	counts: HarvestCounts;
	openQuestions: string[];
}

type Line = [text: string, eol: string];

function splitLines(text: string): Line[] {
	const parts = text.split(/(\r?\n)/);
	const lines: Line[] = [];
	for (let i = 0; i < parts.length; i += 2) {
		lines.push([parts[i] ?? "", parts[i + 1] ?? ""]);
	}
	return lines;
}

function joinLines(lines: Line[]): string {
	return lines.map(([text, eol]) => text + eol).join("");
}

const ANY_BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;

function unusedId(taken: Set<string>): string {
	let id = newBlockId();
	while (taken.has(id)) id = newBlockId();
	taken.add(id);
	return id;
}

function renderProperty(key: string, value: number | string[]): string[] {
	if (typeof value === "number") return [`${key}: ${value}`];
	if (value.length === 0) return [`${key}: []`];
	return [`${key}:`, ...value.map((v) => `  - ${JSON.stringify(v)}`)];
}

/**
 * Writes the Harvest properties into the front matter and leaves every other
 * line as it was. A key the note doesn't have is only added when its value
 * isn't zero or empty. Front matter that is never closed is left alone.
 */
function setProperties(
	lines: Line[],
	values: [string, number | string[]][]
): Line[] {
	const empty = (v: number | string[]) =>
		typeof v === "number" ? v === 0 : v.length === 0;
	const eol = lines[0]?.[1] || "\n";
	const asLines = (rendered: string[]): Line[] =>
		rendered.map((text): Line => [text, eol]);

	if ((lines[0]?.[0] ?? "").trimEnd() !== "---") {
		const added = values
			.filter(([, v]) => !empty(v))
			.flatMap(([k, v]) => renderProperty(k, v));
		if (added.length === 0) return lines;
		return [...asLines(["---", ...added, "---"]), ...lines];
	}

	const out = lines.slice();
	let end = out.findIndex(([text], i) => i > 0 && text.trimEnd() === "---");
	if (end < 0) return lines;

	for (const [key, value] of values) {
		const keyRe = new RegExp(`^${key}[ \\t]*:`);
		const at = out.findIndex(([text], i) => i > 0 && i < end && keyRe.test(text));
		if (at < 0) {
			if (empty(value)) continue;
			const added = asLines(renderProperty(key, value));
			out.splice(end, 0, ...added);
			end += added.length;
			continue;
		}
		let stop = at + 1;
		while (stop < end && /^(?:[ \t]+\S|-(?:[ \t]|$))/.test(out[stop]?.[0] ?? "")) {
			stop++;
		}
		const rendered = renderProperty(key, value);
		const same =
			rendered.length === stop - at &&
			rendered.every((text, i) => out[at + i]?.[0] === text);
		if (same) continue;
		out.splice(at, stop - at, ...asLines(rendered));
		end += rendered.length - (stop - at);
	}
	return out;
}

/**
 * Harvest one note: unharvested task lines become checkboxes with a block id
 * (each line keeps its own line ending), then the counts and open questions
 * go into the front matter. Nothing else in the note changes.
 */
export function harvestNote(text: string, options: HarvestOptions): HarvestResult {
	const { prefixes, plainCheckboxes } = options;
	let lines = splitLines(text);

	const taken = new Set<string>();
	for (const [line] of lines) {
		const id = ANY_BLOCK_ID.exec(line)?.[1];
		if (id) taken.add(id);
	}

	let converted = 0;
	for (const item of parseHarvest(text, prefixes, plainCheckboxes)) {
		if (item.kind !== "task") continue;
		const unharvested =
			item.form === "prefix" || (item.form === "plain" && !item.blockId);
		if (!unharvested) continue;
		const line = lines[item.line];
		if (!line) continue;
		line[0] = toCheckboxLine(item, item.blockId ?? unusedId(taken));
		converted++;
	}

	const items = parseHarvest(joinLines(lines), prefixes, plainCheckboxes);
	const totals = counts(items);
	const questions = openQuestions(items);
	lines = setProperties(lines, [
		["open_tasks_count", totals.openTasks],
		["things_count", totals.things],
		["open_questions", questions],
		["open_questions_count", totals.openQuestions],
	]);

	const result = joinLines(lines);
	return {
		text: result === text ? text : result,
		converted,
		counts: totals,
		openQuestions: questions,
	};
}
