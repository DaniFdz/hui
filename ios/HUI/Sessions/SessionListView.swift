// The session list, grouped as the web sidebar groups it; each row reads as the web's sidebar row does.
import SwiftUI

struct SessionListView: View {
    let sessions: SessionsModel
    let notice: String?

    var body: some View {
        List {
            if let notice {
                Text(notice).font(.footnote).foregroundStyle(.secondary)
            }
            if let error = sessions.error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            ForEach(sessions.groups) { group in
                Section(group.label) {
                    ForEach(group.rows) { row in
                        NavigationLink(value: row.id) {
                            HStack {
                                Text(row.title)
                                Spacer()
                                Text(row.statusText).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(row.accessibleName)
                        .accessibilityAddTraits(.isButton)
                    }
                }
            }
        }
        .overlay {
            if sessions.loaded && sessions.groups.isEmpty {
                ContentUnavailableView("No sessions", systemImage: "bubble.left.and.bubble.right")
            } else if !sessions.loaded {
                ProgressView()
            }
        }
        .navigationTitle("Sessions")
    }
}
