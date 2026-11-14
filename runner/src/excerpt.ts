/** The source line with a caret under `column` (0-based); long lines show a window around it */
export function excerpt(source: string, column: number): string[] {
	const WINDOW = 100;
	let start = 0;
	let text = source;
	if (source.length > 2 * WINDOW) {
		start = Math.max(0, column - WINDOW);
		text = source.slice(start, start + 2 * WINDOW);
	}
	const prefix = start > 0 ? '…' : '';
	const suffix = start + text.length < source.length ? '…' : '';
	const caret = ' '.repeat(prefix.length + Math.max(0, column - start));
	return [`  ${prefix}${text}${suffix}`, `  ${caret}^`];
}
