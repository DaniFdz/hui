// The session list, grouped as the web sidebar groups it; each row reads as the web's sidebar row does and leads with
// the core's status glyph (attention, the busy spinner or the unread dot). Its toolbar holds the web sidebar's
// Filter & sort menu, with the same choices, and New group. Touching and holding a row opens the web's session menu:
// pin, mark read or unread, archive, Move to group, Copy and Delete…, whose notices and archive toast show at the
// bottom.
import SwiftUI
import UIKit

struct SessionListView: View {
    let sessions: SessionsModel
    let client: GatewayClient?
    let notice: String?
    @State private var naming = false
    @State private var groupName = ""
    @State private var removing: SessionsModel.Row?

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
                                HStack {
                                    Text(row.title)
                                    if row.pinned {
                                        Text("Pinned").font(.caption).padding(.horizontal, 6).background(.quaternary, in: .capsule)
                                    }
                                }
                            }
                            .accessibilityLabel(row.title)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(row.accessibleName)
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("session-row")
                        .contextMenu { menu(row) }
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
        .safeAreaInset(edge: .bottom) { toasts }
        .alert(removing.map { "Remove \($0.title) from HUI?" } ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { row in
            Button("Remove from HUI", role: .destructive) {
                guard let client else { return }
                Task { await sessions.remove(row, client: client) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("HUI will remove this session and all its subagents, including nested subagents, and stop their runtimes. Their PI transcripts remain on disk and are not deleted.")
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

    @ViewBuilder
    private func menu(_ row: SessionsModel.Row) -> some View {
        if let client {
            Button(row.pinned ? "Unpin session" : "Pin session", systemImage: "pin") {
                Task { await sessions.update(row.id, ["pinned": .bool(!row.pinned)], client: client) }
            }
            Button(row.unread ? "Mark as read" : "Mark as unread", systemImage: "circle") {
                Task { await sessions.setUnread(row, client: client) }
            }
            Button("Archive session", systemImage: "archivebox") {
                Task { await sessions.archive(row, client: client) }
            }
            Menu("Move to group", systemImage: "folder") {
                ForEach(sessions.moveGroups, id: \.value) { group in
                    Button(group.label) {
                        Task { await sessions.move(row, to: group.value, client: client) }
                    }
                    .disabled(group.value == row.group)
                }
            }
            Menu("Copy", systemImage: "doc.on.doc") {
                Button("Session link", systemImage: "link") {
                    Task { await sessions.copy(row, "link", client: client) { UIPasteboard.general.string = $0 } }
                }
                Button("Session ID", systemImage: "number") {
                    Task { await sessions.copy(row, "id", client: client) { UIPasteboard.general.string = $0 } }
                }
            }
            Button("Delete…", systemImage: "trash", role: .destructive) {
                removing = row
            }
        }
    }

    @ViewBuilder
    private var toasts: some View {
        VStack(spacing: 8) {
            if let toast = sessions.archiveToast {
                HStack {
                    Text(toast.error ?? "Archived “\(toast.title)”.").font(.footnote)
                    Spacer()
                    Button(toast.restoring ? "Restoring…" : "Restore") {
                        guard let client else { return }
                        Task { await sessions.restoreArchived(client: client) }
                    }
                    .disabled(toast.restoring)
                    Button("Dismiss archive notification", systemImage: "xmark") {
                        sessions.dismissArchiveToast()
                    }
                    .labelStyle(.iconOnly)
                }
                .padding(12)
                .background(.regularMaterial, in: .rect(cornerRadius: 12))
            }
            if let notice = sessions.notice {
                Text(notice.text)
                    .font(.footnote)
                    .foregroundStyle(notice.failed ? .red : .primary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: .rect(cornerRadius: 12))
            }
        }
        .padding(.horizontal)
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
            } else {
                Color.clear
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityLabel(glyph.label)
        .accessibilityIdentifier("session-glyph")
    }
}
