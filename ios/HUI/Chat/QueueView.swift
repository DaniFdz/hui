// The message queue above the composer, named as the web's queue names it ("Queued messages"): the core's rows, a
// Steer or Follow up badge on each, and on HUI's own follow-ups Steer queued message while a run streams, Remove
// queued message and Edit queued message (or a double tap), which opens a focused editor with Save queued message and
// Cancel edit. With two or more follow-ups, dragging a row's Reorder queued message handle onto another row moves it
// there. Every change goes to the gateway, and the queue it sends back redraws the rows.
import SwiftUI

struct QueueView: View {
    let model: ConversationModel
    @State private var editing: String?
    @State private var text = ""
    @State private var frames: [String: CGRect] = [:]
    @FocusState private var editorFocused: Bool

    private var editable: [String] { model.queue.filter(\.editable).map(\.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(model.queue.enumerated()), id: \.offset) { _, row in
                rowView(row)
            }
        }
        .coordinateSpace(.named("queue"))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Queued messages")
        .onChange(of: model.queue) {
            if let editing, !editable.contains(editing) { self.editing = nil }
        }
    }

    private func rowView(_ row: QueueRow) -> some View {
        HStack(spacing: 8) {
            if row.editable, editable.count > 1, editing == nil {
                grip(row.id)
            }
            if editing == row.id {
                TextField("Edit queued message", text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .focused($editorFocused)
                    .onAppear { editorFocused = true }
                    .accessibilityLabel("Edit queued message")
                Button("Save queued message", systemImage: "checkmark") { save(row.id) }.labelStyle(.iconOnly)
                Button("Cancel edit", systemImage: "xmark") { editing = nil }.labelStyle(.iconOnly)
            } else {
                Text(row.text).lineLimit(2)
                Text(row.label)
                    .font(.caption)
                    .padding(.horizontal, 6)
                    .background(.quaternary, in: Capsule())
                Spacer()
                if row.editable {
                    if model.streaming {
                        Button("Steer") { change(.steer(.init(itemId: row.id))) }
                            .accessibilityLabel("Steer queued message")
                    }
                    Button("Remove queued message", systemImage: "trash") { change(.remove(.init(itemId: row.id))) }.labelStyle(.iconOnly)
                    Button("Edit queued message", systemImage: "ellipsis") { edit(row) }.labelStyle(.iconOnly)
                }
            }
        }
        .font(.subheadline)
        .buttonStyle(.borderless)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) {
            if row.editable, editing == nil { edit(row) }
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("queue")) } action: { frame in
            if row.editable { frames[row.id] = frame }
        }
    }

    private func grip(_ id: String) -> some View {
        Image(systemName: "line.3.horizontal")
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
            .accessibilityElement()
            .accessibilityLabel("Reorder queued message")
            .accessibilityAddTraits(.isButton)
            .gesture(DragGesture(coordinateSpace: .named("queue")).onEnded { drag in
                guard let target = editable.firstIndex(where: { frames[$0].map { $0.minY...$0.maxY ~= drag.location.y } ?? false }),
                      editable[target] != id else { return }
                change(.move(.init(itemId: id, toIndex: Double(target))))
            })
    }

    private func edit(_ row: QueueRow) {
        text = row.text
        editing = row.id
    }

    private func save(_ id: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            if await model.changeQueue(.edit(.init(itemId: id, text: text))), editing == id { editing = nil }
        }
    }

    private func change(_ request: API.SessionQueueRequest) {
        Task { _ = await model.changeQueue(request) }
    }
}
