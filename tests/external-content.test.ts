import assert from "node:assert/strict";
import test from "node:test";
import {
	escapeMarkdownText,
	escapeTemplaterSyntax,
	yamlString,
	yamlStringList,
} from "../src/util/external-content.js";
import {
	safeExternalUrl,
	validateCalendarFeedUrl,
} from "../src/util/external-url.js";

test("calendar content cannot introduce Templater commands", () => {
	assert.equal(
		escapeTemplaterSyntax("<%* app.vault.delete(file) %>"),
		"&lt;%* app.vault.delete(file) %>"
	);
});

test("Markdown text escaping prevents links, embeds, and new structure", () => {
	assert.equal(
		escapeMarkdownText("![tracker](https://example.test)\n# heading"),
		"\\!\\[tracker\\]\\(https://example.test\\) \\# heading"
	);
});

test("YAML values remain scalar values", () => {
	assert.equal(yamlString("Alice\ncssclasses: unsafe"), '"Alice\\ncssclasses: unsafe"');
	assert.equal(yamlStringList(["A, B", "x: y"]), '["A, B","x: y"]');
});

test("only HTTPS meeting URLs are accepted", () => {
	assert.equal(safeExternalUrl("https://meet.example.test/path"), "https://meet.example.test/path");
	assert.equal(safeExternalUrl("javascript:alert(1)"), "");
	assert.equal(safeExternalUrl("file:///etc/passwd"), "");
	assert.equal(safeExternalUrl("http://meet.example.test"), "");
});

test("calendar feeds require HTTPS and reject inline credentials", () => {
	assert.equal(
		validateCalendarFeedUrl("https://calendar.example.test/feed.ics").hostname,
		"calendar.example.test"
	);
	assert.throws(() => validateCalendarFeedUrl("http://calendar.example.test/feed.ics"));
	assert.throws(() => validateCalendarFeedUrl("https://user:pass@calendar.example.test/feed.ics"));
});
