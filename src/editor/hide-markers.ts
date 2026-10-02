import { editorLivePreviewField } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { SECTION_MARKER_LINE_RE } from "../notes/creator";

export function hideSectionMarkers(isEnabled: () => boolean) {
	const hidden = Decoration.replace({});

	const build = (view: EditorView): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		if (!isEnabled() || !view.state.field(editorLivePreviewField)) {
			return builder.finish();
		}
		const { doc, selection } = view.state;
		for (const { from, to } of view.visibleRanges) {
			let pos = from;
			while (pos <= to) {
				const line = doc.lineAt(pos);
				if (
					line.length > 0 &&
					SECTION_MARKER_LINE_RE.test(line.text) &&
					!selection.ranges.some(
						(r) => r.from <= line.to && r.to >= line.from
					)
				) {
					builder.add(line.from, line.to, hidden);
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
