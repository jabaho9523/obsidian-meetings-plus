import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, TFolder } from "obsidian";
import { SidebarTasks } from "../src/harvest/sidebar-tasks";
import { setTaskDone } from "../src/harvest/tick";

// A harvested note as in the demo vault: the Q: line right below the task
// continues its list item, so Obsidian's metadata cache has no block id for it.
const NOTE = [
	"---",
	"open_tasks_count: 1",
	"open_tasks:",
	'  - "Send the hiring plan to Anna"',
	"---",
	"",
	"## Notes",
	"- [ ] Send the hiring plan to Anna ^mp-ou9ssm",
	"Q: Who owns the Q1 budget?",
	"- [ ] Book a room",
	"- [x] Share the slides ✅ 2026-11-19 ^mp-ab12cd",
	"",
].join("\n");

const LIST_ITEMS = [
	{ task: " ", position: { start: { line: 7 }, end: { line: 8 } } },
	{ task: " ", position: { start: { line: 9 }, end: { line: 9 } } },
	{ task: "x", id: "mp-ab12cd", position: { start: { line: 10 }, end: { line: 10 } } },
];

function fakePlugin(text: string) {
	const folder = Object.assign(new TFolder(), { path: "Meetings", name: "Meetings" });
	const file = Object.assign(new TFile(), {
		path: "Meetings/2026-11-20 - Q1 roadmap review.md",
		name: "2026-11-20 - Q1 roadmap review.md",
		basename: "2026-11-20 - Q1 roadmap review",
		extension: "md",
		stat: { ctime: Date.now(), mtime: Date.now(), size: text.length },
		parent: folder,
	});
	folder.children = [file];
	return {
		settings: {
			harvestEnabled: true,
			harvestSidebarTasks: true,
			calendars: [{ folder: "Meetings" }],
		},
		harvester: { scope: () => ({ mode: "own", folders: [] }) },
		app: {
			vault: {
				getFolderByPath: (path: string) => (path === folder.path ? folder : null),
				cachedRead: () => Promise.resolve(text),
			},
			metadataCache: { getFileCache: () => ({ listItems: LIST_ITEMS }) },
		},
	} as unknown as ConstructorParameters<typeof SidebarTasks>[0];
}

test("Open tasks lists a harvested task with a Q: line right below it", async () => {
	const sidebarTasks = new SidebarTasks(fakePlugin(NOTE));
	assert.deepEqual(sidebarTasks.openTasks(14).tasks, []);
	assert.equal(await sidebarTasks.load(), true);
	const { tasks, more } = sidebarTasks.openTasks(14);
	assert.deepEqual(
		tasks.map((t) => [t.line, t.text, t.blockId]),
		[[7, "Send the hiring plan to Anna", "mp-ou9ssm"]]
	);
	assert.equal(more, 0);
});

test("Ticking that task ticks its line and recounts the note", () => {
	const ref = {
		line: 7,
		raw: "- [ ] Send the hiring plan to Anna ^mp-ou9ssm",
		blockId: "mp-ou9ssm",
	};
	const options = {
		prefixes: { task: "T:", question: "Q:", answer: "A:" },
		plainCheckboxes: false,
	};
	const ticked = setTaskDone(NOTE, ref, true, "2026-11-20", options);
	assert.match(ticked, /^- \[x\] Send the hiring plan to Anna ✅ 2026-11-20 \^mp-ou9ssm$/m);
	assert.match(ticked, /^open_tasks_count: 0$/m);
	assert.match(ticked, /^Q: Who owns the Q1 budget\?$/m);
});
