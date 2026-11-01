// The picks a questionnaire card keeps while the operator moves between questions: a single-select pick replacing the
// last and the typed answer, a multi-select toggling picks beside typed text, which questions count as answered, and
// the reply the card sends.
import Testing
@testable import HUI

struct QuestionnaireDraftsTests {
    private func question(_ header: String, multiSelect: Bool = false) -> API.QuestionnaireQuestion {
        .init(header: header, question: "\(header)?", multiSelect: multiSelect, options: [
            .init(label: "A", description: "", preview: nil),
            .init(label: "B", description: "", preview: nil),
        ])
    }

    @Test func aSingleSelectPickReplacesTheLastAndTypingReplacesThePick() {
        var drafts = QuestionnaireDrafts([question("One")])
        drafts.pick("A", at: 0)
        drafts.pick("B", at: 0)
        #expect(drafts.reply == [.init(selected: ["B"], custom: nil)])
        drafts.type("  Mine ", at: 0)
        #expect(drafts.reply == [.init(selected: [], custom: "Mine")])
        drafts.pick("A", at: 0)
        #expect(drafts.reply == [.init(selected: ["A"], custom: nil)])
    }

    @Test func aMultiSelectTogglesPicksAndKeepsTypedText() {
        var drafts = QuestionnaireDrafts([question("Many", multiSelect: true)])
        drafts.pick("B", at: 0)
        drafts.pick("A", at: 0)
        drafts.pick("B", at: 0)
        drafts.type("More", at: 0)
        #expect(drafts.reply == [.init(selected: ["A"], custom: "More")])
    }

    @Test func onlyAPickOrNonBlankTextAnswersAQuestion() {
        var drafts = QuestionnaireDrafts([question("One"), question("Two")])
        #expect(!drafts.anyAnswered)
        drafts.type("   ", at: 1)
        #expect(!drafts.drafts[1].answered)
        #expect(!drafts.anyAnswered)
        drafts.type("Text", at: 1)
        #expect(drafts.drafts.map(\.answered) == [false, true])
        #expect(drafts.reply == [.init(selected: [], custom: nil), .init(selected: [], custom: "Text")])
    }
}
