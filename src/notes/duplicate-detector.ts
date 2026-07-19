import { Plugin, TFile } from "obsidian";

export class NoteIndex {
	private dedupKeyToFile = new Map<string, TFile>();
	private uidToFiles = new Map<string, TFile[]>();
	private fileToMeta = new Map<string, { dedupKey?: string; uid?: string }>();
	private initialized = false;

	constructor(private readonly plugin: Plugin) {
		plugin.registerEvent(
			plugin.app.metadataCache.on("changed", (file) => {
				this.onFileChanged(file);
			})
		);
		plugin.registerEvent(
			plugin.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.onFileDeleted(file);
				}
			})
		);
		plugin.registerEvent(
			plugin.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.onFileRenamed(file, oldPath);
				}
			})
		);
	}

	private initialize() {
		if (this.initialized) return;
		this.initialized = true;
		this.rebuild();
	}

	rebuild(): void {
		this.dedupKeyToFile.clear();
		this.uidToFiles.clear();
		this.fileToMeta.clear();
		const files = this.plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			this.indexFile(file);
		}
	}

	private indexFile(file: TFile) {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return;

		const dedupKey: unknown = fm["meeting_dedup_key"];
		const uid: unknown = fm["meeting_uid"];

		if (
			(typeof dedupKey === "string" && dedupKey) ||
			(typeof uid === "string" && uid)
		) {
			const meta: { dedupKey?: string; uid?: string } = {};

			if (typeof dedupKey === "string" && dedupKey) {
				this.dedupKeyToFile.set(dedupKey, file);
				meta.dedupKey = dedupKey;
			}

			if (typeof uid === "string" && uid) {
				let list = this.uidToFiles.get(uid);
				if (!list) {
					list = [];
					this.uidToFiles.set(uid, list);
				}
				if (!list.includes(file)) {
					list.push(file);
				}
				meta.uid = uid;
			}

			this.fileToMeta.set(file.path, meta);
		}
	}

	private deindexFileByPath(path: string) {
		const meta = this.fileToMeta.get(path);
		if (!meta) return;

		if (meta.dedupKey) {
			this.dedupKeyToFile.delete(meta.dedupKey);
		}

		if (meta.uid) {
			const list = this.uidToFiles.get(meta.uid);
			if (list) {
				const idx = list.findIndex(f => f.path === path);
				if (idx !== -1) {
					list.splice(idx, 1);
					if (list.length === 0) {
						this.uidToFiles.delete(meta.uid);
					}
				}
			}
		}

		this.fileToMeta.delete(path);
	}

	private onFileChanged(file: TFile) {
		if (!this.initialized) return;
		this.deindexFileByPath(file.path);
		this.indexFile(file);
	}

	private onFileDeleted(file: TFile) {
		if (!this.initialized) return;
		this.deindexFileByPath(file.path);
	}

	private onFileRenamed(file: TFile, oldPath: string) {
		if (!this.initialized) return;
		this.deindexFileByPath(oldPath);
		this.indexFile(file);
	}

	findExistingNote(dedupKey: string): TFile | null {
		this.initialize();
		return this.dedupKeyToFile.get(dedupKey) ?? null;
	}

	findNoteByUid(uid: string): TFile | null {
		this.initialize();
		const matches = this.uidToFiles.get(uid) ?? [];
		return matches.length === 1 ? (matches[0] ?? null) : null;
	}
}

