import type { TranscriptEntry } from "../../server/runtimes/types.ts";

/** Small builders for synthetic eval transcripts. Fixtures are invented; never
 * paste real sessions here, because they can hold private or employer data. */
let toolId = 0;

export const user = (text: string): TranscriptEntry => ({ kind: "message", role: "user", text });
export const assistant = (text: string): TranscriptEntry => ({ kind: "message", role: "assistant", text });
export const thinking = (text: string): TranscriptEntry => ({ kind: "thinking", text });
export const edit = (path: string): TranscriptEntry => ({ kind: "tool", id: `t${++toolId}`, name: "edit", args: { path }, output: "Applied 1 edit." });
export const write = (path: string): TranscriptEntry => ({ kind: "tool", id: `t${++toolId}`, name: "write", args: { path }, output: "Wrote file." });
export const read = (path: string): TranscriptEntry => ({ kind: "tool", id: `t${++toolId}`, name: "read", args: { path }, output: "…" });
export const bash = (command: string, output = ""): TranscriptEntry => ({ kind: "tool", id: `t${++toolId}`, name: "bash", args: { command }, output });

/** One agent step: the tools it ran, then the message the operator sees. */
export function step(text: string, tools: TranscriptEntry[] = []): TranscriptEntry[] {
  return [...tools, assistant(text)];
}
