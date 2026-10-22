// The web's Sessions page, reached at /sessions and from the session list's toolbar: every session of the registry
// in the list's order, filtered by the Session state choice (All, Active or Archived), each row with its Pinned,
// Unread and Archived chips, its status and Open, or Restore for an archived session.
import SwiftUI

struct SessionsPageView: View {
    let sessions: SessionsModel
    let client: GatewayClient?
    @State private var state = "all"

    var body: some View {
        let rows = sessions.page(state)
        List {
            Picker("Session state", selection: $state) {
                Text("All").tag("all")
                Text("Active").tag("active")
                Text("Archived").tag("archived")
            }
            .pickerStyle(.segmented)
            ForEach(rows, id: \.id) { session in
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.title)
                        HStack {
                            ForEach([("Pinned", session.pinned), ("Unread", session.unread), ("Archived", session.archived)].filter { $0.1 == true }, id: \.0) { chip in
                                Text(chip.0).font(.caption).padding(.horizontal, 6).background(.quaternary, in: .capsule)
                            }
                            Text(session.archived == true ? "archived" : session.status.rawValue).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    if session.archived == true {
                        Button("Restore") {
                            guard let client else { return }
                            Task { await sessions.restore(session, client: client) }
                        }
                        .accessibilityLabel("Restore \(session.title)")
                    } else {
                        NavigationLink("Open", value: Screen.session(session.id))
                            .accessibilityLabel("Open \(session.title)")
                    }
                }
                .buttonStyle(.bordered)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("session-data-row")
            }
        }
        .overlay {
            if sessions.loaded && rows.isEmpty {
                ContentUnavailableView(state == "all" ? "No sessions yet" : "No matching sessions", systemImage: "tablecells",
                                       description: Text(state == "all" ? "Create a PI session to start working." : "Try another search, state or status filter."))
            }
        }
        .navigationTitle("Sessions")
    }
}
