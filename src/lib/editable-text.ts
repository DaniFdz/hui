/**
 * Editor text versus file text. CodeMirror works on LF-normalized text; a file keeps its own separators. These
 * helpers turn the editor's changes back into the file's text without touching separators the edit did not cross,
 * including mixed endings, a BOM and a missing final newline.
 *
 * Ported from AgentsInTheCloud (packages/files/src/editable-text.ts, MIT, see THIRD_PARTY_NOTICES.md).
 */
export type FileTextChange = { from: number; to: number; insert: string };

/** The file's text as the editor shows it: every CRLF or lone CR becomes LF. */
export function editorText(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

/**
 * Applies editor changes (offsets into `editorText(content)`, in ascending order) to the file's own text. Untouched
 * separators stay byte for byte; inserted lines use the file's first separator.
 */
export function editFileText(content: string, changes: readonly FileTextChange[]): string {
  const separator = content.match(/\r\n?|\n/)?.[0] ?? "\n";
  const offsets: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\r" && content[i + 1] === "\n") i++;
    offsets.push(i + 1);
  }
  let result = "";
  let position = 0;
  for (const change of changes) {
    result += content.slice(position, offsets[change.from]) + change.insert.replace(/\r\n?|\n/g, separator);
    position = offsets[change.to]!;
  }
  return result + content.slice(position);
}
