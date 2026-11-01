// A tool call's card in the chat, named as the web's cards name theirs: a read ("Read <file>", failed on its row, the
// file, a Tool error block and the output), a shell command (its preview as the row's name, with failed while closed,
// the full command after "$", its output and Running, Completed or failed), a codemode script (the tools it called, a
// failed or "N failed" badge and its wall time, then its Script, Calls and Output with a Full output reference) and any
// other tool (its name and Running, Completed or Failed, then Input and Output with Copy output). A read's, command's
// or script's text copies from its context menu as "Copy as markdown".
import SwiftUI
import UIKit

struct ToolCardView: View {
    let item: TranscriptItem
    @Binding var expanded: Bool

    private static let callStatus = ["running": ("…", "Running"), "ok": ("✓", "Done"), "error": ("✗", "Failed"), "cancelled": ("⊘", "Cancelled")]

    private var running: Bool { (item.status ?? "running") == "running" }
    private var failed: Bool { item.failed == true || item.status == "failed" }
    private var outcome: String { failed ? "failed" : running ? "Running" : "Completed" }

    var body: some View {
        if let read = item.read {
            card(label: "Read \(read.target)", badge: failed && !expanded, title: Text("Read ").bold() + Text(read.target)) {
                Text(read.detail).typeface(.caption).foregroundStyle(.secondary)
                if !read.output.isEmpty {
                    if failed { Text("Tool error").typeface(.caption, weight: .bold) }
                    code(read.output).copyable(item.output ?? "")
                }
                Text(outcome).typeface(.caption)
            }
        } else if let command = item.command {
            card(label: failed && !expanded ? "\(command.preview) failed" : command.preview, badge: failed && !expanded,
                 title: Text("$ ").foregroundStyle(.secondary) + Text(command.preview).font(.system(size: 13, design: .monospaced))) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("$").typeface(.caption, mono: true).foregroundStyle(.secondary).accessibilityHidden(true)
                    code(command.command)
                }
                if let output = item.output, !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    code(output).copyable(output)
                }
                Text(outcome).typeface(.caption)
            }
        } else if let codemode = item.codemode {
            codemodeCard(codemode)
        } else {
            otherCard
        }
    }

    private func codemodeCard(_ codemode: CodemodeCard) -> some View {
        let badge = codemode.state == "failed" ? "failed" : codemode.failedCalls > 0 ? "\(codemode.failedCalls) failed" : nil
        let time = codemode.wallSeconds.map { "\($0)s" }
        let title = [badge.map { Text(" \($0)").foregroundStyle(.red) }, time.map { Text(" \($0)").foregroundStyle(.secondary) }]
            .compactMap(\.self).reduce(Text("codemode ").bold() + Text(codemode.summary), +)
        let errorAt = codemode.output.range(of: "(?m)^Script error:", options: .regularExpression)
        return card(label: ["codemode", codemode.summary, badge, time].compactMap(\.self).joined(separator: " "), badge: false, title: title) {
            section("Script") { code(codemode.code) }.copyable(codemode.code)
            if !codemode.calls.isEmpty {
                Text("Calls · \(codemode.calls.count)").typeface(.caption, weight: .bold)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(codemode.calls.indices, id: \.self) { index in
                        let call = codemode.calls[index]
                        let (glyph, status) = Self.callStatus[call.status] ?? ("?", call.status)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(glyph).accessibilityLabel(status)
                                Text(call.name).typeface(.caption, weight: .bold)
                                Text(call.args).typeface(.caption, mono: true).lineLimit(1)
                                Spacer()
                                if !call.duration.isEmpty { Text(call.duration).typeface(.caption).foregroundStyle(.secondary) }
                            }
                            if let error = call.error { Text(error).typeface(.caption).foregroundStyle(.red) }
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Calls")
            }
            if !codemode.output.isEmpty {
                section("Output") {
                    if let errorAt {
                        (Text(codemode.output[..<errorAt.lowerBound]) + Text(codemode.output[errorAt.lowerBound...]).foregroundStyle(.red))
                            .typeface(.caption, mono: true)
                    } else {
                        code(codemode.output)
                    }
                    if let path = codemode.fullOutputPath {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Full output:").typeface(.caption, weight: .bold)
                            Text(path).typeface(.caption)
                        }
                    }
                }
                .copyable(item.output ?? "")
            }
            Text(codemode.outcome).typeface(.caption)
        }
    }

    private var otherCard: some View {
        let name = item.name ?? "tool"
        let status = item.status == "failed" ? "Failed" : running ? "Running" : "Completed"
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).bold()
                Button(status) { expanded.toggle() }.buttonStyle(.plain).foregroundStyle(item.status == "failed" ? .red : .secondary)
                Spacer()
                Image(systemName: expanded ? "chevron.up" : "chevron.down").accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .onTapGesture { expanded.toggle() }
            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    if let input = item.input {
                        Text("Input").typeface(.caption, weight: .bold)
                        code(input)
                    }
                    if let output = item.output {
                        HStack {
                            Text("Output").typeface(.caption, weight: .bold)
                            Spacer()
                            Button("Copy output") { UIPasteboard.general.string = output }.typeface(.caption)
                        }
                        code(output.isEmpty ? "No output" : output)
                    }
                }
                .padding(8)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func card(label: String, badge: Bool, title: Text, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
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
                if badge { Text("failed").typeface(.caption).foregroundStyle(.red) }
            }
            if expanded {
                VStack(alignment: .leading, spacing: 6) { content() }
                    .padding(8)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func section(_ name: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name).typeface(.caption, weight: .bold).accessibilityLabel("").accessibilityHidden(true)
            content()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(name)
    }

    private func code(_ text: String) -> some View {
        Text(text).typeface(.caption, mono: true)
    }
}

private extension View {
    func copyable(_ text: String) -> some View {
        contextMenu { Button("Copy as markdown") { UIPasteboard.general.string = text } }
    }
}
