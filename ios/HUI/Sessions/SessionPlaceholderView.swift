// Where a session opens until the chat screen exists: its title and its status, labelled as the web's chat header
// labels it ("Session status: Idle").
import SwiftUI

struct SessionPlaceholderView: View {
    let id: String
    let sessions: SessionsModel

    var body: some View {
        let row = sessions.row(id)
        VStack(spacing: 12) {
            Text(row?.title ?? "Loading session…").font(.title2)
            if let status = row?.statusText {
                Text(status)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Session status: \(status)")
            }
        }
        .padding()
        .navigationTitle(row?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
    }
}
