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

export interface StartupDecision {
	show: boolean;
	/** Version to store as lastShownVersion, or null to leave it */
	store: string | null;
}

/**
 * First install (no saved data) stores the version and shows nothing. Saved
 * data with no stored version is an upgrade from before the window: it shows
 * the window (when enabled) and stores the version. A newer major or minor
 * does the same. Turned off, the version is stored without showing, so
 * turning it on later starts fresh. A patch-only change, or anything
 * unparseable, does nothing.
 */
export function decideOnStartup(
	stored: string,
	current: string,
	enabled: boolean,
	hadSavedData: boolean
): StartupDecision {
	if (stored === "") return { show: hadSavedData && enabled, store: current };
	const s = parseVersion(stored);
	const c = parseVersion(current);
	if (!s || !c) return { show: false, store: null };
	const newerMinor = c[0] > s[0] || (c[0] === s[0] && c[1] > s[1]);
	if (!newerMinor) return { show: false, store: null };
	return { show: enabled, store: current };
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
