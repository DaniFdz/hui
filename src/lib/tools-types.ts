/** Data-only contract shared by the browser and runtime adapters. */
export type ToolCatalogEntry = {
  name: string;
  description: string;
  source: string;
  defaultEnabled: boolean;
};

export type RuntimeTool = {
  name: string;
  description: string;
  source: string;
  active: boolean;
  parameters: unknown;
};

export type RuntimeInspection = {
  status: "live";
  backend: string;
  version: string;
  revision: string;
  tools: RuntimeTool[];
  prompt: string;
  promptPhase: "initialized" | "current-turn" | "last-turn";
  promptSource: string;
  diagnostics: string[];
};

export type SessionTools = RuntimeInspection | { status: "cold" | "unsupported" };

export type ToolsCatalog = {
  backend: "sdk" | "cli";
  sdkVersion: string;
  tools: ToolCatalogEntry[];
  sources: string[];
  diagnostics: string[];
  prompt: { revision: string; text: string };
};
