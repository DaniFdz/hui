// The agent's task progress card above the composer, as the web's `session-progress-card` draws it: folded, the current
// step and its done/total count; open, Task progress with N of M, the agent's Markdown notes and each step marked
// pending, in progress or done. It starts open unless every step is done or Collapse task progress is on, and a tap on
// the summary folds or opens it from then on.
import SwiftUI

struct ProgressCardView: View {
    let card: API.ProgressCard
    let core: HUICore
    let collapsed: Bool
    @State private var toggled: Bool?

    private var completed: Int { card.steps.count { $0.status == .completed } }
    private var allComplete: Bool { !card.steps.isEmpty && completed == card.steps.count }
    private var current: API.ProgressStep? {
        card.steps.first { $0.status == .inProgress } ?? card.steps.first { $0.status == .pending } ?? card.steps.last
    }
    private var open: Bool { toggled ?? !(collapsed || allComplete) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { toggled = !open } label: {
                HStack(spacing: 6) {
                    marker(current?.status)
                    if open {
                        Text("Task progress").bold()
                        Text(count)
                    } else {
                        Text(current?.step ?? "Task progress")
                        Text(completedOfTotal)
                    }
                    Spacer(minLength: 0)
                }
                .typeface(.caption)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(open ? "Task progress, \(count)" : "\(current?.step ?? "Task progress"), \(completedOfTotal)")
            .accessibilityIdentifier("task-progress-summary")

            if open {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        if !card.markdown.isEmpty {
                            MarkdownView(source: card.markdown, agent: false, core: core)
                        }
                        ForEach(Array(card.steps.enumerated()), id: \.offset) { _, step in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                marker(step.status)
                                Text(step.step).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .typeface(.caption)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("task-progress-step")
                            .accessibilityValue(step.status.rawValue)
                        }
                    }
                }
                .frame(maxHeight: 160)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Task progress")
                .accessibilityIdentifier("task-progress-steps")
            }
        }
        .padding(10)
        .background(.tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(.tint.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-progress")
    }

    private var count: String { card.steps.isEmpty ? "" : "\(completed) of \(card.steps.count)" }
    private var completedOfTotal: String { card.steps.isEmpty ? "" : "\(completed)/\(card.steps.count)" }

    @ViewBuilder private func marker(_ status: API.ProgressStep.Status?) -> some View {
        switch status {
        case .completed?:
            Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
        case .inProgress?:
            ProgressView().controlSize(.mini).accessibilityHidden(true)
        default:
            Image(systemName: "circle").foregroundStyle(.secondary).accessibilityHidden(true)
        }
    }
}
