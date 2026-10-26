// The web's Settings shell as its phone layout shows it: the open page under its title, and Open settings navigation
// bringing up the page list as a sheet, with Search settings (the core's filterSettingsPages), the pages in their
// groups, whether settings were saved and Exit Settings; whether they were saved also stays at the bottom of every page.
// Appearance is a Form with the web's Theme, Color mode, Accent, the faces and the chat preferences; Models and
// Diagnostics are in SettingsPages.swift; the other pages show their web introduction until their controls are built.
// Text size is web only: the app draws its type at the phone's own text size (SPEC.md#the-iphone-app-follows-the-phones-text-size-2026-10-26).
// The words the web's Settings shell shares (page introductions, the empty search and the Color mode names) come from
// the core's SETTINGS_COPY.
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
    @Environment(\.themeCard) private var card
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Form {
            Section {
                Text(pages.first { $0.id == page }?.label ?? "").typeface(.largeTitle, weight: .bold)
                    .foregroundStyle(settings.accentInk(scheme) ?? .primary)
                    .accessibilityIdentifier("settings-page-title").accessibilityAddTraits(.isHeader)
                Text(settings.copy.intros[page] ?? "").typeface(.body).foregroundStyle(.secondary)
            }
            .listRowBackground(Color.clear)
            switch page {
            case "appearance": AppearanceSections(settings: settings, client: client)
            case "models": ModelsSections(settings: settings, client: client)
            case "tools": ToolsSections(client: client, settings: settings, core: core)
            case "automation": AutomationSections(client: client)
            case "diagnostics": DiagnosticsSections(client: client)
            default: EmptyView()
            }
        }
        .accessibilityIdentifier("settings-page")
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                SaveIndicator(failed: settings.saveFailed)
                if page == "appearance" {
                    Text(settings.saveFailed ? "Could not write settings.json — changes apply now but will not be remembered." : "Saved to ~/.config/hui/settings.json")
                        .typeface(.footnote).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.bar)
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Open settings navigation", systemImage: "sidebar.left") { navigating = true }
            }
        }
        .sheet(isPresented: $navigating) {
            SettingsNavigation(page: page, core: core, noMatch: settings.copy.noMatch, saveFailed: settings.saveFailed, select: { chosen in
                navigating = false
                select(chosen)
            }, exit: {
                navigating = false
                exit()
            }, close: { navigating = false })
            .modifier(Themed(settings: settings))
        }
        .task {
            pages = (try? await core.filterSettingsPages("")) ?? []
        }
    }
}

struct SettingsCopy: Decodable, Sendable {
    var noMatch = ""
    var modes: [String: String] = [:]
    var scales: [String: String] = [:]
    var intros: [String: String] = [:]
}

struct SettingsPageEntry: Decodable, Hashable, Sendable {
    var id: String
    var label: String
    var group: String
}

private struct SaveIndicator: View {
    let failed: Bool

    var body: some View {
        Label { Text(failed ? "Settings not saved" : "Settings saved locally").typeface(.body) } icon: { Image(systemName: "circle.fill") }
            .foregroundStyle(failed ? .red : .secondary)
    }
}

private struct SettingsNavigation: View {
    let page: String
    let core: HUICore
    let noMatch: String
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
                            if !group.isEmpty { Text(group).typeface(.footnote, weight: .semibold).foregroundStyle(.secondary).padding(.top, 8) }
                            ForEach(shown.filter { $0.group == group }, id: \.id) { entry in
                                Button { select(entry.id) } label: { Text(entry.label).typeface(.body).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle()) }
                                    .accessibilityIdentifier("settings-page-link")
                                    .accessibilityAddTraits(entry.id == page ? .isSelected : [])
                                    .fontWeight(entry.id == page ? .semibold : .regular)
                                    .foregroundStyle(entry.id == page ? Color.accentColor : .primary)
                            }
                        }
                        if shown.isEmpty { Text(noMatch).foregroundStyle(.secondary) }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Settings pages")
                    .typefaceReport(.body)
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
    @Environment(\.themeCard) private var card
    @Environment(\.colorScheme) private var scheme
    @State private var custom = ""
    @FocusState private var typingCustom: Bool

    var body: some View {
        if let current = settings.settings {
                Section {
                    if let themes = settings.themes {
                        Choices(label: "Theme", options: themes.map { ($0.id, $0.name) }, chosen: current.theme) { theme in
                            Task { await settings.choose(theme: theme, client) }
                        }
                    } else {
                        Text("No themes could be loaded; the built-in defaults are in use.").typeface(.body)
                    }
                } header: {
                    Text("Theme")
                }
                .listRowBackground(card)
                Section {
                    AccentSwatches(settings: settings, client: client, inherited: settings.accentInk(scheme) ?? .accentColor)
                    TextField("Custom accent color", text: $custom)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Custom accent color")
                        .accessibilityValue(custom)
                        .focused($typingCustom)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: custom) { _, typed in settings.setCustomAccent(typed, client) }
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Current accent").typeface(.body)
                            Text("Saved locally in HUI and applied over the active theme.").typeface(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(settings.accentName).typeface(.body).accessibilityIdentifier("settings-current-accent")
                    }

                } header: {
                    Text("Accent")
                } footer: {
                    Text("Choose the accent color used by buttons, highlights and focus controls.").typeface(.footnote)
                }
                .listRowBackground(card)
                Section {
                    FacePicker(label: "Interface font", chosen: settings.faceLabel(current.fontUi.rawValue), faces: settings.faces) { id in
                        settings.change(client) { $0.fontUi = API.Settings.FontUi(rawValue: id) }
                    }
                    FacePicker(label: "Chat prose font", chosen: settings.faceLabel(current.fontChat.rawValue), faces: settings.faces) { id in
                        settings.change(client) { $0.fontChat = API.Settings.FontChat(rawValue: id) }
                    }
                    TerminalPicker(label: "Terminal font", chosen: current.fontTerminal, fonts: settings.terminalFonts, normalize: { await settings.normalizeTerminalFont($0) }) { family in
                        settings.change(client) { $0.fontTerminal = family }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("HUI · A little clarity goes a long way").typeface(.body)
                        Text("Good typography makes room for the conversation. Choose a face that feels comfortable to read.").typeface(.body, prose: true)
                        Text("const greeting = \"Hello, world!\";").typeface(.footnote, mono: true)
                        Text("❯ ~/project ⎇ main \u{F07C} \u{F120} git status")
                            .typeface(.footnote, stack: settings.terminalPreview)
                            .accessibilityLabel("Terminal font preview")
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Typography")
                } footer: {
                    Text("Interface restyles chrome, navigation, settings and controls; Chat prose the conversation; code keeps its monospace face.").typeface(.footnote)
                }
                .listRowBackground(card)
            Section {
                Choices(label: "Color mode", options: ["system", "light", "dark"].map { (API.Settings.ThemeMode(rawValue: $0), settings.copy.modes[$0] ?? $0) }, chosen: current.themeMode) { mode in
                    settings.change(client) { $0.themeMode = mode }
                }
                .disabled(settings.variant != "both")
            } header: {
                Text("Color mode")
            } footer: {
                Text(settings.variant == "both" ? "Follows your system setting unless you pick one." : "This theme only carries a \(settings.variant) variant, so the mode follows the theme.").typeface(.footnote)
            }
            .listRowBackground(card)
            Section {
                Picker(selection: Binding(get: { current.chat.messageWidth }, set: { width in settings.change(client) { $0.chat.messageWidth = width } })) {
                    Text("Compact").tag(API.Settings.Chat.MessageWidth.compact)
                    Text("Comfortable").tag(API.Settings.Chat.MessageWidth.comfortable)
                    Text("Wide").tag(API.Settings.Chat.MessageWidth.wide)
                } label: {
                    Text("Message width").typeface(.body)
                }
                Text("Controls the maximum width of the conversation and composer.").typeface(.footnote).foregroundStyle(.secondary)
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
                Text("Composer and conversation preferences. Stored for this HUI client.").typeface(.footnote)
            }
            .listRowBackground(card)
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
                let chosen = chosen == option.0
                Group {
                    if chosen {
                        Button { pick(option.0) } label: { optionLabel(option.1) }.buttonStyle(.borderedProminent)
                    } else {
                        Button { pick(option.0) } label: { optionLabel(option.1) }.buttonStyle(.bordered)
                    }
                }
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func optionLabel(_ text: String) -> some View {
        Text(text).lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: .infinity)
    }
}
