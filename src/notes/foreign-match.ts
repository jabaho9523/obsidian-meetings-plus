/** What a note says about itself: front matter, file name, first `#` heading. */
export interface NoteFacts {
	uid: string;
	date: string;
	start: string;
	name: string;
	heading: string;
}

/** The meeting as another app's note would describe it. */
export interface MeetingFacts {
	date: string;
	start: string;
	/** The file name Meetings Plus would give this meeting's note */
	name: string;
	title: string;
}

export function normalize(s: string): string {
	return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "2026-11-10 - test1 (2)" → "2026-11-10 - test1" */
export function stripCopySuffix(name: string): string {
	return name.replace(/ \(\d+\)$/, "");
}

export function matchesMeeting(note: NoteFacts, meeting: MeetingFacts): boolean {
	if (!note.uid) return false;
	if (note.date !== meeting.date || note.start !== meeting.start) return false;
	return (
		(meeting.name !== "" &&
			stripCopySuffix(normalize(note.name)) === normalize(meeting.name)) ||
		(note.heading !== "" &&
			normalize(note.heading) === normalize(meeting.title))
	);
}

/** The one note that matches, or null when none or several do. */
export function pickForeignNote<T>(
	notes: { file: T; facts: NoteFacts }[],
	meeting: MeetingFacts
): T | null {
	const hits = notes.filter((n) => matchesMeeting(n.facts, meeting));
	return hits.length === 1 ? (hits[0]?.file ?? null) : null;
}
