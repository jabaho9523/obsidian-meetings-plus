// HyperCap's meeting-note contract, as plain functions (no Obsidian imports).

/** What a note says about itself. `date` and `start` are already keyed. */
export interface NoteFacts {
	uid: string;
	date: string;
	start: string | null;
	fileName: string;
	heading: string;
}

/** The meeting as another app's note would describe it. */
export interface MeetingFacts {
	date: string;
	/** Zero-padded 24-hour local HH:mm */
	start: string;
	/** The file name Meetings Plus would give this meeting's note */
	name: string;
	title: string;
}

export function normalize(s: string): string {
	return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** "2026-11-10 - test1 (12).md" → "2026-11-10 - test1" */
export function stem(name: string): string {
	return name.replace(/\.md$/, "").replace(/ \(\d{1,3}\)$/, "");
}

/** YAML may hand back numbers or booleans; compare scalars as text. */
export function toText(value: unknown): string {
	return typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
		? String(value)
		: "";
}

export function dateKey(value: unknown): string {
	return toText(value).trim();
}

/**
 * Front matter `start` as zero-padded HH:mm. Accepts "9:05", quoted values,
 * and the number a YAML 1.1 parser makes of 15:00 (sexagesimal, 900).
 */
export function startKey(value: unknown): string | null {
	let minutes: number;
	if (typeof value === "number") {
		if (!Number.isInteger(value)) return null;
		minutes = value;
	} else if (typeof value === "string") {
		const s = value.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
		const m = /^(\d{1,2}):(\d{2})$/.exec(s);
		if (!m) return null;
		const h = Number(m[1]);
		const min = Number(m[2]);
		if (h > 23 || min > 59) return null;
		minutes = h * 60 + min;
	} else {
		return null;
	}
	if (minutes < 0 || minutes >= 24 * 60) return null;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The first line starting with "# " after the front matter, without "# ". */
export function firstHeading(text: string): string {
	let body = text;
	const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (fm) body = text.slice(fm[0].length);
	for (const line of body.split(/\r?\n/)) {
		if (line.startsWith("# ")) return line.slice(2);
	}
	return "";
}

/**
 * Whether `path` is in `folder` or a subfolder at most 4 levels below it,
 * with no dot-folder on the way. `folder` "" is the vault root.
 */
export function inScope(path: string, folder: string): boolean {
	const root = folder.replace(/^\/+|\/+$/g, "");
	let rel = path;
	if (root) {
		if (!path.startsWith(`${root}/`)) return false;
		rel = path.slice(root.length + 1);
	}
	const dirs = rel.split("/").slice(0, -1);
	return dirs.length <= 4 && !dirs.some((d) => d.startsWith("."));
}

/**
 * Meetings Plus's own note: its dedup key names one of our calendars and it
 * was not adopted from another app. Only own notes may be rewritten,
 * renamed or moved.
 */
export function isOwnNote(
	fm: Record<string, unknown> | undefined,
	calendarIds: string[]
): boolean {
	if (!fm || fm["meetings_plus_adopted"] === true) return false;
	const key = fm["meeting_dedup_key"];
	return (
		typeof key === "string" && calendarIds.some((id) => key.startsWith(`${id}::`))
	);
}

/** Contract step 2, first half: a uid, and the meeting's date and start. */
export function sameSlot(
	note: Pick<NoteFacts, "uid" | "date" | "start">,
	meeting: MeetingFacts
): boolean {
	return (
		note.uid !== "" &&
		note.date === meeting.date &&
		note.start !== null &&
		note.start === meeting.start
	);
}

/** Contract step 2, second half: our file name, or the title as heading. */
export function sameNameOrHeading(
	note: Pick<NoteFacts, "fileName" | "heading">,
	meeting: MeetingFacts
): boolean {
	return (
		(meeting.name !== "" &&
			normalize(stem(note.fileName)) === normalize(meeting.name)) ||
		(note.heading !== "" && normalize(note.heading) === normalize(meeting.title))
	);
}

/** Contract step 3: the one match, or nothing when none or several. */
export function pickSingle<T>(matches: T[]): T | null {
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * Adds our dedup key and `meetings_plus_adopted: true` to another app's note
 * and leaves every other byte as it was. Only those two lines are replaced
 * when already present.
 */
export function adoptFrontMatter(text: string, dedupKey: string): string {
	const fields: [string, string][] = [
		["meeting_dedup_key", JSON.stringify(dedupKey)],
		["meetings_plus_adopted", "true"],
	];
	const open = /^---(\r?\n)/.exec(text);
	if (!open) {
		const lines = fields.map(([k, v]) => `${k}: ${v}\n`).join("");
		return `---\n${lines}---\n${text}`;
	}
	const eol = open[1] ?? "\n";
	const start = open[0].length;
	const close = /^---[ \t]*$/m.exec(text.slice(start));
	const end = close ? start + close.index : text.length;
	let head = text.slice(start, end);
	const missing: string[] = [];
	for (const [k, v] of fields) {
		const re = new RegExp(`^${k}[ \\t]*:.*$`, "m");
		if (re.test(head)) head = head.replace(re, () => `${k}: ${v}`);
		else missing.push(`${k}: ${v}${eol}`);
	}
	return text.slice(0, start) + head + missing.join("") + text.slice(end);
}
