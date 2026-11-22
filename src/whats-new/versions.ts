// "What's new": which release notes to show, as plain functions (no Obsidian imports).

type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: Version, b: Version): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function majorMinor(v: string): string {
	const p = parseVersion(v);
	return p ? `${p[0]}.${p[1]}` : v;
}

const POPUP_MARKER = /^<!-- popup -->[ \t]*(?:\r?\n|$)/;
const POPUP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A release-notes file whose first line is `<!-- popup -->` opens the window. */
export function hasPopupMarker(text: string): boolean {
	return POPUP_MARKER.test(text);
}

export function stripPopupMarker(text: string): string {
	return text.replace(POPUP_MARKER, "");
}

/** The version stored on this device; without one, the old data.json value (read only). */
export function deviceVersion(saved: unknown, lastShownVersion: string | undefined): string {
	if (typeof saved === "string") return saved;
	return lastShownVersion ?? "";
}

/** Newer than `local` when it parses, else the current major.minor line. */
export function notesToShow(
	notes: Record<string, string>,
	local: string,
	current: string
): [string, string][] {
	return parseVersion(local)
		? notesBetween(notes, local, current)
		: notesForCurrentLine(notes, current);
}

export interface StartupInput {
	/** Version stored on this device, or the data.json fallback */
	local: string;
	current: string;
	enabled: boolean;
	hadSavedData: boolean;
	/** mtime of the plugin's manifest.json, null when unknown */
	installedAt: number | null;
	now: number;
	notes: Record<string, string>;
}

export interface StartupDecision {
	show: boolean;
	/** Version to store on this device */
	store: string;
}

/**
 * Shows the window only when one of the notes to show is marked with
 * `<!-- popup -->`, the vault had saved data (not a first install) and the
 * update reached this device less than 3 days ago. Always stores the current
 * version, so it shows at most once per device.
 */
export function decideOnStartup({
	local,
	current,
	enabled,
	hadSavedData,
	installedAt,
	now,
	notes,
}: StartupInput): StartupDecision {
	const hide = { show: false, store: current };
	if (!enabled) return hide;
	const marked = notesToShow(notes, local, current).some(([, text]) => hasPopupMarker(text));
	if (!marked) return hide;
	if (!hadSavedData) return hide;
	if (installedAt === null || now - installedAt > POPUP_DAYS * DAY_MS) return hide;
	return { show: true, store: current };
}

/** Versions newer than `after` up to and including `upTo`, newest first. */
export function notesBetween(
	notes: Record<string, string>,
	after: string,
	upTo: string
): [string, string][] {
	const a = parseVersion(after);
	const u = parseVersion(upTo);
	if (!u) return [];
	const picked: [Version, string, string][] = [];
	for (const [version, text] of Object.entries(notes)) {
		const v = parseVersion(version);
		if (!v || compare(v, u) > 0) continue;
		if (a && compare(v, a) <= 0) continue;
		picked.push([v, version, text]);
	}
	picked.sort((x, y) => compare(y[0], x[0]));
	return picked.map(([, version, text]) => [version, text]);
}

/** Notes for the current major.minor line, for the "Show what's new" command. */
export function notesForCurrentLine(
	notes: Record<string, string>,
	current: string
): [string, string][] {
	const c = parseVersion(current);
	if (!c) return [];
	return notesBetween(notes, "", current).filter(([version]) => {
		const v = parseVersion(version);
		return v !== null && v[0] === c[0] && v[1] === c[1];
	});
}

/** Bare "@handle" becomes a link to the GitHub profile; existing links are left alone. */
export function linkHandles(markdown: string): string {
	return markdown.replace(
		/(^|[\s(])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?=[\s.,;:!?)]|$)/gm,
		(_m, before: string, handle: string) =>
			`${before}[@${handle}](https://github.com/${handle})`
	);
}
