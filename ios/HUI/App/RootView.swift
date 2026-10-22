// The root screen: Connect until a gateway answers, then the session list with a stack of destinations. A
// hui://open?path=<path> link is resolved by the core's resolveNavigation, as the web resolves its address bar, and
// replaces that stack; a link that arrives before the gateway connects opens once it does.
import SwiftUI

struct RootView: View {
    let core: HUICore
    @State private var gateway = GatewayModel()
    @State private var sessions: SessionsModel
    @State private var path: [String] = []

    init(core: HUICore) {
        self.core = core
        _sessions = State(initialValue: SessionsModel(core: core))
    }

    var body: some View {
        Group {
            if gateway.state == .connected {
                NavigationStack(path: $path) {
                    SessionListView(sessions: sessions, notice: gateway.notice)
                        .navigationDestination(for: String.self) { id in
                            SessionPlaceholderView(id: id, sessions: sessions)
                        }
                }
            } else {
                ConnectView(gateway: gateway)
            }
        }
        .task {
            if !gateway.url.isEmpty { await gateway.connect() }
        }
        .onChange(of: gateway.state) {
            if gateway.state == .connected, let client = gateway.client { sessions.start(client) }
        }
        .onOpenURL { url in
            Task { await open(url) }
        }
    }

    private func open(_ url: URL) async {
        guard url.scheme == "hui", url.host() == "open",
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value,
              let resolution = try? await core.resolveNavigation(target) else { return }
        if case .session(let id) = resolution.target {
            path = [id]
        } else {
            path = []
        }
    }
}
