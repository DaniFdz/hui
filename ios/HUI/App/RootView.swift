// The root screen: Connect until a gateway answers, then the session list with a stack of destinations. A
// hui://open?path=<path> link is resolved by the core's resolveNavigation, as the web resolves its address bar, and
// replaces that stack; a link that arrives before the gateway connects opens once it does. The open session is kept in
// the preferences with its gateway's address, so the app opens it again when it restarts against the same gateway, as
// a reload keeps the web's address. The screen's container carries the address it shows as its accessibility value,
// under the identifier app-route, for tests; VoiceOver doesn't speak a container's value.
import SwiftUI

struct RootView: View {
    let core: HUICore
    @State private var gateway = GatewayModel()
    @State private var sessions: SessionsModel
    @State private var path: [String] = []
    @AppStorage("HUIOpenSession") private var openSession = ""

    init(core: HUICore) {
        self.core = core
        _sessions = State(initialValue: SessionsModel(core: core))
    }

    var body: some View {
        Group {
            if gateway.state == .connected {
                NavigationStack(path: $path) {
                    SessionListView(sessions: sessions, client: gateway.client, notice: gateway.notice)
                        .navigationDestination(for: String.self) { id in
                            if let client = gateway.client {
                                ChatView(id: id, client: client, core: core, title: sessions.session(id)?.title).id(id)
                            }
                        }
                }
            } else {
                ConnectView(gateway: gateway)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("app-route")
        .accessibilityValue(path.last.map { "/sessions/\($0)" } ?? "/")
        .task {
            if !gateway.url.isEmpty { await gateway.connect() }
        }
        .onChange(of: gateway.state) {
            guard gateway.state == .connected, let client = gateway.client else { return }
            sessions.start(client)
            if path.isEmpty, let id = openSession.split(separator: " ").last, openSession == "\(gateway.url) \(id)" { path = [String(id)] }
        }
        .onChange(of: path) { openSession = path.last.map { "\(gateway.url) \($0)" } ?? "" }
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
