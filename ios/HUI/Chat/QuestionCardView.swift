// The card above the composer for the open question, as the web's `hui-questionnaire-card` and secret card draw it:
// an `ask_user_question` card (Questions or the header, the progress, header chips that tick once answered, the
// question, its options with their numbers, the "Your own answer" row, the focused option's Markdown preview under them,
// Cancel, Back and Next or Submit) and a secret request card (Secret 1/1, the label, the reason, the masked Value field,
// Cancel and Submit). An option reads as a radio or checkbox and a chip as a tab, the way React Native spells roles
// UIKit has no trait for. `QuestionnaireDrafts` keeps the picks while the operator moves between questions.
import SwiftUI

struct QuestionCardView: View {
    let question: API.SessionQuestion
    let core: HUICore
    let answer: (ConversationModel.QuestionReply) -> Void

    var body: some View {
        Group {
            switch question {
            case .questionnaire(let questionnaire):
                QuestionnaireCard(questions: questionnaire.questions, core: core, answer: answer).id(questionnaire.id)
            case .secret(let secret):
                SecretCard(secret: secret, answer: answer).id(secret.id)
            default:
                EmptyView()
            }
        }
        .padding(10)
        .background(.tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.tint.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("question-card")
    }
}

struct QuestionnaireDrafts: Equatable {
    struct Draft: Equatable {
        var selected: [String] = []
        var custom = ""
        var customChosen = false

        var answered: Bool { !selected.isEmpty || (customChosen && !trimmedCustom.isEmpty) }
        fileprivate var trimmedCustom: String { custom.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    let questions: [API.QuestionnaireQuestion]
    private(set) var drafts: [Draft]

    init(_ questions: [API.QuestionnaireQuestion]) {
        self.questions = questions
        drafts = questions.map { _ in Draft() }
    }

    var anyAnswered: Bool { drafts.contains(where: \.answered) }

    mutating func pick(_ label: String, at step: Int) {
        if questions[step].multiSelect {
            if let index = drafts[step].selected.firstIndex(of: label) { drafts[step].selected.remove(at: index) } else { drafts[step].selected.append(label) }
        } else {
            drafts[step].selected = [label]
            drafts[step].customChosen = false
        }
    }

    mutating func type(_ text: String, at step: Int) {
        let chosen = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        drafts[step].custom = text
        drafts[step].customChosen = chosen
        if chosen, !questions[step].multiSelect { drafts[step].selected = [] }
    }

    var reply: [ConversationModel.QuestionReply.Answer] {
        drafts.map { draft in
            let custom = draft.customChosen ? draft.trimmedCustom : ""
            return .init(selected: draft.selected, custom: custom.isEmpty ? nil : custom)
        }
    }
}

private struct CardHeader: View {
    let title: String
    let progress: String

    var body: some View {
        HStack {
            Text(title).typeface(.subheadline, weight: .bold)
            Spacer()
            Text(progress).typeface(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct QuestionnaireCard: View {
    let core: HUICore
    let answer: (ConversationModel.QuestionReply) -> Void
    @State private var drafts: QuestionnaireDrafts
    @State private var step = 0
    @State private var previewed: [Int]
    @State private var contentHeight: CGFloat = 0

    init(questions: [API.QuestionnaireQuestion], core: HUICore, answer: @escaping (ConversationModel.QuestionReply) -> Void) {
        self.core = core
        self.answer = answer
        _drafts = State(initialValue: QuestionnaireDrafts(questions))
        _previewed = State(initialValue: questions.map { question in max(0, question.options.firstIndex { $0.preview != nil } ?? 0) })
    }

    private var questions: [API.QuestionnaireQuestion] { drafts.questions }

    var body: some View {
        let question = questions[step]
        let last = step == questions.count - 1
        VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: questions.count > 1 ? "Questions" : question.header, progress: "\(step + 1)/\(questions.count)")
            if questions.count > 1 { chips }
            ScrollView {
                content(question).onGeometryChange(for: CGFloat.self, of: \.size.height) { contentHeight = $0 }
            }
            .frame(height: min(contentHeight, 460))
            HStack {
                Button("Cancel") { answer(.cancelled) }
                if step > 0 { Button("Back") { step -= 1 } }
                Spacer()
                Button(last ? "Submit" : "Next") {
                    if last { answer(.answers(drafts.reply)) } else { step += 1 }
                }
                .buttonStyle(.borderedProminent)
                .disabled(last && !drafts.anyAnswered)
            }
            .controlSize(.small)
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(questions.enumerated()), id: \.offset) { index, each in
                    let answered = drafts.drafts[index].answered
                    HStack(spacing: 2) {
                        if answered { Text("✓") }
                        Text(each.header)
                    }
                    .typeface(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(index == step ? AnyShapeStyle(.tint.opacity(0.2)) : AnyShapeStyle(.quaternary), in: Capsule())
                    .contentShape(Capsule())
                    .onTapGesture { step = index }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(answered ? "\(each.header) (answered)" : each.header)
                    .accessibilityValue("tab")
                    .accessibilityAddTraits(index == step ? .isSelected : [])
                }
            }
        }
    }

    @ViewBuilder private func content(_ question: API.QuestionnaireQuestion) -> some View {
        let draft = drafts.drafts[step]
        let preview = question.options.indices.contains(previewed[step]) ? question.options[previewed[step]].preview : nil
        VStack(alignment: .leading, spacing: 6) {
            Text(question.question).typeface(.body, weight: .medium).fixedSize(horizontal: false, vertical: true)
            if question.multiSelect {
                Text("Choose all that apply.").typeface(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                let selected = draft.selected.contains(option.label)
                OptionRow(selected: selected, number: index + 1) {
                    Text(option.label).bold()
                    if !option.description.isEmpty {
                        Text(option.description).typeface(.caption).foregroundStyle(.secondary)
                    }
                }
                .onTapGesture {
                    drafts.pick(option.label, at: step)
                    if option.preview != nil { previewed[step] = index }
                }
                .accessibilityLabel(option.label)
                .accessibilityIdentifier("question-option")
                .accessibilityValue("\(question.multiSelect ? "checkbox" : "radio button"), \(selected ? "checked" : "unchecked")")
            }
            OptionRow(selected: draft.customChosen && !draft.trimmedCustom.isEmpty, number: question.options.count + 1) {
                TextField("", text: Binding(get: { drafts.drafts[step].custom }, set: { drafts.type($0, at: step) }), prompt: Text("Type something…"))
                    .accessibilityLabel("Your own answer")
                    .accessibilityValue(draft.custom)
            }
            if let preview {
                ScrollView {
                    MarkdownView(source: preview, agent: false, core: core).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 160)
                .padding(8)
                .background(.background, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Preview")
            }
        }
    }
}

private struct OptionRow<Copy: View>: View {
    let selected: Bool
    let number: Int
    @ViewBuilder let copy: Copy

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) { copy }
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(number)").typeface(.caption, mono: true).foregroundStyle(.secondary)
        }
        .padding(8)
        .background(selected ? AnyShapeStyle(.tint.opacity(0.12)) : AnyShapeStyle(.clear), in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
    }
}

private struct SecretCard: View {
    let secret: API.SessionQuestion.Secret
    let answer: (ConversationModel.QuestionReply) -> Void
    @State private var value = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CardHeader(title: "Secret", progress: "1/1")
            Text(secret.title).typeface(.body, weight: .medium)
            Text(secret.message).typeface(.callout)
            Text("Kept out of the conversation: the agent gets a temporary file, never the value.").typeface(.caption).foregroundStyle(.secondary)
            SecureField("", text: $value)
                .textFieldStyle(.roundedBorder)
                .textContentType(.oneTimeCode)
                .accessibilityLabel("Value")
                .focused($focused)
                .onSubmit(submit)
            HStack {
                Button("Cancel") { answer(.cancelled) }
                Spacer()
                Button("Submit", action: submit).buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
        }
        .onAppear { focused = true }
    }

    private func submit() {
        guard !value.isEmpty else { return }
        answer(.value(value))
    }
}
