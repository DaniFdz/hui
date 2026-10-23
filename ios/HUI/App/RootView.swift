// The root screen: Connect until a gateway answers, then the session list with a stack of destinations. A
// hui://open?path=<path> link is resolved by the core's resolveNavigation, as the web resolves its address bar, and
// replaces that stack at once, as an address does; a link that arrives before the gateway connects opens once it does.
// The open screen's address is kept in the preferences after its gateway's, so the app opens it again when it restarts
// against the same gateway, as a reload keeps the web's address. Archiving or deleting the open session's tree from its
// menu returns to the list, as the web returns Home. Going back to the list keeps the session it came from selected,
// so its tree stays expanded as the web's sidebar keeps it beside the open chat. The screen's container carries the
// address it shows as its accessibility value, under the identifier app-route, for tests; VoiceOver doesn't speak a
// container's value. The gateway's settings, read once it connects, set every screen's colour mode, theme colours and text size.
import SwiftUI

struct RootView: View {
    let core: HUICore
    @State private var gateway = GatewayModel()
    @State private var sessions: SessionsModel
    @State private var settings = SettingsModel()
    @State private var path: [Screen] = []
    @State private var route = "/"
    @State private var navigations = 0
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
                        .modifier(Themed(settings: settings))
                        .navigationDestination(for: Screen.self) { screen in
                            Group {
                                switch screen {
                                case .session(let id):
                                    if let client = gateway.client {
                                        ChatView(id: id, client: client, core: core, sessions: sessions).id(id)
                                    }
                                case .sessionsPage:
                                    SessionsPageView(sessions: sessions, client: gateway.client)
                                case .settings(let page):
                                    SettingsView(page: page, core: core, settings: settings, client: gateway.client,
                                                 select: { chosen in replace([.settings(chosen)]) }, exit: { path = [] })
                                }
                            }
                            .modifier(Themed(settings: settings))
                        }
                }
                .modifier(SessionNotices(sessions: sessions, client: gateway.client))
            } else {
                ConnectView(gateway: gateway)
            }
        }
        .preferredColorScheme(settings.colorScheme)
        .dynamicTypeSize(settings.dynamicTypeSize)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("app-route")
        .accessibilityValue(route)
        .task {
            if !gateway.url.isEmpty { await gateway.connect() }
        }
        .onChange(of: gateway.state) {
            guard gateway.state == .connected, let client = gateway.client else { return }
            sessions.start(client)
            Task { await settings.load(client) }
            if path.isEmpty, openSession.hasPrefix("\(gateway.url)/") { Task { await go(String(openSession.dropFirst(gateway.url.count))) } }
        }
        .onChange(of: path) {
            if let id = path.last?.session { sessions.selected = id }
            let last = path.last
            Task {
                let address = switch last {
                case .session(let id): (try? await core.sessionPath(id)) ?? "/"
                case .sessionsPage: "/sessions"
                case .settings(let page): "/settings/\(page)"
                case nil: "/"
                }
                if path.last == last {
                    route = address
                    openSession = gateway.url + address
                }
            }
        }
        .onChange(of: sessions.renaming) {
            if !sessions.renaming.isEmpty, path.last?.session != sessions.renaming { path = [.session(sessions.renaming)] }
        }
        .onChange(of: sessions.closed) {
            if path.contains(where: { $0.session.map(sessions.closed.contains) == true }) { path = [] }
            if sessions.closed.contains(sessions.selected) { sessions.selected = "" }
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
        navigations += 1
        let navigation = navigations
        guard let resolution = try? await core.resolveNavigation(target), navigation == navigations else { return }
        switch resolution.target {
        case .session(let id): replace([.session(id)])
        case .page("sessions"): replace([.sessionsPage])
        case .settings(let page): replace([.settings(page)])
        default: replace([])
        }
    }

    private func replace(_ screens: [Screen]) {
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { path = screens }
    }
}

enum Screen: Hashable {
    case session(String)
    case sessionsPage
    case settings(String)

    var session: String? {
        if case .session(let id) = self { id } else { nil }
    }
}
