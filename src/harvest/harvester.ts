import {
	MarkdownView,
	Notice,
	TFile,
	normalizePath,
	requireApiVersion,
} from "obsidian";
import type MeetingsPlusPlugin from "../main";
import { PLUGIN_NAME } from "../constants";
import { OVERVIEW_BASE, OVERVIEW_BASE_NAME } from "./base";
import { LeaveWatcher } from "./on-leave";
import { HarvestScope, NoteKind, coveredBy, mayHarvest, noteKind } from "./scope";
import { HarvestOptions, HarvestResult, harvestNote } from "./transform";

/** Longer than Obsidian's own save delay, so the note is on disk first. */
const LEAVE_DELAY_MS = 3000;

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export class Harvester {
	private readonly watcher: LeaveWatcher;

	constructor(private readonly plugin: MeetingsPlusPlugin) {
		this.watcher = new LeaveWatcher({
			delayMs: LEAVE_DELAY_MS,
			mayHarvest: (path) => {
				const { settings } = this.plugin;
				if (!settings.harvestEnabled || !settings.harvestOnLeave) return false;
				const file = this.note(path);
				return (
					file !== null &&
					mayHarvest("auto", path, this.kind(file), this.scope())
				);
			},
			mtime: (path) => this.note(path)?.stat.mtime ?? null,
			busy: (path) => this.hasCursor(path),
			harvest: async (path) => {
				const file = this.note(path);
				if (!file) return;
				try {
					await this.harvestFile(file);
				} catch (e) {
					console.warn("[Meetings Plus] harvest on leave failed", e);
					new Notice(`${PLUGIN_NAME}: harvest failed for ${file.basename}`);
				}
			},
			setTimer: (fn, ms) => window.setTimeout(fn, ms),
			clearTimer: (id) => window.clearTimeout(id),
		});
	}

	start(): void {
		const { workspace } = this.plugin.app;
		const onActive = () => {
			this.watcher.setActive(this.activeNote()?.path ?? null);
		};
		this.plugin.registerEvent(workspace.on("active-leaf-change", onActive));
		this.plugin.registerEvent(workspace.on("file-open", onActive));
		workspace.onLayoutReady(onActive);
	}

	stop(): void {
		this.watcher.clear();
	}

	activeNote(): TFile | null {
		const file = this.plugin.app.workspace.getActiveFile();
		return file && file.extension === "md" ? file : null;
	}

	/** The command and the sidebar button: any note, other apps' included. */
	async harvestActive(): Promise<void> {
		const file = this.activeNote();
		if (!file) {
			new Notice(`${PLUGIN_NAME}: no note is open`);
			return;
		}
		try {
			const { result } = await this.harvestFile(file);
			new Notice(
				`${PLUGIN_NAME}: ${plural(result.converted, "task")}, ${plural(
					result.counts.openQuestions,
					"open question"
				)}`
			);
		} catch (e) {
			console.warn("[Meetings Plus] harvest failed", e);
			new Notice(`${PLUGIN_NAME}: harvest failed, check console`);
		}
	}

	/** Other apps' notes are never edited here; they are counted instead. */
	async harvestAll(): Promise<void> {
		const { vault } = this.plugin.app;
		const scope = this.scope();
		const options = this.options();
		let notes = 0;
		let tasks = 0;
		let skipped = 0;
		let failed = 0;
		for (const file of vault.getMarkdownFiles()) {
			const kind = this.kind(file);
			if (!coveredBy(file.path, kind, scope)) continue;
			try {
				if (!mayHarvest("auto", file.path, kind, scope)) {
					const text = await vault.cachedRead(file);
					if (harvestNote(text, options).text !== text) skipped++;
					continue;
				}
				const { result, changed } = await this.harvestFile(file);
				if (!changed) continue;
				notes++;
				tasks += result.converted;
			} catch (e) {
				failed++;
				console.warn("[Meetings Plus] harvest failed", file.path, e);
			}
		}
		const parts = [`${plural(notes, "note")} harvested, ${plural(tasks, "task")}`];
		if (skipped > 0) {
			parts.push(
				`${plural(skipped, "note")} from other apps skipped; harvest them one at a time`
			);
		}
		if (failed > 0) parts.push(`${plural(failed, "note")} failed, check console`);
		new Notice(`${PLUGIN_NAME}: ${parts.join(". ")}`);
	}

	async createOverview(): Promise<void> {
		if (!requireApiVersion("1.9.0")) {
			new Notice(`${PLUGIN_NAME}: the overview needs Bases, in Obsidian 1.9 or later`);
			return;
		}
		const { vault, workspace } = this.plugin.app;
		const scope = this.scope();
		const first = scope.mode === "folders" ? (scope.folders[0] ?? "") : "";
		const folder = first.replace(/^\/+|\/+$/g, "");
		const path = normalizePath(
			folder ? `${folder}/${OVERVIEW_BASE_NAME}` : OVERVIEW_BASE_NAME
		);
		try {
			let file = vault.getFileByPath(path);
			if (!file) {
				if (folder && !vault.getFolderByPath(folder)) {
					await vault.createFolder(folder);
				}
				file = await vault.create(path, OVERVIEW_BASE);
			}
			await workspace.getLeaf(true).openFile(file);
		} catch (e) {
			console.warn("[Meetings Plus] meetings overview failed", e);
			new Notice(
				`${PLUGIN_NAME}: could not open ${path}. Check that the Bases core plugin is on`
			);
		}
	}

	private async harvestFile(
		file: TFile
	): Promise<{ result: HarvestResult; changed: boolean }> {
		const { vault } = this.plugin.app;
		const options = this.options();
		const before = await vault.read(file);
		let result = harvestNote(before, options);
		if (result.text === before) return { result, changed: false };
		await vault.process(file, (data) => {
			result = harvestNote(data, options);
			return result.text;
		});
		return { result, changed: true };
	}

	private options(): HarvestOptions {
		const { settings } = this.plugin;
		return {
			prefixes: {
				task: settings.harvestTaskPrefix.trim(),
				question: settings.harvestQuestionPrefix.trim(),
				answer: settings.harvestAnswerPrefix.trim(),
			},
			plainCheckboxes: settings.harvestPlainCheckboxes,
		};
	}

	private scope(): HarvestScope {
		const { settings } = this.plugin;
		return { mode: settings.harvestScope, folders: settings.harvestFolders };
	}

	private kind(file: TFile): NoteKind {
		return noteKind(
			this.plugin.app.metadataCache.getFileCache(file)?.frontmatter,
			this.plugin.settings.calendars.map((c) => c.id)
		);
	}

	private note(path: string): TFile | null {
		const file = this.plugin.app.vault.getFileByPath(path);
		return file && file.extension === "md" ? file : null;
	}

	private hasCursor(path: string): boolean {
		return this.plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => {
			const view = leaf.view;
			return (
				view instanceof MarkdownView &&
				view.file?.path === path &&
				view.getMode() === "source" &&
				view.editor.hasFocus()
			);
		});
	}
}
