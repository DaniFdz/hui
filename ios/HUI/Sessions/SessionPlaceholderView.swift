// Where a session opens until the chat screen exists: its title and its status, labelled as the web's chat header
// labels it ("Session status: Idle"). Any listed session opens, including ones the sidebar hides.
import SwiftUI

struct SessionPlaceholderView: View {
    let id: String
    let sessions: SessionsModel

    var body: some View {
        let title = sessions.session(id)?.title
        VStack(spacing: 12) {
            Text(title ?? "Loading session…").font(.title2)
            if let status = sessions.statusLabels[id] {
                Text(status)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Session status: \(status)")
            }
        }
        .padding()
        .navigationTitle(title ?? "")
        .navigationBarTitleDisplayMode(.inline)
    }
}
