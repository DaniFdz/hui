import { expectTypeOf, test } from "vitest";
import type * as Bots from "./api/bots.ts";
import type * as Triggers from "./api/bot-triggers.ts";

type LegacyBotFactKind = "fact" | "preference" | "decision";
type LegacyBotFactInput = { kind: LegacyBotFactKind; text: string; source?: string; pinned?: boolean };
type LegacyBotFact = {
  id: string;
  kind: LegacyBotFactKind;
  text: string;
  pinned: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
};
type LegacyBotFactPatch = { kind?: LegacyBotFactKind; text?: string; pinned?: boolean; revision: number };

type LegacyBotTriggerSource = "listener";
type LegacyTriggerMatch = { field: string; op: "equals" | "contains"; value: string };
type LegacyBotTriggerFilter = { match?: LegacyTriggerMatch; prLinks?: true; bots?: true; external?: true };
type LegacyBotTriggerBase = {
  id: string;
  botId: string;
  name: string;
  source: LegacyBotTriggerSource;
  filter: LegacyBotTriggerFilter;
  prompt?: string;
  delivery?: "followUp" | "steer";
  enabled: boolean;
  cooldownSeconds: number;
  createdBy: "operator" | "bot";
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
  tokenHint?: string;
};
type LegacyBotTrigger = LegacyBotTriggerBase & { pending?: { events: number; until: string }; watch?: { polledAt?: string; error?: string } };
type LegacyBotTriggerRunStatus = "fired" | "coalesced" | "skipped" | "failed";
type LegacyBotTriggerRun = {
  id: string;
  triggerId: string;
  triggerName: string;
  at: string;
  status: LegacyBotTriggerRunStatus;
  events: number;
  summary: string;
  reason?: string;
  test?: true;
  catchUp?: true;
};
type LegacyBotTriggersList = { triggers: LegacyBotTrigger[]; runs: LegacyBotTriggerRun[]; deliveries: { lastHour: number; perHour: number } };
type LegacyBotTriggerCreated = { trigger: LegacyBotTrigger; hook: { token: string; path: string } };
type LegacyBotTriggerInput = { name: string; source: LegacyBotTriggerSource; filter: LegacyBotTriggerFilter; prompt?: string; delivery?: "followUp" | "steer"; enabled?: boolean; cooldownSeconds?: number };
type LegacyBotTriggerPatch = {
  name?: string;
  prompt?: string;
  delivery?: "followUp" | "steer";
  enabled?: boolean;
  cooldownSeconds?: number;
  filter?: Record<string, unknown>;
};

test("the schemas preserve the existing bot memory and trigger payload types", () => {
  expectTypeOf<LegacyBotFact>().toEqualTypeOf<Bots.BotFact>();
  expectTypeOf<LegacyBotFactInput>().toEqualTypeOf<Bots.BotFactInput>();
  expectTypeOf<LegacyBotFactPatch>().toEqualTypeOf<Bots.BotFactPatch>();
  expectTypeOf<LegacyTriggerMatch>().toEqualTypeOf<Triggers.TriggerMatch>();
  expectTypeOf<LegacyBotTriggerFilter>().toEqualTypeOf<Triggers.BotTriggerFilter>();
  expectTypeOf<LegacyBotTrigger>().toMatchTypeOf<Triggers.BotTrigger>();
  expectTypeOf<Triggers.BotTrigger>().toMatchTypeOf<LegacyBotTrigger>();
  expectTypeOf<LegacyBotTriggerRun>().toEqualTypeOf<Triggers.BotTriggerRun>();
  expectTypeOf<LegacyBotTriggersList>().toMatchTypeOf<Triggers.BotTriggersList>();
  expectTypeOf<Triggers.BotTriggersList>().toMatchTypeOf<LegacyBotTriggersList>();
  expectTypeOf<LegacyBotTriggerCreated>().toMatchTypeOf<Triggers.BotTriggerCreated>();
  expectTypeOf<Triggers.BotTriggerCreated>().toMatchTypeOf<LegacyBotTriggerCreated>();
  expectTypeOf<LegacyBotTriggerInput>().toEqualTypeOf<Triggers.BotTriggerInput>();
  expectTypeOf<LegacyBotTriggerPatch>().toEqualTypeOf<Triggers.BotTriggerPatch>();
});
