/**
 * Entries every Durable conversation's history may hold beside the model's
 * messages, which history projection and OptChat read for all conversations:
 * the record of a GPT-Live call.
 */
import { defineEntry } from "@earendil-works/pi-durable";
import type { CallRecord } from "../../shared/calls.ts";

/**
 * The record of one GPT-Live call with the bot (HUI-18): its summary and its whole transcript (`CallRecord`), written
 * once at hang-up as a passive entry, so no model turn runs for it. It carries no model messages: the chat shows it
 * as one card, OptChat logs it (its transcript and summary, marked `[call]`), and Durable places it at a running
 * turn's next boundary.
 */
export const CallEntry = defineEntry<CallRecord>("hui.call");
