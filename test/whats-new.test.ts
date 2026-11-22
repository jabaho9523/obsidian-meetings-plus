import assert from "node:assert/strict";
import { test } from "node:test";
import {
	decideOnStartup,
	deviceVersion,
	hasPopupMarker,
	notesToShow,
	StartupInput,
	stripPopupMarker,
} from "../src/whats-new/versions";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 22, 12);

const NOTES: Record<string, string> = {
	"0.7.0": "Seven",
	"0.8.0": "<!-- popup -->\n**Harvest**",
	"0.8.1": "Fixes",
	"0.8.2": "More fixes",
};

function input(over: Partial<StartupInput>): StartupInput {
	return {
		local: "0.7.0",
		current: "0.8.2",
		enabled: true,
		hadSavedData: true,
		installedAt: NOW - DAY,
		now: NOW,
		notes: NOTES,
		...over,
	};
}

test("shows when a newer note is marked and the update is recent", () => {
	assert.deepEqual(decideOnStartup(input({})), { show: true, store: "0.8.2" });
});

test("turned off: stores without showing", () => {
	assert.deepEqual(decideOnStartup(input({ enabled: false })), { show: false, store: "0.8.2" });
});

test("no marked note newer than the device version: stores without showing", () => {
	assert.deepEqual(decideOnStartup(input({ local: "0.8.1" })), { show: false, store: "0.8.2" });
});

test("same version again: stores without showing", () => {
	assert.deepEqual(decideOnStartup(input({ local: "0.8.2" })), { show: false, store: "0.8.2" });
});

test("unparseable device version: the current line decides", () => {
	assert.deepEqual(decideOnStartup(input({ local: "" })), { show: true, store: "0.8.2" });
	const unmarked = { ...NOTES, "0.8.0": "Harvest" };
	assert.deepEqual(
		decideOnStartup(input({ local: "", notes: unmarked })),
		{ show: false, store: "0.8.2" }
	);
});

test("unparseable device version ignores marked notes from older lines", () => {
	const notes = { "0.7.0": "<!-- popup -->\nSeven", "0.8.2": "Fixes" };
	assert.deepEqual(decideOnStartup(input({ local: "", notes })), { show: false, store: "0.8.2" });
});

test("first install: stores without showing", () => {
	assert.deepEqual(decideOnStartup(input({ hadSavedData: false })), { show: false, store: "0.8.2" });
});

test("no install time: stores without showing", () => {
	assert.deepEqual(decideOnStartup(input({ installedAt: null })), { show: false, store: "0.8.2" });
});

test("installed more than 3 days ago: stores without showing", () => {
	assert.deepEqual(
		decideOnStartup(input({ installedAt: NOW - 3 * DAY - 1 })),
		{ show: false, store: "0.8.2" }
	);
	assert.deepEqual(decideOnStartup(input({ installedAt: NOW - 3 * DAY })), { show: true, store: "0.8.2" });
});

test("the marker must be the first line", () => {
	assert.equal(hasPopupMarker("<!-- popup -->\nText"), true);
	assert.equal(hasPopupMarker("<!-- popup -->\r\nText"), true);
	assert.equal(hasPopupMarker("<!-- popup -->"), true);
	assert.equal(hasPopupMarker("Text\n<!-- popup -->"), false);
	assert.equal(hasPopupMarker("<!-- popup --> Text"), false);
	assert.equal(hasPopupMarker(""), false);
});

test("the marker is stripped before rendering", () => {
	assert.equal(stripPopupMarker("<!-- popup -->\n**Fix:** text"), "**Fix:** text");
	assert.equal(stripPopupMarker("<!-- popup -->"), "");
	assert.equal(stripPopupMarker("**Fix:** text"), "**Fix:** text");
});

test("device version: a stored string wins, else the data.json fallback", () => {
	assert.equal(deviceVersion("0.8.2", "0.8.0"), "0.8.2");
	assert.equal(deviceVersion(null, "0.8.0"), "0.8.0");
	assert.equal(deviceVersion(42, "0.8.0"), "0.8.0");
	assert.equal(deviceVersion({ v: "0.8.2" }, undefined), "");
	assert.equal(deviceVersion(undefined, undefined), "");
});

test("notes shown: newer than the device version, else the current line", () => {
	assert.deepEqual(
		notesToShow(NOTES, "0.7.0", "0.8.2").map(([v]) => v),
		["0.8.2", "0.8.1", "0.8.0"]
	);
	assert.deepEqual(notesToShow(NOTES, "0.8.1", "0.8.2").map(([v]) => v), ["0.8.2"]);
	assert.deepEqual(notesToShow(NOTES, "", "0.8.2").map(([v]) => v), ["0.8.2", "0.8.1", "0.8.0"]);
});
