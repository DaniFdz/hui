// The open conversation's Work pane on the iPhone, opened from the chat's "Show Work pane" button: the open views as the
// segments of one control, each captioned as the web captions its tab (a Files view shows the file it selected), and the
// "Open Work view" menu that adds one. Files is the only kind the phone has so far, so the menu offers it alone. The
// pane carries the web's "Work pane" name, and every word it shows comes from the core, as the web's do.
import SwiftUI

struct WorkPaneView: View {
    let sessionId: String
    let client: GatewayClient
    let core: HUICore

    @State private var copy: FilesCopy?
    @State private var views: [FilesModel] = []
    @State private var active: UUID?
    @State private var paneLabel = ""
    @State private var openViewLabel = ""
    @State private var choosing = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if choosing, let copy {
                VStack(spacing: 8) {
                    Button(copy.view) {
                        choosing = false
                        open()
                    }
                    .buttonStyle(.borderedProminent)
                    Button(copy.cancel) { choosing = false }
                        .buttonStyle(.bordered)
                }
                .frame(maxHeight: .infinity)
            } else if let model = views.first(where: { $0.id == active }) {
                FilesView(model: model, core: core)
            } else {
                Text("Open a view beside this conversation.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .typeface(.body, prose: true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(paneLabel)
        .task {
            if copy == nil { copy = try? await core.filesCopy() }
            if paneLabel.isEmpty {
                paneLabel = (try? await core.workPaneLabel()) ?? ""
                openViewLabel = (try? await core.workPaneOpenView()) ?? ""
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if !views.isEmpty {
                Picker("Work views", selection: $active) {
                    ForEach(views) { model in
                        Text(model.title).tag(Optional(model.id))
                    }
                }
                .pickerStyle(.segmented)
            } else {
                Spacer()
            }
            if !openViewLabel.isEmpty {
                Button {
                    choosing.toggle()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(openViewLabel)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private func open() {
        guard let copy else { return }
        let model = FilesModel(sessionId: sessionId, client: client, core: core, copy: copy)
        views.append(model)
        active = model.id
    }
}