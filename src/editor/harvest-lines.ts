import { editorLivePreviewField, MarkdownPostProcessor } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";

export interface HarvestLineOptions {
	enabled: boolean;
	prefixes: string[];
}

const PREFIX_CLASS = "meetings-plus-harvest-prefix";
const LEAD = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?/;
const MP_BLOCK_ID = /[ \t]+\^mp-[a-z0-9]{6}[ \t]*$/;

/** Length of the configured prefix at the start of `text`, or 0. */
function prefixAt(text: string, prefixes: string[]): number {
	for (const prefix of prefixes) {
		if (!prefix || !text.startsWith(prefix)) continue;
		const after = text.charAt(prefix.length);
		if (after === "" || after === " " || after === "\t") return prefix.length;
	}
	return 0;
}

/**
 * Live Preview: hides a trailing " ^mp-xxxxxx" except on lines the
 * selection touches, and marks Q:/A: prefixes at the start of a line.
 */
export function harvestLines(options: () => HarvestLineOptions) {
	const hidden = Decoration.replace({});
	const prefixMark = Decoration.mark({ class: PREFIX_CLASS });

	const build = (view: EditorView): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		const { enabled, prefixes } = options();
		if (!enabled || !view.state.field(editorLivePreviewField)) {
			return builder.finish();
		}
		const { doc, selection } = view.state;
		for (const { from, to } of view.visibleRanges) {
			let pos = from;
			while (pos <= to) {
				const line = doc.lineAt(pos);
				const lead = LEAD.exec(line.text)?.[0].length ?? 0;
				const length = prefixAt(line.text.slice(lead), prefixes);
				if (length > 0) {
					builder.add(line.from + lead, line.from + lead + length, prefixMark);
				}
				const id = MP_BLOCK_ID.exec(line.text);
				if (
					id &&
					id.index >= lead + length &&
					!selection.ranges.some(
						(r) => r.from <= line.to && r.to >= line.from
					)
				) {
					builder.add(line.from + id.index, line.to, hidden);
				}
				pos = line.to + 1;
			}
		}
		return builder.finish();
	};

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = build(view);
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.selectionSet ||
					update.transactions.some((tr) => tr.reconfigured) ||
					update.startState.field(editorLivePreviewField) !==
						update.state.field(editorLivePreviewField)
				) {
					this.decorations = build(update.view);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

/** Reading view: wraps Q:/A: prefixes at the start of a line in a span. */
export function harvestPrefixPostProcessor(
	options: () => HarvestLineOptions
): MarkdownPostProcessor {
	return (el) => {
		const { enabled, prefixes } = options();
		if (!enabled) return;
		const blocks: HTMLElement[] = [];
		if (el.matches("p, li")) blocks.push(el);
		el.querySelectorAll<HTMLElement>("p, li").forEach((b) => blocks.push(b));
		for (const block of blocks) {
			let atStart = true;
			for (const node of Array.from(block.childNodes)) {
				if (node.instanceOf(HTMLBRElement)) {
					atStart = true;
					continue;
				}
				if (!atStart) continue;
				if (node.nodeType === Node.TEXT_NODE) {
					const data = node.textContent ?? "";
					const lead = data.length - data.trimStart().length;
					if (lead === data.length) continue;
					atStart = false;
					const length = prefixAt(data.slice(lead), prefixes);
					if (length === 0) continue;
					const rest = (node as Text).splitText(lead);
					rest.splitText(length);
					const span = createSpan({ cls: PREFIX_CLASS, text: rest.data });
					rest.replaceWith(span);
				} else if ((node.textContent ?? "").trim() !== "") {
					atStart = false;
				}
			}
		}
	};
}
