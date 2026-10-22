// The web's session menu for one session, shared by a row's touch-and-hold menu and the chat's toolbar: Pin or Unpin,
// Mark as read or unread, Archive, Move to group, Copy (Session link, Session ID and, for the open conversation,
// Conversation as Markdown) and Delete…. `SessionNotices` puts its notices, the archive toast and the Delete…
// confirmation on every screen of the stack.
import SwiftUI
import UIKit

struct SessionMenu: View {
    let session: API.SessionView
    let sessions: SessionsModel
    let client: GatewayClient
    var markdown: (() async throws -> String)?

    var body: some View {
        Button(session.pinned == true ? "Unpin session" : "Pin session", systemImage: "pin") {
            Task { await sessions.update(session.id, ["pinned": .bool(session.pinned != true)], client: client) }
        }
        Button(session.unread == true ? "Mark as read" : "Mark as unread", systemImage: "circle") {
            Task { await sessions.setUnread(session, client: client) }
        }
        Button("Archive session", systemImage: "archivebox") {
            Task { await sessions.archive(session, client: client) }
        }
        Menu("Move to group", systemImage: "folder") {
            ForEach(sessions.moveGroups, id: \.value) { group in
                Button(group.label) {
                    Task { await sessions.move(session, to: group.value, client: client) }
                }
                .disabled(group.value == session.group)
            }
        }
        Menu("Copy", systemImage: "doc.on.doc") {
            Button("Session link", systemImage: "link") { copy("link") }
            Button("Session ID", systemImage: "number") { copy("id") }
            Button("Conversation as Markdown", systemImage: "doc.text") { copy("markdown") }
                .disabled(markdown == nil)
        }
        Button("Delete…", systemImage: "trash", role: .destructive) {
            sessions.removing = session
        }
    }

    private func copy(_ action: String) {
        Task { await sessions.copy(session.id, action, client: client, markdown: markdown ?? { "" }) { UIPasteboard.general.string = $0 } }
    }
}

struct SessionNotices: ViewModifier {
    let sessions: SessionsModel
    let client: GatewayClient?

    func body(content: Content) -> some View {
        @Bindable var sessions = sessions
        content
            .safeAreaInset(edge: .bottom) { toasts }
            .alert(sessions.removing.map { "Remove \($0.title) from HUI?" } ?? "", isPresented: Binding(get: { sessions.removing != nil }, set: { if !$0 { sessions.removing = nil } }), presenting: sessions.removing) { session in
                Button("Remove from HUI", role: .destructive) {
                    guard let client else { return }
                    Task { await sessions.remove(session, client: client) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("HUI will remove this session and all its subagents, including nested subagents, and stop their runtimes. Their PI transcripts remain on disk and are not deleted.")
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
}
