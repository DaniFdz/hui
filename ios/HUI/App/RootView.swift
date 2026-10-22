// The root screen: Connect until a gateway answers, then the session list with a stack of destinations. A
// hui://open?path=<path> link is resolved by the core's resolveNavigation, as the web resolves its address bar, and
// replaces that stack at once, as an address does; a link that arrives before the gateway connects opens once it does. The open screen's address is
// kept in the preferences after its gateway's, so the app opens it again when it restarts against the same gateway, as
// a reload keeps the web's address. Archiving or deleting the open session's tree from its menu returns to the list,
// as the web returns Home.
import SwiftUI

struct RootView: View {
    let core: HUICore
    @State private var gateway = GatewayModel()
    @State private var sessions: SessionsModel
    @State private var path: [Screen] = []
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
                        .navigationDestination(for: Screen.self) { screen in
                            switch screen {
                            case .session(let id):
                                if let client = gateway.client {
                                    ChatView(id: id, client: client, core: core, sessions: sessions).id(id)
                                }
                            case .sessionsPage:
                                SessionsPageView(sessions: sessions, client: gateway.client)
                            }
                        }
                }
                .modifier(SessionNotices(sessions: sessions, client: gateway.client))
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
            if path.isEmpty, openSession.hasPrefix("\(gateway.url)/") { Task { await go(String(openSession.dropFirst(gateway.url.count))) } }
        }
        .onChange(of: path) {
            sessions.selected = path.last?.session ?? ""
            let last = path.last
            Task {
                let address = switch last {
                case .session(let id): (try? await core.sessionPath(id)) ?? "/"
                case .sessionsPage: "/sessions"
                case nil: "/"
                }
                openSession = gateway.url + address
            }
        }
        .onChange(of: sessions.closed) {
            if let open = path.last?.session, sessions.closed.contains(open) { path = [] }
            sessions.closed = []
        }
        .onOpenURL { url in
            Task { await open(url) }
        }
    }

    private func open(_ url: URL) async {
        guard url.scheme == "hui", url.host() == "open",
              let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value else { return }
        await go(target)
    }

    private func go(_ target: String) async {
        guard let resolution = try? await core.resolveNavigation(target) else { return }
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) {
            switch resolution.target {
            case .session(let id): path = [.session(id)]
            case .page("sessions"): path = [.sessionsPage]
            default: path = []
            }
        }
    }
}

enum Screen: Hashable {
    case session(String)
    case sessionsPage

    var session: String? {
        if case .session(let id) = self { id } else { nil }
    }
}
