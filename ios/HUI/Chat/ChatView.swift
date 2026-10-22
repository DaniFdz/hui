// The chat screen for one session, named as the web's chat names its controls: the header (the title as a heading,
// "Session status: …" from the core's label), the transcript of the core's rows anchored at the bottom, activity rows
// that open to their thinking and tool cards, the working indicator ("Agent activity: …") and the composer (Message,
// Send message, and Stop while a run streams). While the conversation loads it says so, and a failed load offers Try
// again. A send that fails stays marked "Not sent — draft recovered." with its text back in the draft, as on the web.
import SwiftUI

struct ChatView: View {
    let core: HUICore
    let title: String?
    @State private var model: ConversationModel
    @State private var draft = ""
    @State private var expanded: Set<String> = []
    @State private var follow = TranscriptFollow()
    @State private var sends = 0

    init(id: String, client: GatewayClient, core: HUICore, title: String?) {
        self.core = core
        self.title = title
        _model = State(initialValue: ConversationModel(id: id, client: client, core: core))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            switch model.phase {
            case .loading:
                Spacer()
                ProgressView("Loading the conversation…")
                Spacer()
            case .failed(let message):
                Spacer()
                VStack(spacing: 8) {
                    Text("Could not load this conversation").font(.headline)
                    Text(message).foregroundStyle(.secondary)
                    Button("Try again") { model.start() }.buttonStyle(.bordered)
                }
                .padding()
                Spacer()
            case .open:
                transcript
            }
            Divider()
            composer
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { model.start() }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.session?.title ?? title ?? "")
                .font(.headline)
                .accessibilityIdentifier("session-title")
                .accessibilityAddTraits(.isHeader)
            if !model.statusLabel.isEmpty {
                Text(model.statusLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Session status: \(model.statusLabel)")
            }
            if !model.connectionNote.isEmpty {
                Text(model.connectionNote).font(.caption).foregroundStyle(.orange)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            transcriptScroll
                .onChange(of: expanded) { old, new in
                    guard let opened = new.subtracting(old).first else { return }
                    follow.stop()
                    withAnimation { proxy.scrollTo(opened, anchor: .top) }
                }
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    geometry.contentSize.height - geometry.containerSize.height
                } action: { _, overflow in
                    if follow.overflowChanged(overflow) { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onScrollGeometryChange(for: Bool.self) { geometry in
                    geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY < 48
                } action: { _, nearBottom in
                    if follow.nearBottomChanged(nearBottom) { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onChange(of: sends) {
                    if follow.follow() { proxy.scrollTo("end", anchor: .bottom) }
                }
        }
    }

    private var transcriptScroll: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(model.rows, id: \.key) { row in
                    rowView(row)
                }
                if model.streaming {
                    HStack(spacing: 6) {
                        ProgressView()
                        Text(model.working).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Agent activity: \(model.working)")
                }
                Color.clear.frame(height: 1).id("end")
            }
            .padding()
        }
        .defaultScrollAnchor(.bottom)
        .onScrollPhaseChange { _, phase in
            follow.scrollingChanged([.tracking, .interacting, .decelerating].contains(phase))
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("transcript")
    }

    @ViewBuilder private func rowView(_ row: ChatRow) -> some View {
        switch row.kind {
        case .messages:
            ForEach(row.messages ?? [], id: \.key) { message in
                let user = message.role == "user"
                VStack(alignment: .trailing, spacing: 4) {
                    MarkdownView(source: message.text ?? "", agent: !user, core: core)
                        .padding(user ? 10 : 0)
                        .background(user ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(.clear), in: RoundedRectangle(cornerRadius: 12))
                        .opacity(message.pending == true ? 0.6 : 1)
                    if message.failed == true {
                        Text("Not sent — draft recovered.").font(.caption).foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, alignment: user ? .trailing : .leading)
            }
        case .activity:
            disclosure(row.key, label: (model.streaming ? row.liveLabel : row.label) ?? "") {
                ForEach(row.activity ?? [], id: \.key) { item in
                    activityItem(item)
                }
            }
        case .compaction:
            Text("Conversation compacted").font(.caption).foregroundStyle(.secondary)
        case .call, .subagentEvent, .botCreated, .unrecognized:
            EmptyView()
        }
    }

    @ViewBuilder private func activityItem(_ item: TranscriptItem) -> some View {
        switch item.kind {
        case .thinking:
            MarkdownView(source: item.text ?? "", agent: false, core: core).foregroundStyle(.secondary)
        case .error:
            Text(item.text ?? "").foregroundStyle(.red)
        case .tool:
            ToolCardView(item: item, expanded: expandedBinding(item.key)).id(item.key)
        default:
            EmptyView()
        }
    }

    private func disclosure(_ id: String, label: String, @ViewBuilder content: () -> some View) -> some View {
        let open = expanded.contains(id)
        return VStack(alignment: .leading, spacing: 8) {
            Button { expandedBinding(id).wrappedValue.toggle() } label: {
                HStack(spacing: 4) {
                    Image(systemName: open ? "chevron.down" : "chevron.right").accessibilityHidden(true)
                    Text(label)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            if open { content() }
        }
        .id(id)
    }

    private func expandedBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { expanded.contains(id) }, set: { open in
            if open { expanded.insert(id) } else { expanded.remove(id) }
        })
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let error = model.sendError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            composerControls
        }
        .padding()
    }

    private var composerControls: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Message")
            if model.streaming {
                Button("Stop", systemImage: "stop.fill") { Task { await model.abort() } }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Stop")
            } else {
                Button("Send message", systemImage: "arrow.up.circle.fill") {
                    let text = draft
                    draft = ""
                    sends += 1
                    Task {
                        guard await !model.send(text) else { return }
                        draft = draft.isEmpty ? text : "\(text)\n\n\(draft)"
                    }
                }
                .labelStyle(.iconOnly)
                .font(.title2)
                .accessibilityLabel("Send message")
                .disabled(model.phase != .open)
            }
        }
    }
}

struct ToolCardView: View {
    let item: TranscriptItem
    @Binding var expanded: Bool

    private var running: Bool { (item.status ?? "running") == "running" }
    private var failed: Bool { item.failed == true || item.status == "failed" }
    private var outcome: String { failed ? "failed" : running ? "Running" : "Completed" }

    var body: some View {
        if let read = item.read {
            card(label: "Read \(read.target)", title: Text("Read ").bold() + Text(read.target)) {
                Text(read.detail).font(.caption).foregroundStyle(.secondary)
                output(read.output)
                Text(outcome).font(.caption)
            }
        } else if let command = item.command {
            card(label: command.preview, title: Text("$ ").foregroundStyle(.secondary) + Text(command.preview).font(.system(.footnote, design: .monospaced))) {
                output("$ \(command.command)")
                output(item.output ?? "")
                Text(outcome).font(.caption)
            }
        } else if let codemode = item.codemode {
            card(label: "codemode \(codemode.summary)", title: Text("codemode ").bold() + Text(codemode.summary)) {
                output(codemode.code)
                output(codemode.output)
                Text(codemode.outcome).font(.caption)
            }
        } else {
            card(label: item.name ?? "tool", title: Text(item.name ?? "tool").bold() + Text(" \(failed ? "Failed" : running ? "Running" : "Completed")")) {
                if let args = item.args { output(Self.printable(args)) }
                if let text = item.output { output(text.isEmpty ? "No output" : text) }
            }
        }
    }

    private func card(label: String, title: Text, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { expanded.toggle() } label: {
                HStack {
                    title.lineLimit(1)
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            if expanded {
                VStack(alignment: .leading, spacing: 6) { content() }
                    .padding(8)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    @ViewBuilder private func output(_ text: String) -> some View {
        if !text.isEmpty {
            Text(text).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
        }
    }

    private static func printable(_ value: API.JSONValue) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? encoder.encode(value)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }
}
