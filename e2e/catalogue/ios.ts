/** The IOS use cases: what only the iPhone app does, such as connecting to a gateway by its address and checking its version. */
import type { UseCase } from "./types.ts";

const cases: UseCase[] = [
  {
    id: "IOS-001",
    title: "Connect to a gateway and see its version",
    behaviour: "With no remembered gateway the app opens on Connect to HUI, and Connect with an empty Gateway URL asks for the gateway's address. A HUI gateway's address, typed there or given by the -HUIGatewayURL launch argument, opens the session list with the gateway's sessions and is remembered for the next launch. A development gateway, which has no version, shows \"Development gateway: its version is unverified.\"; one older or newer than the app shows a notice naming both versions and one on the app's version shows none, which the app's unit tests check.",
    spec: ["SPEC.md#the-ios-app-connects-to-one-gateway-2026-10-21"],
    surfaces: [],
    web: { excluded: "The web UI is served by the gateway it talks to, so it never connects to one by address.", decision: "SPEC.md#the-ios-app-connects-to-one-gateway-2026-10-21" },
    ios: "required",
  },
];

export default cases;
