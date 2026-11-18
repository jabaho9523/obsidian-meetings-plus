import {
	App,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import MeetingsPlusPlugin from "./main";
import {
	MAX_LOOK_BACK_DAYS,
	PLUGIN_NAME,
	VIEW_TYPE_MEETINGS_PLUS,
} from "./constants";
import { DEFAULT_SETTINGS, makeDefaultCalendar } from "./settings";
import { TimeFormat } from "./types";
import { HarvestScopeMode } from "./harvest/scope";
import { FolderSuggestModal } from "./ui/folder-suggest";
import { MeetingsPlusView } from "./ui/MeetingsPlusView";
import { CalendarEditorModal } from "./ui/calendar-editor-modal";
import { generateId } from "./util/id";

type NumericKey =
	| "refreshIntervalMinutes"
	| "requestTimeoutSeconds"
	| "lookAheadDays"
	| "lookBackDays"
	| "notificationLeadMinutes";

type BooleanKey =
	| "enableNotifications"
	| "runTemplaterOnNewNotes"
	| "openDashboardOnStart"
	| "harvestPlainCheckboxes"
	| "harvestOnLeave";

type PrefixKey =
	| "harvestTaskPrefix"
	| "harvestQuestionPrefix"
	| "harvestAnswerPrefix";

export class MeetingsPlusSettingTab extends PluginSettingTab {
	plugin: MeetingsPlusPlugin;
	private listEl: HTMLElement | null = null;

	constructor(app: App, plugin: MeetingsPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.numberField(
			"Refresh interval (minutes)",
			"How often to fetch calendar feeds in the background.",
			"refreshIntervalMinutes"
		);
		this.numberField(
			"Request timeout (seconds)",
			"How long to wait for a calendar feed to respond before timing out.",
			"requestTimeoutSeconds"
		);
		new Setting(containerEl)
			.setName("Time format")
			.setDesc(
				"How meeting times are displayed in the sidebar and the daily-note meeting list."
			)
			.addDropdown((d) => {
				d.addOption("24h", "24-hour (13:00)");
				d.addOption("12h", "12-hour (1:00 pm)");
				d.setValue(this.plugin.settings.timeFormat);
				d.onChange(async (v) => {
					this.plugin.settings.timeFormat = v as TimeFormat;
					await this.plugin.saveSettings();
					this.plugin.manager.onSettingsChanged();
				});
			});
		this.numberField(
			"Look-ahead window (days)",
			"How many days of future meetings to load.",
			"lookAheadDays"
		);
		this.numberField(
			"Look-back window (days)",
			"How many days of past meetings you can browse (up to 365). Set to 0 to disable. Some calendars, such as Outlook published links, only include recent history.",
			"lookBackDays",
			0,
			MAX_LOOK_BACK_DAYS
		);
		this.toggle(
			"Enable pre-meeting notifications",
			"Show a notice before each meeting starts.",
			"enableNotifications"
		);
		this.numberField(
			"Notification lead time (minutes)",
			"How many minutes before a meeting to notify.",
			"notificationLeadMinutes"
		);
		this.toggle(
			"Run Templater on new notes",
			"If Templater is installed, run it after creating meeting or daily notes.",
			"runTemplaterOnNewNotes"
		);
		this.toggle(
			"Open dashboard on startup",
			"Reveal the sidebar when Obsidian starts.",
			"openDashboardOnStart"
		);
		new Setting(containerEl)
			.setName("Hide section markers in the editor")
			.setDesc(
				"Hide the markers around daily-note meeting sections while editing. They stay in the file; Reading view always hides them."
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.hideSectionMarkers)
					.onChange(async (v) => {
						this.plugin.settings.hideSectionMarkers = v;
						await this.plugin.saveSettings();
						this.app.workspace.updateOptions();
					})
			);

		this.renderHarvest(containerEl.createDiv());

		new Setting(containerEl).setName("Calendars").setHeading();

		this.listEl = containerEl.createDiv({ cls: "meetings-plus-cal-list" });
		this.renderCalendarList(this.listEl);

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add calendar")
				.setCta()
				.onClick(() => {
					const draft = makeDefaultCalendar(generateId(), {
						name: "New calendar",
					});
					new CalendarEditorModal(this.app, this.plugin, draft, async (cal) => {
						this.plugin.settings.calendars.push(cal);
						await this.plugin.saveSettings();
						this.plugin.manager.refreshCalendar(cal.id).catch(() => {
							/* error surfaced via status */
						});
						this.refreshList();
					}).open();
				})
		);
	}

	private renderHarvest(containerEl: HTMLElement): void {
		containerEl.empty();
		const redraw = () => this.renderHarvest(containerEl);
		const settings = this.plugin.settings;
		const refreshViews = () => {
			for (const leaf of this.app.workspace.getLeavesOfType(
				VIEW_TYPE_MEETINGS_PLUS
			)) {
				if (leaf.view instanceof MeetingsPlusView) leaf.view.render();
			}
		};

		new Setting(containerEl).setName("Harvest").setHeading();
		new Setting(containerEl)
			.setName("Enable harvest")
			.setDesc(
				"Turn task lines into checkboxes and list open questions in the note's properties. Adds the harvest commands and a sidebar button."
			)
			.addToggle((t) =>
				t.setValue(settings.harvestEnabled).onChange(async (v) => {
					settings.harvestEnabled = v;
					await this.plugin.saveSettings();
					refreshViews();
					redraw();
				})
			);
		if (!settings.harvestEnabled) return;

		this.prefixField(
			containerEl,
			"Task prefix",
			"Lines starting with this become checkboxes.",
			"harvestTaskPrefix"
		);
		this.prefixField(
			containerEl,
			"Question prefix",
			"Lines starting with this are questions.",
			"harvestQuestionPrefix"
		);
		this.prefixField(
			containerEl,
			"Answer prefix",
			"A line with this prefix, indented under a question, answers it.",
			"harvestAnswerPrefix"
		);
		this.toggle(
			"Count plain checkboxes as tasks",
			"Also give open checkbox lines a block ID and count them.",
			"harvestPlainCheckboxes",
			containerEl
		);
		this.toggle(
			"Harvest when leaving a note",
			"Harvest an edited note a few seconds after you switch away from it. Notes from other apps are never harvested this way.",
			"harvestOnLeave",
			containerEl
		);
		new Setting(containerEl)
			.setName("Harvest automatically from")
			.setDesc(
				"Which notes are harvested when you leave them and by the command for all notes in scope. The sidebar button and the command for this note work on any note."
			)
			.addDropdown((d) => {
				d.addOption("own", `${PLUGIN_NAME} notes only`);
				d.addOption("folders", "Any note in these folders");
				d.setValue(settings.harvestScope);
				d.onChange(async (v) => {
					settings.harvestScope = v as HarvestScopeMode;
					await this.plugin.saveSettings();
					redraw();
				});
			});
		if (settings.harvestScope !== "folders") return;

		for (const folder of settings.harvestFolders) {
			new Setting(containerEl).setName(folder).addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("Remove folder")
					.onClick(async () => {
						settings.harvestFolders = settings.harvestFolders.filter(
							(f) => f !== folder
						);
						await this.plugin.saveSettings();
						redraw();
					})
			);
		}
		new Setting(containerEl)
			.setDesc("Notes in these folders and their subfolders are in scope.")
			.addButton((b) =>
				b.setButtonText("Add folder").onClick(() => {
					new FolderSuggestModal(this.app, (path) => {
						const folder = path || "/";
						if (settings.harvestFolders.includes(folder)) return;
						settings.harvestFolders.push(folder);
						void this.plugin.saveSettings().then(redraw);
					}).open();
				})
			);
	}

	private prefixField(
		parent: HTMLElement,
		name: string,
		desc: string,
		key: PrefixKey
	): void {
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				const fallback = DEFAULT_SETTINGS[key];
				t.setPlaceholder(fallback);
				t.setValue(this.plugin.settings[key]);
				t.onChange(async (v) => {
					this.plugin.settings[key] = v.trim() || fallback;
					await this.plugin.saveSettings();
				});
				t.inputEl.addEventListener("blur", () => {
					t.setValue(this.plugin.settings[key]);
				});
			});
	}

	private refreshList(): void {
		if (!this.listEl) return;
		this.renderCalendarList(this.listEl);
	}

	private renderCalendarList(parent: HTMLElement): void {
		parent.empty();
		if (this.plugin.settings.calendars.length === 0) {
			parent.createDiv({
				cls: "meetings-plus-empty",
				text: "No calendars yet. Add one below.",
			});
			return;
		}

		for (const cal of this.plugin.settings.calendars) {
			const row = parent.createDiv({ cls: "meetings-plus-cal-row" });

			const dot = row.createDiv({ cls: "meetings-plus-calendar-dot" });
			dot.style.background = cal.color;

			const main = row.createDiv({ cls: "meetings-plus-cal-main" });
			main.createDiv({ cls: "meetings-plus-cal-name", text: cal.name });
			main.createDiv({
				cls: "meetings-plus-cal-meta",
				text: cal.enabled ? "Enabled" : "Disabled",
			});

			const actions = row.createDiv({ cls: "meetings-plus-cal-actions" });

			const toggle = actions.createEl("button", {
				cls: "meetings-plus-icon-btn",
				attr: {
					"aria-label": cal.enabled ? "Disable" : "Enable",
				},
			});
			setIcon(toggle, cal.enabled ? "toggle-right" : "toggle-left");
			toggle.addEventListener("click", () => {
				cal.enabled = !cal.enabled;
				void this.plugin.saveSettings().then(() => this.refreshList());
			});

			const edit = actions.createEl("button", {
				cls: "meetings-plus-icon-btn",
				attr: { "aria-label": "Edit calendar" },
			});
			setIcon(edit, "settings-2");
			edit.addEventListener("click", () => {
				new CalendarEditorModal(this.app, this.plugin, cal, async (updated) => {
					Object.assign(cal, updated);
					await this.plugin.saveSettings();
					this.plugin.manager
						.refreshCalendar(cal.id)
						.catch(() => undefined);
					this.refreshList();
				}).open();
			});

			const del = actions.createEl("button", {
				cls: "meetings-plus-icon-btn meetings-plus-icon-danger",
				attr: { "aria-label": "Delete calendar" },
			});
			setIcon(del, "trash-2");
			del.addEventListener("click", () => {
				this.plugin.settings.calendars =
					this.plugin.settings.calendars.filter((c) => c.id !== cal.id);
				delete this.plugin.settings.cache[cal.id];
				this.plugin.manager.dropCalendar(cal.id);
				void this.plugin.saveSettings().then(() => this.refreshList());
			});
		}
	}

	private toggle(
		name: string,
		desc: string,
		key: BooleanKey,
		parent: HTMLElement = this.containerEl
	): void {
		new Setting(parent)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (v) => {
					this.plugin.settings[key] = v;
					await this.plugin.saveSettings();
					this.plugin.manager.onSettingsChanged();
				})
			);
	}

	private numberField(
		name: string,
		desc: string,
		key: NumericKey,
		min = 1,
		max?: number
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				const fallback = DEFAULT_SETTINGS[key];
				t.setPlaceholder(String(fallback));
				t.setValue(String(this.plugin.settings[key]));
				t.onChange(async (v) => {
					const n = parseInt(v, 10);
					let value = fallback;
					if (Number.isFinite(n) && n >= min) {
						value = max !== undefined ? Math.min(n, max) : n;
					}
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
					this.plugin.manager.onSettingsChanged();
				});
				t.inputEl.addEventListener("blur", () => {
					t.setValue(String(this.plugin.settings[key]));
				});
			});
	}
}

