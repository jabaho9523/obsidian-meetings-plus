/**
 * Calendar feeds are untrusted input. These helpers make the safe rendering
 * mode explicit instead of relying on every template call site to remember
 * which syntax needs escaping.
 */
export function escapeTemplaterSyntax(value: string): string {
	// Templater executes commands beginning with `<%`. Encode the opening token
	// so a value from an ICS event remains visible text after Markdown renders.
	return value.replace(/<%/g, "&lt;%");
}

/** Render external content as one line of Markdown text, not Markdown syntax. */
export function escapeMarkdownText(value: string): string {
	return value
		.replace(/\r\n?|\n/g, " ")
		.replace(/\\/g, "\\\\")
		.replace(/[!#*_`|()[\]\\]/g, "\\$&")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** JSON strings and arrays are valid YAML and safely preserve special text. */
export function yamlString(value: string): string {
	return JSON.stringify(value);
}

export function yamlStringList(values: string[]): string {
	return JSON.stringify(values);
}
