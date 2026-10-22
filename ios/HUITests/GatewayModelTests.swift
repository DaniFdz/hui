// The gateway version check: which gateways get a notice, and what it names.
import Testing
@testable import HUI

struct GatewayModelTests {
    @Test func namesBothVersionsWhenTheGatewayIsOlderOrNewer() {
        #expect(GatewayModel.versionNotice(gateway: "0.1.4", app: "0.1.5") == "This gateway runs HUI 0.1.4, older than this app supports (0.1.5). Update the gateway.")
        #expect(GatewayModel.versionNotice(gateway: "0.1.10", app: "0.1.5") == "This gateway runs HUI 0.1.10, newer than this app (0.1.5).")
        #expect(GatewayModel.versionNotice(gateway: "0.1.5", app: "0.1.5") == nil)
    }

    @Test func anUnversionedGatewayIsUnverified() {
        #expect(GatewayModel.versionNotice(gateway: nil, app: "0.1.5") == "Development gateway: its version is unverified.")
    }
}
