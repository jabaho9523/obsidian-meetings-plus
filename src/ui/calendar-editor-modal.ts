import { App, Modal, Setting, TextAreaComponent, Notice } from "obsidian";
import { CalendarConfig, NoteDestination } from "../types";
import { FolderSuggestModal } from "./folder-suggest";
import MeetingsPlusPlugin from "../main";
import { fetchICS } from "../calendar/fetcher";

export class CalendarEditorModal extends Modal {
	private working: CalendarConfig;

	constructor(
		app: App,
		private readonly plugin: MeetingsPlusPlugin,
		initial: CalendarConfig,
		private readonly onSave: (cal: CalendarConfig) => void | Promise<void>
	) {
		super(app);
		this.working = { ...initial, tags: [...initial.tags] };
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("meetings-plus-editor");

		contentEl.createEl("h2", { text: "Calendar" });

		new Setting(contentEl)
			.setName("Display name")
			.setDesc("Shown in the sidebar and settings list.")
			.addText((t) =>
				t
					.setPlaceholder("Work")
					.setValue(this.working.name)
					.onChange((v) => {
						this.working.name = v;
					})
			);

		let statusDiv: HTMLDivElement;

		new Setting(contentEl)
			.setName("Calendar feed")
			.setDesc(
				"Paste the public link to your calendar. Look for share, publish, or secret address in your calendar app."
			)
			.addText((t) => {
				t.setPlaceholder("https://example.com/calendar.ics")
					.setValue(this.working.url)
					.onChange((v) => {
						this.working.url = v.trim();
						if (statusDiv) {
							statusDiv.className =
								"meetings-plus-test-status";
						}
					});
				t.inputEl.addClass("meetings-plus-input-wide");
			})
			.addButton((b) => {
				b.setButtonText("Test connection")
					.onClick(async () => {
						const url = this.working.url.trim();
						if (!url) {
							new Notice("Please enter a calendar feed URL first.");
							return;
						}

						b.setDisabled(true);
						b.setButtonText("Testing...");
						statusDiv.setText("Connecting...");
						statusDiv.className = "meetings-plus-test-status testing";

						try {
							const timeoutMs =
								this.plugin.settings.requestTimeoutSeconds *
								1000;
							await fetchICS(url, { timeoutMs });
							new Notice("Connection successful!");
							statusDiv.setText("Connection successful! Valid calendar feed.");
							statusDiv.className = "meetings-plus-test-status success";
						} catch (e) {
							const errMsg = e instanceof Error ? e.message : String(e);
							new Notice(`Connection failed: ${errMsg}`);
							statusDiv.setText(`Connection failed: ${errMsg}`);
							statusDiv.className = "meetings-plus-test-status error";
						} finally {
							b.setDisabled(false);
							b.setButtonText("Test connection");
						}
					});
			});

		statusDiv = contentEl.createDiv({
			cls: "meetings-plus-test-status",
		});

		new Setting(contentEl)
			.setName("Color")
			.setDesc("Used for the source dot in the sidebar.")
			.addColorPicker((c) =>
				c.setValue(this.working.color).onChange((v) => {
					this.working.color = v;
				})
			);

		new Setting(contentEl)
			.setName("Enabled")
			.addToggle((t) =>
				t
					.setValue(this.working.enabled)
					.onChange((v) => {
						this.working.enabled = v;
					})
			);

		new Setting(contentEl)
			.setName("Folder for meeting notes")
			.setDesc("Notes from this calendar are created here.")
			.addText((t) => {
				t.setPlaceholder("Meetings")
					.setValue(this.working.folder)
					.onChange((v) => {
						this.working.folder = v;
					});
				t.inputEl.addClass("meetings-plus-input-wide");
			})
			.addButton((b) =>
				b.setButtonText("Browse").onClick(() => {
					new FolderSuggestModal(this.app, (path) => {
						this.working.folder = path;
						this.refresh();
					}).open();
				})
			);

		new Setting(contentEl)
			.setName("Note title pattern")
			.addText((t) => {
				t.setPlaceholder("{{date}} - {{title}}")
					.setValue(this.working.titlePattern)
					.onChange((v) => {
						this.working.titlePattern = v;
					});
				t.inputEl.addClass("meetings-plus-input-wide");
			});

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated, without the leading #.")
			.addText((t) => {
				t.setPlaceholder("Meeting, work")
					.setValue(this.working.tags.join(", "))
					.onChange((v) => {
						this.working.tags = v
							.split(",")
							.map((s) => s.trim().replace(/^#/, ""))
							.filter((s) => s.length > 0);
					});
				t.inputEl.addClass("meetings-plus-input-wide");
			});

		new Setting(contentEl)
			.setName("Note destination")
			.setDesc(
				"Where clicking a meeting writes its note. Standalone file goes into the folder above; daily note section appends inside today's daily note."
			)
			.addDropdown((d) => {
				d.addOption("file", "Standalone file");
				d.addOption("daily-note", "Today's daily note (as section)");
				d.addOption(
					"daily-note-event-date",
					"Daily note of the event's date (as section)"
				);
				d.addOption("none", "Don't create notes");
				d.setValue(this.working.noteDestination);
				d.onChange((v) => {
					this.working.noteDestination = v as NoteDestination;
				});
			});

		new Setting(contentEl)
			.setName("Show meeting list in daily note")
			.setDesc(
				"Also maintain a managed list of today's meetings inside the daily note. Independent of note destination above."
			)
			.addToggle((t) =>
				t
					.setValue(this.working.appendToDailyNote)
					.onChange((v) => {
						this.working.appendToDailyNote = v;
					})
			);

		new Setting(contentEl)
			.setName("Exclude all-day events")
			.addToggle((t) =>
				t
					.setValue(this.working.excludeAllDay)
					.onChange((v) => {
						this.working.excludeAllDay = v;
					})
			);

		new Setting(contentEl)
			.setName("Template")
			.setDesc(
				"Supports {{title}}, {{date}}, {{start:HH:mm}}, {{end:HH:mm}}, {{duration}}, {{location}}, {{meeting_url}}, {{description}}, {{organizer}}, {{attendees}}, {{attendees_list}}, {{attendees_wikilinks}}, {{calendar}}, {{uid}}, {{dedup_key}}, {{tags}}."
			)
			.addTextArea((t: TextAreaComponent) => {
				t.setValue(this.working.template).onChange((v) => {
					this.working.template = v;
				});
				t.inputEl.rows = 18;
				t.inputEl.addClass("meetings-plus-input-wide");
				t.inputEl.addClass("meetings-plus-input-mono");
			});

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						if (!this.working.name.trim()) {
							this.working.name = "Untitled calendar";
						}
						this.close();
						await this.onSave(this.working);
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private refresh(): void {
		this.onOpen();
	}
}
