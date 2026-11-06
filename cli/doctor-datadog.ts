/**
 * Datadog orgs HUI cannot find a pup session for. HUI keeps its own pup sessions as files under `PUP_CONFIG_DIR`
 * rather than the OS keychain, because a keychain entry is the one thing that cannot be given to a remote worker
 * (`worker/integration-logins.ts`). A session signed in before that change is still in the keychain, which HUI does
 * not read, so the org reads *Sign in needed*. The sign-in runs in a browser, so this check only reports it.
 */
import { DatadogOrgStore, PUP_CONFIG_DIR, pupOrgKey, pupSiteFile, storedPupOrgs } from "../server/integrations/datadog.ts";
import type { DatadogOrg } from "../server/api/datadog.ts";
import type { DoctorCheck, DoctorItem, DoctorResult } from "./doctor-types.ts";

const ID = "datadog";
const TITLE = "Datadog";

const label = (org: DatadogOrg) => `${org.name || "the default session"} at ${org.site}`;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const need = (count: number) => `${count} ${count === 1 ? "org needs" : "orgs need"}`;

function result(orgs: readonly DatadogOrg[], unstored: readonly DatadogOrg[], unreadable?: string): DoctorResult {
  const items: DoctorItem[] = [
    ...unstored.map((org): DoctorItem => ({
      id: `${org.site}/${org.name || "default"}`,
      label: label(org),
      status: "blocked",
      detail: `no pup session in ${PUP_CONFIG_DIR}`,
    })),
    ...(unreadable ? [{ id: "datadog.json", label: "datadog.json", status: "blocked" as const, detail: unreadable }] : []),
  ];
  const notes = items.length ? [
    "HUI keeps pup's Datadog sessions in its own directory so it can give them to a worker; a session made before that lives in the system keychain and is not read here. Sign in again in Settings → Integrations → Datadog.",
  ] : [];
  const summary = unreadable ? "datadog.json can't be read"
    : !orgs.length ? "no Datadog org is configured"
      : unstored.length ? `${need(unstored.length)} a sign-in in Settings → Integrations → Datadog`
        : "every org has its pup session in HUI's own directory";
  return { id: ID, title: TITLE, status: items.length ? "issue" : "ok", summary, items, notes };
}

export const datadogCheck: DoctorCheck = {
  id: ID,
  title: TITLE,
  async inspect() {
    let orgs: DatadogOrg[] = [];
    let unreadable: string | undefined;
    try {
      orgs = await new DatadogOrgStore().read();
    } catch (error) {
      unreadable = message(error);
    }
    const stored = await storedPupOrgs();
    const unstored = orgs.filter((org) => !stored.get(pupSiteFile(org.site))?.has(pupOrgKey(org)));
    return result(orgs, unstored, unreadable);
  },
};
