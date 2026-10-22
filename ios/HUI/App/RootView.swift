// The root screen: Connect until a gateway answers, then the session list with a stack of destinations. A
// hui://open?path=<path> link is resolved by the core's resolveNavigation, as the web resolves its address bar, and
// replaces that stack; a link that arrives before the gateway connects opens once it does. The open session is kept in
// the preferences, so the app opens it again when it restarts, as a reload keeps the web's address.
import SwiftUI

struct RootView: View {
    let core: HUICore
    @State private var gateway = GatewayModel()
    @State private var sessions: SessionsModel
    @State private var path: [String] = []
    @AppStorage("openSession") private var openSession = ""

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
                            if let client = gateway.client {
                                ChatView(id: id, client: client, core: core, title: sessions.session(id)?.title).id(id)
                            }
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
            guard gateway.state == .connected, let client = gateway.client else { return }
            sessions.start(client)
            if path.isEmpty, !openSession.isEmpty { path = [openSession] }
        }
        .onChange(of: path) { openSession = path.last ?? "" }
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
