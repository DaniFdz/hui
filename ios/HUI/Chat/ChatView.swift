// The chat screen for one session, named as the web's chat names its controls: the toolbar's "Actions for <title>"
// session menu (`SessionMenu`, with Conversation as Markdown), the header (the title as a heading, or the Session name
// field while Rename… is on: leaving it or Return saves a trimmed, non-empty title, as the web's commits on blur or Enter;
// the web's "<runtime> · <GROUP> · <status>" line from the session list's copy, its group and status labels from the core
// and its status read as "Session status: …", and Continue without a prompt for an SDK-worker session), the transcript of
// the core's rows anchored at the bottom, activity rows
// that open to their thinking and tool cards (`ToolCardView`), the working indicator ("Agent activity: …"), the message
// queue and the composer (Message, the "Model: …" menu and Send message; while a run streams, Stop with an empty draft, otherwise "Steer
// message; touch and hold to enqueue", whose hold menu offers Enqueue). A tap or a scroll in the transcript puts the keyboard away.
// While the conversation loads it says so, and a failed load offers Try again. A send reads "Sending…" until the
// gateway takes it, and one that fails stays marked "Not sent — draft recovered." with its text back in the draft, as
// on the web. A run that ended on an error shows the core's error card above the composer (Details, Copy error,
// Continue, Dismiss error). The user's own prompts show as plain text and a bot's or session's message as Markdown without HUI's header, as on the web. As on a touch screen's web, a settled message
// row shows no actions of its own: touching and holding a message offers Reply to message (the core's quote after the
// draft) and the core's Copy label (Copy response, Copy prompt or Copy message), plus Copy as markdown, or Copy code
// on a code block (the web's context menu), and only the latest reply keeps its Copy visible, reading Copied for 1.5 s. The open question's card
// (`QuestionCardView`) sits above the composer, and an answered `ask_user_question` call reads as the core's summary
// ("Your answers", or "Unanswered questions" once it expired). An empty conversation reads "Start a conversation". Typing
// a command word opens the core's "Commands and paths" menu (`SlashMenuView`), and the core decides what a send does:
// /clear and /reload run here, a refusal keeps the draft, and either leaves its note above the composer with Dismiss
// notification, as the web's toast.
import SwiftUI

struct ChatView: View {
    let core: HUICore
    let client: GatewayClient
    let sessions: SessionsModel
    @State private var model: ConversationModel
    @State private var draft = ""
    @State private var expanded: Set<String> = []
    @State private var groupLabel = ""
    @State private var position = ScrollPosition(idType: String.self, edge: .bottom)
    @State private var following = true
    @State private var nearBottom = true
    @State private var placeholder = "Send a message…"
    @State private var errorDetailsShown = false
    @State private var copiedKey = ""
    @State private var copiedReset: Task<Void, Never>?
    @FocusState private var composing: Bool
    @FocusState private var naming: Bool
    @State private var name = ""
    @State private var slashOptions: [SlashOption] = []

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
                    Text("Could not load this conversation").typeface(.headline)
                    Text(message).foregroundStyle(.secondary)
                    Button("Try again") { model.start() }.buttonStyle(.bordered)
                }
                .padding()
                Spacer()
            case .open where model.rows.isEmpty && !model.streaming:
                Spacer()
                VStack(spacing: 4) {
                    Text("Start a conversation").font(.headline)
                    Text("Send a message below.").foregroundStyle(.secondary)
                }
                Spacer()
            case .open:
                transcript
            }
            Divider()
            composer.layoutPriority(1)
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
        .task(id: group) {
            let label = await sessions.groupLabel(group)
            if !Task.isCancelled { groupLabel = label }
        }
        .onDisappear { model.stop() }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                if sessions.renaming == model.id {
                    TextField("Session name", text: $name)
                        .typeface(.headline)
                        .accessibilityLabel("Session name")
                        .focused($naming)
                        .submitLabel(.done)
                        .onSubmit(rename)
                        .onChange(of: naming) { if !naming { rename() } }
                        .onDisappear(perform: rename)
                        .task {
                            name = title
                            naming = true
                        }
                } else {
                    Text(title)
                        .typeface(.headline)
                        .accessibilityIdentifier("session-title")
                        .accessibilityAddTraits(.isHeader)
                }
                if !model.statusLabel.isEmpty, !groupLabel.isEmpty {
                    HStack(spacing: 0) {
                        Text(meta)
                        Text(model.statusLabel).accessibilityLabel("Session status: \(model.statusLabel)")
                    }
                    .typeface(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(meta + model.statusLabel)
                }
                if !model.connectionNote.isEmpty {
                    Text(model.connectionNote).typeface(.caption).foregroundStyle(.orange)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if model.session?.tool == "pi" {
                Button(model.continuing ? "Continuing…" : "Continue", systemImage: "forward.end") { Task { await model.resume() } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .accessibilityLabel("Continue without a prompt")
                    .disabled(model.phase != .open || model.streaming || model.continuing || model.rows.isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var meta: String {
        guard let session = sessions.session(model.id) ?? model.session else { return "" }
        return "\(session.parentId == nil ? session.tool : "Subagent")\(session.worker.map { " on \($0.name)" } ?? "") · \(groupLabel) · "
    }

    private var group: String {
        sessions.session(model.id)?.group ?? model.session?.group ?? ""
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
        .scrollDismissesKeyboard(.immediately)
        .accessibilityIdentifier("transcript")
    }

    @ViewBuilder private func rowView(_ row: ChatRow) -> some View {
        switch row.kind {
        case .messages:
            let lastKey = row.messages?.last?.key
            ForEach(row.messages ?? [], id: \.key) { message in
                let user = message.role == "user"
                let text = message.shown ?? message.text ?? ""
                VStack(alignment: .trailing, spacing: 4) {
                    Group {
                        if message.markdown == true {
                            MarkdownView(source: text, agent: true, core: core, copyMarkdown: message.pending == true ? nil : text)
                        } else if user {
                            Text(text).typeface(.body, prose: true).textSelection(.enabled)
                        } else {
                            Text(text)
                        }
                    }
                        .padding(user ? 10 : 0)
                        .background(user ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(.clear), in: RoundedRectangle(cornerRadius: 12))
                        .opacity(message.pending == true ? 0.6 : 1)
                        .contextMenu {
                            if message.key == lastKey, let footer = row.footer {
                                Button("Reply to message") { reply(quoting: footer.text) }
                                Button(copiedKey == row.key ? "Copied" : footer.copyLabel) { copy(footer.text, key: row.key) }
                            }
                            if message.pending != true, !text.isEmpty {
                                Button("Copy as markdown") { UIPasteboard.general.string = text }
                            }
                        }
                    if message.pending == true {
                        Text("Sending…").typeface(.caption).foregroundStyle(.secondary)
                    }
                    if message.failed == true {
                        Text("Not sent — draft recovered.").typeface(.caption).foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, alignment: user ? .trailing : .leading)
            }
            if row.key == latestReply, let footer = row.footer {
                Button(copiedKey == row.key ? "Copied" : footer.copyLabel, systemImage: copiedKey == row.key ? "checkmark" : "doc.on.doc") {
                    copy(footer.text, key: row.key)
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .activity where row.answers != nil:
            questionnaireSummary(row.answers!)
        case .activity:
            disclosure(row.key, label: (model.streaming ? row.liveLabel : row.label) ?? "") {
                ForEach(row.activity ?? [], id: \.key) { item in
                    activityItem(item)
                }
            }
        case .compaction:
            Text("Conversation compacted").typeface(.caption).foregroundStyle(.secondary)
        case .call, .subagentEvent, .botCreated, .unrecognized:
            EmptyView()
        }
    }

    private var latestReply: String? {
        model.rows.last { $0.kind == .messages && $0.messages?.last?.role == "assistant" }?.key
    }

    private func copy(_ text: String, key: String) {
        UIPasteboard.general.string = text
        copiedKey = key
        copiedReset?.cancel()
        copiedReset = Task {
            try? await Task.sleep(for: .seconds(1.5))
            if !Task.isCancelled { copiedKey = "" }
        }
    }

    private func reply(quoting text: String) {
        Task {
            guard let quoted = try? await core.replyDraft(draft, quoting: text) else { return }
            draft = quoted
            composing = true
        }
    }

    private func questionnaireSummary(_ summary: QuestionnaireSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if summary.timedOut == true {
                summaryLine("Expired", "No answer within \(summary.timeoutMinutes.map { String(Int($0)) } ?? "") minutes. The agent continued without your answer; reply in the chat to decide.")
                ForEach(Array(summary.asked.enumerated()), id: \.offset) { _, asked in
                    summaryLine(asked.header ?? "", "\(asked.question ?? "") \(asked.options.compactMap(\.label).joined(separator: ", "))")
                }
            } else if summary.cancelled || summary.answers.isEmpty {
                Text("You declined to answer.")
            } else {
                ForEach(Array(summary.answers.enumerated()), id: \.offset) { _, answer in
                    summaryLine(answer.header, answer.selected.joined(separator: ", "))
                }
            }
        }
        .typeface(.callout)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(summary.timedOut == true ? "Unanswered questions" : "Your answers")
    }

    private func summaryLine(_ title: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).bold()
            Text(text)
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
                .typeface(.subheadline)
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            if open { content() }
        }
        .id(id)
    }

    private func expandedBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { expanded.contains(id) }, set: { open in
            if open {
                following = false
                expanded.insert(id)
                if nearBottom { withAnimation { position.scrollTo(id: id) } }
            } else {
                expanded.remove(id)
            }
        })
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.queue.isEmpty {
                QueueView(model: model)
            }
            if model.reconnecting || model.stopped {
                Text(model.reconnecting ? "Reconnecting — draft preserved." : "Stream stopped — draft preserved.")
                    .typeface(.caption)
                    .foregroundStyle(.orange)
            }
            if let error = model.sendError {
                Text(error).typeface(.caption).foregroundStyle(.red)
            }
            if let runError = model.shownRunError {
                runErrorCard(runError)
            }
            if let note = model.note {
                noteToast(note)
            }
            if !slashOptions.isEmpty {
                SlashMenuView(options: slashOptions) { option in draft = option.completion }
            }
            if let question = model.question {
                QuestionCardView(question: question, core: core) { reply in Task { await model.answer(reply) } }
                    .onAppear { composing = false }
            }
            composerControls
            modelPicker
        }
        .padding()
    }

    private func noteToast(_ note: ConversationModel.Note) -> some View {
        HStack(alignment: .top) {
            if note.error {
                Image(systemName: "exclamationmark.triangle").accessibilityHidden(true)
            }
            Text(note.text).frame(maxWidth: .infinity, alignment: .leading)
            Button("Dismiss notification", systemImage: "xmark") { model.note = nil }
                .labelStyle(.iconOnly)
        }
        .font(.callout)
        .foregroundStyle(note.error ? .red : .primary)
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private func runErrorCard(_ error: RunErrorNotice) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(error.summary).bold()
            } icon: {
                Image(systemName: "exclamationmark.triangle").accessibilityHidden(true)
            }
            if error.multiline {
                Button("Details") { errorDetailsShown.toggle() }.typeface(.caption)
                if errorDetailsShown {
                    ScrollView {
                        Text(error.detail)
                            .typeface(.caption, mono: true)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 160)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Error details")
                }
            }
            HStack {
                Button("Copy error") { UIPasteboard.general.string = error.detail }
                Button("Continue") { Task { await model.continueAfterError() } }
                    .disabled(model.phase != .open || model.reconnecting || model.stopped)
                Spacer()
                Button("Dismiss error", systemImage: "xmark") { model.dismissRunError() }
                    .labelStyle(.iconOnly)
            }
            .typeface(.callout)
        }
        .foregroundStyle(.red)
        .padding(10)
        .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    private var composerControls: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("", text: $draft, prompt: Text(placeholder), axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Message")
                .accessibilityValue(draft)
                .focused($composing)
                .task(id: [AnyHashable(draft), AnyHashable(model.commands)]) {
                    slashOptions = (try? await core.slashMenu(model.commands, text: draft)) ?? []
                }
                .task(id: "\(model.session?.status.rawValue ?? "") \(model.reconnecting || model.stopped) \(model.streaming)") {
                    if let text = try? await core.composerPlaceholder(status: model.session?.status, reconnecting: model.reconnecting || model.stopped, streaming: model.streaming) {
                        placeholder = text
                    }
                }
            if model.streaming, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Stop", systemImage: "stop.fill") { Task { await model.abort() } }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Stop")
            } else {
                Button("Send message", systemImage: "arrow.up.circle.fill") { submit(model.streaming ? .steer : .prompt) }
                    .labelStyle(.iconOnly)
                    .typeface(.title2)
                    .accessibilityLabel(model.streaming ? "Steer message; touch and hold to enqueue" : "Send message")
                    .contextMenu {
                        if model.streaming {
                            Button("Enqueue") { submit(.followUp) }
                        }
                    }
                    .disabled(model.phase != .open || model.reconnecting || model.stopped)
            }
        }
    }

    @ViewBuilder private var modelPicker: some View {
        let name = model.currentModel?.name
        if model.models.isEmpty {
            Text(name ?? "PI default")
                .typeface(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Model: \(name ?? "PI default"). No model catalog available")
        } else {
            Menu {
                ForEach(model.models, id: \.self) { choice in
                    Button {
                        Task { await model.selectModel(choice) }
                    } label: {
                        if choice.provider == model.currentModel?.provider, choice.id == model.currentModel?.id {
                            Label("\(choice.name) · \(choice.provider)", systemImage: "checkmark")
                        } else {
                            Text("\(choice.name) · \(choice.provider)")
                        }
                    }
                }
            } label: {
                Label(name ?? "Select model", systemImage: "chevron.down").typeface(.caption)
            }
            .accessibilityLabel("Model: \(name ?? "Select model")")
            .disabled(model.streaming)
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
