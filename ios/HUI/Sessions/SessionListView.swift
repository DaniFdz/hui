// The session list, grouped as the web sidebar groups it; each row reads as the web's sidebar row does and leads with
// the core's status glyph (attention, the busy spinner or the unread dot). Its toolbar holds the web sidebar's
// Filter & sort menu, with the same choices, and New group.
import SwiftUI

struct SessionListView: View {
    let sessions: SessionsModel
    let client: GatewayClient?
    let notice: String?
    @State private var naming = false
    @State private var groupName = ""

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
                        HStack {
                            SessionGlyphView(glyph: row.glyph)
                            NavigationLink(value: row.id) {
                                Text(row.title)
                            }
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(row.accessibleName)
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("session-row")
                    }
                }
            }
        }
        .overlay {
            if sessions.loaded && sessions.groups.isEmpty {
                if sessions.filtering {
                    ContentUnavailableView("No matching sessions.", systemImage: "line.3.horizontal.decrease.circle")
                } else {
                    ContentUnavailableView("No sessions", systemImage: "bubble.left.and.bubble.right")
                }
            } else if !sessions.loaded {
                ProgressView()
            }
        }
        .navigationTitle("Sessions")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let options = sessions.options {
                    Menu {
                        choices("Group by", \.groupBy, options, [("custom", "Custom groups"), ("project", "Project"), ("none", "None")]).pickerStyle(.palette).menuActionDismissBehavior(.enabled)
                        choices("Sort by", \.sortBy, options, [("created", "Created"), ("updated", "Last updated"), ("title", "Name"), ("stage", "Stage")]).pickerStyle(.palette).menuActionDismissBehavior(.enabled)
                        choices("Hide empty groups", \.hideEmpty, options, [("filtering", "When filtering"), ("always", "Always"), ("never", "Never")]).pickerStyle(.palette).menuActionDismissBehavior(.enabled)
                        choices("Status", \.status, options, [("all", "All"), ("running", "Running"), ("starting", "Starting"), ("waiting", "Waiting"), ("idle", "Idle"), ("error", "Error"), ("reconnecting", "Reconnecting"), ("disconnected", "Disconnected")]).pickerStyle(.inline)
                    } label: {
                        Label("Filter & sort", systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
                Button("New group", systemImage: "folder.badge.plus") {
                    groupName = ""
                    naming = true
                }
            }
        }
        .alert("New group", isPresented: $naming) {
            TextField("Group name", text: $groupName).accessibilityLabel("Group name")
            Button("Create group") {
                guard let client else { return }
                let name = groupName
                Task { await sessions.createGroup(name, client: client) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func choices(_ title: String, _ key: WritableKeyPath<SidebarOptions, String>, _ options: SidebarOptions, _ values: [(String, String)]) -> some View {
        Section(title) {
            Picker(title, selection: Binding(get: { options[keyPath: key] }, set: { value in
                var next = options
                next[keyPath: key] = value
                sessions.setOptions(next)
            })) {
                ForEach(values, id: \.0) { value, label in
                    Text(label).tag(value)
                }
            }
        }
    }
}

private struct SessionGlyphView: View {
    let glyph: SessionGlyph

    var body: some View {
        Group {
            if let attention = glyph.attention {
                Image(systemName: attention.tone == "question" ? "hand.raised" : attention.tone == "error" ? "exclamationmark.triangle" : "powerplug")
                    .foregroundStyle(attention.tone == "error" ? .red : .orange)
            } else if glyph.busy {
                ProgressView()
            } else if glyph.unread {
                Circle().fill(.tint).frame(width: 8, height: 8)
            }
        }
        .frame(width: 20)
        .accessibilityLabel(glyph.label)
        .accessibilityIdentifier("session-glyph")
    }
}
