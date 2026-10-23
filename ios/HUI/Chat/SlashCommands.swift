// The composer's slash commands as the core describes them (`src/lib/composer/slash-commands.ts`): the session's
// commands merged under HUI's own, the "Commands and paths" menu for the command word being typed, with each match's
// reference and description and the draft it completes to, and what a send does (a HUI command, a refusal with its
// note, or a prompt).
import SwiftUI

struct ComposerCommand: Codable, Hashable, Sendable {
    var name: String
    var description: String
    var source: String
}

struct SlashOption: Codable, Hashable, Sendable {
    var name: String
    var description: String
    var source: String
    var reference: String
    var completion: String
}

struct SendContext: Encodable {
    var bot: Bool
    var attachments = 0
    var steering: Bool
    var busy: Bool
}

struct SendAction: Decodable {
    var kind: String
    var note: String?
    var instructions: String?
    var question: String?
}

struct SlashMenuView: View {
    let options: [SlashOption]
    let select: (SlashOption) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(options, id: \.self) { option in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(option.reference).font(.callout.monospaced())
                        Text(option.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .onTapGesture { select(option) }
                    .accessibilityElement(children: .contain)
                    .accessibilityAddTraits(.isButton)
                }
            }
            .padding(.horizontal, 10)
        }
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Commands and paths")
    }
}
