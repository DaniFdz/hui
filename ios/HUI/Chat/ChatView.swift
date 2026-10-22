// The chat screen for one session, named as the web's chat names its controls: the toolbar's "Actions for <title>"
// session menu (`SessionMenu`, with Conversation as Markdown), the header (the title as a heading, or the Session name
// field while Rename… is on: leaving it or Return saves a trimmed, non-empty title, as the web's commits on blur or Enter;
// "Session status: …" from the core's label), the transcript of the core's rows anchored at the bottom, activity rows
// that open to their thinking and tool cards (`ToolCardView`), the working indicator ("Agent activity: …"), the message
// queue and the composer (Message and Send message; while a run streams, Stop with an empty draft, otherwise "Steer
// message; touch and hold to enqueue", whose hold menu offers Enqueue). A tap in the transcript puts the keyboard away.
// While the conversation loads it says so, and a failed load offers Try again. A send reads "Sending…" until the
// gateway takes it, and one that fails stays marked "Not sent — draft recovered." with its text back in the draft, as
// on the web.
import SwiftUI

struct ChatView: View {
    let core: HUICore
    let client: GatewayClient
    let sessions: SessionsModel
    @State private var model: ConversationModel
    @State private var draft = ""
    @State private var expanded: Set<String> = []
    @State private var position = ScrollPosition(idType: String.self, edge: .bottom)
    @State private var following = true
    @State private var nearBottom = true
    @FocusState private var composing: Bool
    @FocusState private var naming: Bool
    @State private var name = ""

    init(id: String, client: GatewayClient, core: HUICore, sessions: SessionsModel) {
        self.core = core
        self.client = client
        self.sessions = sessions
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
        .toolbar {
            if let session = sessions.session(model.id) ?? model.session {
                Menu {
                    SessionMenu(session: session, sessions: sessions, client: client, markdown: model.markdown)
                } label: {
                    Label("Actions for \(session.title)", systemImage: "ellipsis.circle")
                }
            }
        }
        .task { model.start() }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            if sessions.renaming == model.id {
                TextField("Session name", text: $name)
                    .font(.headline)
                    .accessibilityLabel("Session name")
                    .focused($naming)
                    .submitLabel(.done)
                    .onSubmit(rename)
                    .onChange(of: naming) { if !naming { rename() } }
                    .task {
                        name = title
                        naming = true
                    }
            } else {
                Text(title)
                    .font(.headline)
                    .accessibilityIdentifier("session-title")
                    .accessibilityAddTraits(.isHeader)
            }
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

    private var title: String {
        sessions.session(model.id)?.title ?? model.session?.title ?? ""
    }

    private func rename() {
        guard sessions.renaming == model.id else { return }
        sessions.renaming = ""
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != title else { return }
        Task { await sessions.update(model.id, ["title": .string(trimmed)], client: client) }
    }

    private var transcript: some View {
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
            }
            .padding()
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .alignment)
        .defaultScrollAnchor(following ? .bottom : .top, for: .sizeChanges)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY < 48
        } action: { _, near in
            nearBottom = near
        }
        .onScrollPhaseChange { old, phase in
            guard phase == .idle, [.interacting, .decelerating].contains(old) else { return }
            following = nearBottom
            if following { withAnimation { position.scrollTo(edge: .bottom) } }
        }
        .onChange(of: expanded) { old, new in
            guard let opened = new.subtracting(old).first else { return }
            following = false
            withAnimation { position.scrollTo(id: opened, anchor: .top) }
        }
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(TapGesture().onEnded { composing = false })
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
                    if message.pending == true {
                        Text("Sending…").font(.caption).foregroundStyle(.secondary)
                    }
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
            if !model.queue.isEmpty {
                QueueView(model: model)
            }
            if let error = model.sendError {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            composerControls
        }
        .padding()
    }

    private var composerControls: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Message")
                .focused($composing)
                .overlay(alignment: .leading) {
                    if draft.isEmpty {
                        Text(model.streaming ? "Add to this run…" : "Send a message…")
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 7)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
            if model.streaming, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Stop", systemImage: "stop.fill") { Task { await model.abort() } }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Stop")
            } else {
                Button("Send message", systemImage: "arrow.up.circle.fill") { submit(model.streaming ? .steer : .prompt) }
                    .labelStyle(.iconOnly)
                    .font(.title2)
                    .accessibilityLabel(model.streaming ? "Steer message; touch and hold to enqueue" : "Send message")
                    .contextMenu {
                        if model.streaming {
                            Button("Enqueue") { submit(.followUp) }
                        }
                    }
                    .disabled(model.phase != .open)
            }
        }
    }

    private func submit(_ mode: ConversationModel.SendMode) {
        let text = draft
        draft = ""
        following = true
        position.scrollTo(edge: .bottom)
        Task {
            guard await !model.send(text, mode: mode) else { return }
            draft = draft.isEmpty ? text : "\(text)\n\n\(draft)"
        }
    }
}
