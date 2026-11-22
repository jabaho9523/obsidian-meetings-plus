import { requireApiVersion, type Plugin } from "obsidian";
import { decideOnStartup, deviceVersion, notesToShow } from "./versions";

/**
 * Stores the current version in this device's local storage and returns the
 * notes to show, empty for none. Plugin local storage arrived in Obsidian
 * 1.8.7; on older versions this never shows.
 */
export async function whatsNewOnStartup(
	plugin: Plugin,
	key: string,
	settings: { showWhatsNew: boolean; lastShownVersion?: string },
	hadSavedData: boolean,
	notes: Record<string, string>
): Promise<[string, string][]> {
	const { app, manifest } = plugin;
	if (requireApiVersion("1.8.7")) {
		const saved: unknown = app.loadLocalStorage(key);
		const local = deviceVersion(saved, settings.lastShownVersion);
		const stat = manifest.dir
			? await app.vault.adapter.stat(`${manifest.dir}/manifest.json`).catch(() => null)
			: null;
		const decision = decideOnStartup({
			local,
			current: manifest.version,
			enabled: settings.showWhatsNew,
			hadSavedData,
			installedAt: stat?.mtime ?? null,
			now: Date.now(),
			notes,
		});
		app.saveLocalStorage(key, decision.store);
		return decision.show ? notesToShow(notes, local, manifest.version) : [];
	}
	return [];
}
