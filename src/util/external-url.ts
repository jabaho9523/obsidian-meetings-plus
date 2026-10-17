/**
 * Meeting links arrive through ICS fields controlled by calendar providers and
 * event organizers. Only open web URLs from those fields.
 */
export function safeExternalUrl(raw: string): string {
	try {
		const url = new URL(raw.trim());
		return url.protocol === "https:" ? url.toString() : "";
	} catch {
		return "";
	}
}

/** Validate configured feeds before handing them to Obsidian's CORS-bypassing request API. */
export function validateCalendarFeedUrl(raw: string): URL {
	const url = new URL(raw.trim());
	if (url.protocol !== "https:") {
		throw new Error("Calendar feeds must use HTTPS");
	}
	if (url.username || url.password) {
		throw new Error(
			"Calendar feed URLs must not include a username or password"
		);
	}
	return url;
}
