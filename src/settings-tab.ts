import {
	App,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import MeetingsPlusPlugin from "./main";
import { DEFAULT_SETTINGS, makeDefaultCalendar } from "./settings";
import { TimeFormat } from "./types";
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
	| "openDashboardOnStart";

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
			"How many days of past meetings you can navigate back to. Set to 0 to disable.",
			"lookBackDays",
			0,
			30
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
			"If Templater is installed, run it after creating a meeting note.",
			"runTemplaterOnNewNotes"
		);
		this.toggle(
			"Open dashboard on startup",
			"Reveal the sidebar when Obsidian starts.",
			"openDashboardOnStart"
		);

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

	private toggle(name: string, desc: string, key: BooleanKey): void {
		new Setting(this.containerEl)
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

