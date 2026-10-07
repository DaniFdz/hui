export const WIDGET_CODE_MAX_BYTES: number;
export const WIDGET_TITLE_MAX_LENGTH: number;
export class WidgetInputError extends Error {}
export type WidgetScriptSyntaxError = { scriptIndex: number; message: string; line?: number; column?: number; snippet?: string };
export function findWidgetScriptSyntaxError(code: string): Promise<WidgetScriptSyntaxError | undefined>;
export function validateWidget(params: unknown): Promise<{ title: string; code: string; mode: "html" | "svg"; bytes: number }>;
