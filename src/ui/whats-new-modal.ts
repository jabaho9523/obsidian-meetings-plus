import { App, Component, MarkdownRenderer, Modal, setIcon } from "obsidian";
import { PLUGIN_NAME } from "../constants";
import { linkHandles } from "../whats-new/versions";

export const SUPPORT_URL = "https://www.buymeacoffee.com/jabaho";

export class WhatsNewModal extends Modal {
	private component = new Component();

	constructor(
		app: App,
		private majorMinor: string,
		private notes: [string, string][]
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("meetings-plus-whats-new");
		this.setTitle(`What's new in ${PLUGIN_NAME} ${this.majorMinor}`);
		this.component.load();

		const body = contentEl.createDiv({ cls: "meetings-plus-whats-new-notes" });
		const [newest, ...older] = this.notes;
		if (!newest) {
			body.createEl("p", { text: "No release notes for this version." });
		} else {
			body.createEl("h3", { text: newest[0] });
			const section = body.createDiv();
			void MarkdownRenderer.render(this.app, linkHandles(newest[1]), section, "", this.component);
		}
		for (const [version, text] of older) {
			const details = body.createEl("details");
			details.createEl("summary", { text: version });
			const section = details.createDiv();
			void MarkdownRenderer.render(this.app, linkHandles(text), section, "", this.component);
		}
		body.addEventListener("click", (evt) => {
			const link = (evt.target as HTMLElement).closest("a");
			const href = link?.getAttribute("href") ?? "";
			if (!/^https?:\/\//.test(href)) return;
			evt.preventDefault();
			window.open(href, "_blank");
		});

		const support = contentEl.createDiv({ cls: "meetings-plus-whats-new-support" });
		support.createEl("p", {
			text: `${PLUGIN_NAME} is free. If it saves you time, you can buy me a coffee.`,
		});
		const button = support.createEl("button", { cls: "meetings-plus-coffee-button" });
		setIcon(button.createSpan({ cls: "meetings-plus-coffee-icon" }), "coffee");
		button.createSpan({ text: "Buy me a coffee" });
		button.addEventListener("click", () => {
			window.open(SUPPORT_URL, "_blank");
		});
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}
}
