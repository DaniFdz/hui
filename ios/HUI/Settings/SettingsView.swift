// The web's Settings shell as its phone layout shows it: the open page under its title, and Open settings navigation
// bringing up the page list as a sheet, with Search settings (the core's filterSettingsPages), the pages in their
// groups, whether settings were saved and Exit Settings. Appearance is a Form with the web's Color mode, Text size and
// Chat preferences; the other pages show their web introduction until their controls are built.
import SwiftUI

struct SettingsView: View {
    let page: String
    let core: HUICore
    let settings: SettingsModel
    let client: GatewayClient?
    let select: (String) -> Void
    let exit: () -> Void
    @State private var navigating = false
    @State private var pages: [SettingsPageEntry] = []

    var body: some View {
        Form {
            Section {
                Text(pages.first { $0.id == page }?.label ?? "").font(.largeTitle.bold()).accessibilityIdentifier("settings-page-title").accessibilityAddTraits(.isHeader)
                Text(SettingsView.intros[page] ?? "").foregroundStyle(.secondary)
            }
            if page == "appearance" { AppearanceSections(settings: settings, client: client) }
            Section {
                SaveIndicator(failed: settings.saveFailed)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Open settings navigation", systemImage: "sidebar.left") { navigating = true }
            }
        }
        .sheet(isPresented: $navigating) {
            SettingsNavigation(page: page, core: core, saveFailed: settings.saveFailed, select: { chosen in
                navigating = false
                select(chosen)
            }, exit: {
                navigating = false
                exit()
            }, close: { navigating = false })
        }
        .task {
            pages = (try? await core.filterSettingsPages("")) ?? []
        }
    }

    static let intros = [
        "appearance": "Theme, chat, and sidebar preferences for this Control UI client.",
        "connection": "Gateway access and live PI runtime state.",
        "integrations": "Connect HUI to external services. Credentials stay on this machine and are never sent to the browser.",
        "plugins": "PI packages and extension sources. Disable one to exclude it from new HUI SDK runtimes without uninstalling it or changing PI settings.",
        "memory": "Workspace-local context and memory inventory. Nothing is copied into PI or OpenClaw.",
        "automation": "Scheduled tasks, manual runs and run history owned by HUI.",
        "security": "Local exposure, credential boundaries and diagnostic privacy.",
        "worktrees": "Linked worktrees of the Git repositories your HUI sessions use, plus those New Session created in ~/.config/hui/worktrees. Main checkouts are not listed.",
        "diagnostics": "Runtime logs, activity, health and a redacted diagnostic export.",
    ]
}

struct SettingsPageEntry: Decodable, Hashable, Sendable {
    var id: String
    var label: String
    var group: String
}

private struct SaveIndicator: View {
    let failed: Bool

    var body: some View {
        Label(failed ? "Settings not saved" : "Settings saved locally", systemImage: "circle.fill")
            .foregroundStyle(failed ? .red : .secondary)
    }
}

private struct SettingsNavigation: View {
    let page: String
    let core: HUICore
    let saveFailed: Bool
    let select: (String) -> Void
    let exit: () -> Void
    let close: () -> Void
    @State private var query = ""
    @State private var shown: [SettingsPageEntry] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        TextField("Search settings", text: $query).accessibilityLabel("Search settings").accessibilityValue(query)
                        if !query.isEmpty {
                            Button("Clear settings search", systemImage: "xmark.circle.fill") { query = "" }.labelStyle(.iconOnly)
                        }
                    }
                    .padding(10)
                    .background(.quaternary, in: .rect(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(groups, id: \.self) { group in
                            if !group.isEmpty { Text(group).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 8) }
                            ForEach(shown.filter { $0.group == group }, id: \.id) { entry in
                                Button { select(entry.id) } label: { Text(entry.label).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) }
                                    .accessibilityIdentifier("settings-page-link")
                                    .accessibilityAddTraits(entry.id == page ? .isSelected : [])
                                    .fontWeight(entry.id == page ? .semibold : .regular)
                                    .foregroundStyle(entry.id == page ? Color.accentColor : .primary)
                            }
                        }
                        if shown.isEmpty { Text("No settings match.").foregroundStyle(.secondary) }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Settings pages")
                    Divider()
                    SaveIndicator(failed: saveFailed)
                    Button("Exit Settings", action: exit)
                }
                .padding()
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close settings navigation", systemImage: "xmark", action: close)
                }
            }
        }
        .task(id: query) {
            shown = (try? await core.filterSettingsPages(query)) ?? []
        }
    }

    private var groups: [String] {
        var seen = Set<String>()
        return shown.map(\.group).filter { seen.insert($0).inserted }
    }
}

private struct AppearanceSections: View {
    let settings: SettingsModel
    let client: GatewayClient?

    var body: some View {
        if let current = settings.settings {
            Section {
                Choices(label: "Color mode", options: [(API.Settings.ThemeMode.system, "System"), (.light, "Light"), (.dark, "Dark")], chosen: current.themeMode) { mode in
                    settings.change(client) { $0.themeMode = mode }
                }
            } header: {
                Text("Color mode")
            } footer: {
                Text("Follows your system setting unless you pick one.")
            }
            Section {
                Choices(label: "Text size", options: [(API.Settings.TextScale._90, "Small 90%"), (._100, "Default 100%"), (._110, "Large 110%"), (._125, "XL 125%"), (._140, "XXL 140%")], chosen: current.textScale) { scale in
                    settings.change(client) { $0.textScale = scale }
                }
            } header: {
                Text("Text size")
            } footer: {
                Text("Scales every text size in the interface together. Using default: 100%.")
            }
            Section {
                Picker("Message width", selection: Binding(get: { current.chat.messageWidth }, set: { width in settings.change(client) { $0.chat.messageWidth = width } })) {
                    Text("Compact").tag(API.Settings.Chat.MessageWidth.compact)
                    Text("Comfortable").tag(API.Settings.Chat.MessageWidth.comfortable)
                    Text("Wide").tag(API.Settings.Chat.MessageWidth.wide)
                }
                Toggle("Collapse task progress", isOn: Binding(get: { current.chat.collapseTaskProgress }, set: { on in settings.change(client) { $0.chat.collapseTaskProgress = on } }))
                Picker("Send shortcut", selection: Binding(get: { current.chat.sendShortcut }, set: { shortcut in settings.change(client) { $0.chat.sendShortcut = shortcut } })) {
                    Text("Enter").tag(API.Settings.Chat.SendShortcut.enter)
                    Text("⌘/Ctrl + Enter").tag(API.Settings.Chat.SendShortcut.modifierEnter)
                }
                Toggle("GitHub link previews", isOn: Binding(get: { current.chat.githubEmbeds }, set: { on in settings.change(client) { $0.chat.githubEmbeds = on } }))
                Toggle("Datadog link previews", isOn: Binding(get: { current.chat.datadogEmbeds }, set: { on in settings.change(client) { $0.chat.datadogEmbeds = on } }))
            } header: {
                Text("Chat")
            } footer: {
                Text("Composer and conversation preferences. Stored for this HUI client.")
            }
            Section {
                Text(settings.saveFailed ? "Could not write settings.json — changes apply now but will not be remembered." : "Saved to ~/.config/hui/settings.json")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            Text("Reading settings…")
        }
    }
}

private struct Choices<Value: Hashable>: View {
    let label: String
    let options: [(Value, String)]
    let chosen: Value
    let pick: (Value) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96))]) {
            ForEach(options, id: \.0) { option in
                Button { pick(option.0) } label: { Text(option.1).frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .tint(chosen == option.0 ? .accentColor : .secondary)
                    .accessibilityAddTraits(chosen == option.0 ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}
