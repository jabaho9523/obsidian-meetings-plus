import { App, TFile } from "obsidian";

interface TemplaterAPI {
	templater?: {
		overwrite_file_commands?: (file: TFile) => Promise<void>;
	};
}

export async function runTemplaterIfAvailable(
	app: App,
	file: TFile
): Promise<boolean> {
	const plugin = (
		app as unknown as {
			plugins?: { plugins?: Record<string, TemplaterAPI | undefined> };
		}
	).plugins?.plugins?.["templater-obsidian"];
	const templater = plugin?.templater;
	if (typeof templater?.overwrite_file_commands !== "function") return false;
	await templater.overwrite_file_commands(file);
	return true;
}

export function isTemplaterInstalled(app: App): boolean {
	const plugin = (
		app as unknown as {
			plugins?: { plugins?: Record<string, unknown> };
		}
	).plugins?.plugins?.["templater-obsidian"];
	return Boolean(plugin);
}
