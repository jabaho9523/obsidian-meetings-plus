import { requestUrl } from "obsidian";
import { validateCalendarFeedUrl } from "../util/external-url";

export interface FetchResult {
	body: string;
	status: number;
}

export interface FetchOptions {
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ICS_BYTES = 5 * 1024 * 1024;

export async function fetchICS(
	rawUrl: string,
	opts: FetchOptions = {}
): Promise<FetchResult> {
	const normalized = normalizeWebcal(rawUrl);
	const url = validateCalendarFeedUrl(normalized).toString();
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const result = await withTimeout(
		requestUrl({
			url,
			method: "GET",
			headers: {
				Accept: "text/calendar, text/plain, */*",
			},
			throw: false,
		}),
		timeoutMs
	);

	if (result.status >= 400) {
		throw new Error(`HTTP ${result.status}`);
	}
	const body = result.text ?? "";
	if (new TextEncoder().encode(body).byteLength > MAX_ICS_BYTES) {
		throw new Error("Calendar feed is larger than 5 MiB");
	}
	if (!body.includes("BEGIN:VCALENDAR")) {
		throw new Error("Response is not a valid ICS feed");
	}
	return { body, status: result.status };
}

/**
 * iCloud (and many other calendar apps) hand out `webcal://` URLs that are
 * meant to deep-link into a calendar client. Semantically they're just HTTPS
 * resources, so rewrite the scheme so `requestUrl()` accepts them.
 */
function normalizeWebcal(rawUrl: string): string {
	const trimmed = rawUrl.trim();
	if (/^webcals:\/\//i.test(trimmed)) {
		return trimmed.replace(/^webcals:\/\//i, "https://");
	}
	if (/^webcal:\/\//i.test(trimmed)) {
		return trimmed.replace(/^webcal:\/\//i, "https://");
	}
	return trimmed;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = window.setTimeout(
			() => reject(new Error(`Timed out after ${ms}ms`)),
			ms
		);
		p.then(
			(v) => {
				window.clearTimeout(t);
				resolve(v);
			},
			(e) => {
				window.clearTimeout(t);
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		);
	});
}
