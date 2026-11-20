// The parts of the obsidian module that the tested code loads, for tests run in Node.

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export function normalizePath(path: string): string {
	return path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/";
}

export function moment(): never {
	throw new Error("moment is not available in tests");
}
