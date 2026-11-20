import { TFile, TFolder } from "obsidian";
import type MeetingsPlusPlugin from "../main";
import { notesFolder } from "../notes/duplicate-detector";
import { moment } from "../util/time";
import { TaskRef, readTaskLine, setTaskDone } from "./tick";

const MAX_OPEN_TASKS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SidebarTask extends TaskRef {
	file: TFile;
	done: boolean;
	text: string;
}

export interface OpenTasks {
	tasks: SidebarTask[];
	/** Open tasks beyond the ones listed */
	more: number;
}

/**
 * Tasks for the sidebar. Which lines are tasks comes from the metadata cache;
 * a note's text is only read to show the lines of a list that is on screen.
 */
export class SidebarTasks {
	private readonly texts = new Map<string, { mtime: number; lines: string[] }>();
	private readonly wanted = new Map<string, TFile>();

	constructor(private readonly plugin: MeetingsPlusPlugin) {}

	enabled(): boolean {
		const { settings } = this.plugin;
		return settings.harvestEnabled && settings.harvestSidebarTasks;
	}

	/** Checkbox lines in the note, from the metadata cache alone. */
	count(file: TFile): { open: number; total: number } {
		const lines = this.taskLines(file);
		return {
			open: lines.filter(({ status }) => status === " ").length,
			total: lines.length,
		};
	}

	/** Null while the note's text isn't loaded yet; load() gets it. */
	tasks(file: TFile): SidebarTask[] | null {
		const lines = this.lines(file);
		if (!lines) return null;
		const tasks: SidebarTask[] = [];
		for (const { line } of this.taskLines(file)) {
			const task = this.taskAt(file, lines, line);
			if (task) tasks.push(task);
		}
		return tasks;
	}

	/**
	 * Open harvested tasks (an ^mp- id) from notes in the Harvest folders
	 * changed in the last `days` days, newest note first. Notes whose text
	 * isn't loaded yet are left out until load() has run. The id is read from
	 * the line: the metadata cache has none for a task with a line such as Q:
	 * right below it and no blank line between.
	 */
	openTasks(days: number): OpenTasks {
		const cutoff = Date.now() - days * DAY_MS;
		const notes = this.recentNotes(cutoff).sort(
			(a, b) => b.stat.mtime - a.stat.mtime
		);
		const tasks: SidebarTask[] = [];
		let more = 0;
		for (const file of notes) {
			const open = this.taskLines(file).filter(({ status }) => status === " ");
			if (open.length === 0) continue;
			const lines = this.lines(file);
			if (!lines) continue;
			for (const { line } of open) {
				const task = this.taskAt(file, lines, line);
				if (!task || task.done || !task.blockId?.startsWith("mp-")) continue;
				if (tasks.length < MAX_OPEN_TASKS) tasks.push(task);
				else more++;
			}
		}
		return { tasks, more };
	}

	/** Reads the notes tasks() and openTasks() were missing. True when any was read. */
	async load(): Promise<boolean> {
		const files = [...this.wanted.values()];
		this.wanted.clear();
		for (const file of files) {
			let lines: string[] = [];
			try {
				lines = (await this.plugin.app.vault.cachedRead(file)).split(/\r?\n/);
			} catch (e) {
				console.warn("[Meetings Plus] could not read tasks", file.path, e);
			}
			this.texts.set(file.path, { mtime: file.stat.mtime, lines });
		}
		return files.length > 0;
	}

	/** Ticks or unticks the task's line in its note. */
	async toggle(task: SidebarTask): Promise<void> {
		const { harvester } = this.plugin;
		await harvester.saveOpenViews(task.file);
		const today = moment().format("YYYY-MM-DD");
		await this.plugin.app.vault.process(task.file, (data) =>
			setTaskDone(data, task, !task.done, today, harvester.options())
		);
	}

	private taskLines(file: TFile): { line: number; status: string }[] {
		const items = this.plugin.app.metadataCache.getFileCache(file)?.listItems ?? [];
		const lines: { line: number; status: string }[] = [];
		for (const item of items) {
			if (item.task === undefined) continue;
			lines.push({ line: item.position.start.line, status: item.task });
		}
		return lines;
	}

	private lines(file: TFile): string[] | null {
		const text = this.texts.get(file.path);
		if (text && text.mtime === file.stat.mtime) return text.lines;
		this.wanted.set(file.path, file);
		return null;
	}

	private taskAt(file: TFile, lines: string[], line: number): SidebarTask | null {
		const raw = lines[line];
		const task = raw === undefined ? null : readTaskLine(raw);
		if (raw === undefined || !task) return null;
		return { file, line, raw, ...task };
	}

	private recentNotes(cutoff: number): TFile[] {
		const { vault } = this.plugin.app;
		const scope = this.plugin.harvester.scope();
		const folders =
			scope.mode === "folders"
				? scope.folders
				: this.plugin.settings.calendars.map(notesFolder);
		const seen = new Set<string>();
		const notes: TFile[] = [];
		const walk = (folder: TFolder) => {
			if (seen.has(folder.path)) return;
			seen.add(folder.path);
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					walk(child);
				} else if (
					child instanceof TFile &&
					child.extension === "md" &&
					child.stat.mtime >= cutoff
				) {
					notes.push(child);
				}
			}
		};
		for (const path of folders) {
			const root = path.replace(/^\/+|\/+$/g, "");
			const folder = root ? vault.getFolderByPath(root) : vault.getRoot();
			if (folder) walk(folder);
		}
		return notes;
	}
}
