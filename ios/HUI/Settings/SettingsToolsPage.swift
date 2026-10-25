// Settings → Tools, as the web's Tools page shows its Browser and Codemode sections on a phone: the managed browser's
// status pill (its words come from the core's browserStatusLabel), the Browser tool and Run headless switches, the
// browser executable, Start and Stop for the managed browser with its profile directory and the tabs agents opened, and
// the Codemode switch. The switches save through SettingsModel, one write at a time; ToolsModel reads GET /__hui/browser
// and controls it with POST /__hui/browser, and the page reads its status every 4 s while it shows, as the web polls it,
// and again after every change. A failure reads where the web shows its error; tab previews stay on the web.
import Observation
import SwiftUI

@MainActor
struct ToolsSections: View {
    let client: GatewayClient?
    let settings: SettingsModel
    @State private var model: ToolsModel
    @State private var executable = ""
    @Environment(\.themeCard) private var card

    init(client: GatewayClient?, settings: SettingsModel, core: HUICore) {
        self.client = client
        self.settings = settings
        _model = State(initialValue: ToolsModel(core: core))
    }

    var body: some View {
        Group {
            if settings.settings != nil {
                browser
                codemode
            } else {
                Text("Reading settings…").typeface(.body)
            }
        }
        .task {
            executable = settings.settings?.browser.executablePath ?? ""
            guard let client else { return }
            await model.load(client)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
                await model.load(client)
            }
        }
        .onChange(of: settings.settings?.browser.executablePath) { _, path in executable = path ?? "" }
    }

    @ViewBuilder
    private var browser: some View {
        Section {
            toggleRow("Browser tool", "Offer the browser tool to new and restarted sessions. Off, calls from sessions that are already running are refused too.", flag(\.browser.enabled))
            toggleRow("Run headless", "No window, Dock icon or focus change while you work. Turn off to watch the agent in a visible window; a running browser restarts in the new mode on its next use.", flag(\.browser.headless))
            executableRow
            if let status = model.status {
                processRow(status)
                if !status.profileDir.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Profile").typeface(.body)
                        Text("Cookies and logins created by agents stay in this HUI-only directory.").typeface(.footnote).foregroundStyle(.secondary)
                        Text(status.profileDir).typeface(.footnote, mono: true).foregroundStyle(.secondary)
                    }
                }
            }
            if let failure = model.failure {
                Text(failure).typeface(.footnote).foregroundStyle(.red)
            }
        } header: {
            HStack {
                Text("Browser")
                Spacer()
                Text(model.label?.label ?? "").typeface(.caption).foregroundStyle(tone(model.label?.kind ?? ""))
            }
        } footer: {
            Text("Agents get a dedicated Chromium-family browser with its own HUI profile. It never uses your browser windows, tabs, cookies or passwords.").typeface(.footnote)
        }
        .listRowBackground(card)
        if let status = model.status, !status.tabs.isEmpty {
            Section {
                ForEach(status.tabs, id: \.id) { tab in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(tab.id) · \(tab.title.isEmpty ? "Untitled" : tab.title)").typeface(.body)
                        Text(tab.url).typeface(.footnote).foregroundStyle(.secondary)
                        Text("Opened by \(tab.ownerTitle.isEmpty ? "a removed conversation" : tab.ownerTitle)").typeface(.footnote).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Open tabs · \(status.tabs.count)")
            }
            .listRowBackground(card)
        }
    }

    @ViewBuilder
    private var codemode: some View {
        Section {
            toggleRow("Codemode tool", "Offer codemode to every session, from its next request. A script that is already running finishes. Sessions still on the older PI worker don't get it.", flag(\.codemode.enabled))
        } header: {
            Text("Codemode")
        } footer: {
            Text("Agents can write one JavaScript script that calls their other tools, several at once, and get back only what the script prints. The chat shows each script as one card with the calls it made.").typeface(.footnote)
        }
        .listRowBackground(card)
    }

    private func toggleRow(_ title: String, _ description: String, _ isOn: Binding<Bool>) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).typeface(.body)
                Text(description).typeface(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Toggle(title, isOn: isOn).labelsHidden().accessibilityLabel(title)
        }
    }

    private func flag(_ keyPath: WritableKeyPath<API.Settings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings?[keyPath: keyPath] ?? false }, set: { on in
            settings.change(client) { $0[keyPath: keyPath] = on }
            Task { await reload() }
        })
    }

    private var executableRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Browser executable").typeface(.body)
            Text(executableDetail).typeface(.footnote).foregroundStyle(.secondary)
            HStack {
                TextField("Auto-detect", text: $executable)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Browser executable")
                    .accessibilityValue(executable)
                    .typeface(.body)
                    .onSubmit(saveExecutable)
                Button("Save", action: saveExecutable)
            }
        }
    }

    private func processRow(_ status: API.BrowserStatus) -> some View {
        let stopping = status.state == .stopping
        let pending = status.state == .starting || stopping
        let canStop = status.state == .running || stopping
        return VStack(alignment: .leading, spacing: 6) {
            Text("Managed browser").typeface(.body)
            Text(processDetail(status)).typeface(.footnote).foregroundStyle(.secondary)
            if status.state != .running, !status.lastError.isEmpty, status.lastError != model.failure {
                Text(status.lastError).typeface(.footnote).foregroundStyle(.red)
            }
            Button(canStop ? "Stop" : "Start") {
                Task { await control(canStop ? .stop : .start) }
            }
            .buttonStyle(.bordered)
            .disabled(model.busy || pending || (!canStop && (!status.enabled || status.executable == nil)))
        }
    }

    private var executableDetail: String {
        guard let status = model.status else { return "Leave empty to auto-detect Google Chrome, Brave, Microsoft Edge or Chromium." }
        guard let found = status.executable else { return status.executableError }
        return "\(found.source == .configured ? "Using" : "Detected") \(found.name) · \(found.path)"
    }

    private func processDetail(_ status: API.BrowserStatus) -> String {
        guard status.state == .running else { return "Starts when an agent opens a page and stops when its last tab closes. Stopping a turn closes its tabs; unused tabs close after 10 minutes." }
        var parts = [status.version.flatMap { $0.isEmpty ? nil : $0 } ?? status.executable?.name ?? "Browser"]
        parts.append(status.mode == .windowed ? "visible window" : "headless, no window")
        if let started = status.startedAt.flatMap(startedTime) { parts.append("started \(started)") }
        return parts.joined(separator: " · ")
    }

    private func startedTime(_ text: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: text) else { return nil }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func tone(_ kind: String) -> Color {
        switch kind {
        case "ok": .green
        case "warn": .orange
        case "danger": .red
        case "accent": .accentColor
        default: .secondary
        }
    }

    private func saveExecutable() {
        let value = executable.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.change(client) { $0.browser.executablePath = value }
        Task { await reload() }
    }

    private func reload() async {
        guard let client else { return }
        await model.load(client)
    }

    private func control(_ action: API.BrowserControl.Action) async {
        guard let client else { return }
        await model.control(action, client)
    }
}

@MainActor
@Observable
final class ToolsModel {
    private(set) var status: API.BrowserStatus?
    private(set) var label: BrowserStatusLabel?
    private(set) var failure: String?
    private(set) var busy = false
    private let core: HUICore
    private var loads = 0

    init(core: HUICore) {
        self.core = core
    }

    func load(_ client: GatewayClient) async {
        loads += 1
        let load = loads
        if label == nil { label = try? await core.browserStatusLabel(nil) }
        do {
            let raw = try await client.get("/__hui/browser", as: API.JSONValue.self)
            let next = try await core.normalizeBrowserStatus(raw)
            guard load == loads else { return }
            status = next
            label = try await core.browserStatusLabel(next)
            failure = nil
        } catch let error {
            guard load == loads, !Task.isCancelled else { return }
            failure = ToolsCopy.message(error)
        }
    }

    func control(_ action: API.BrowserControl.Action, _ client: GatewayClient) async {
        busy = true
        do {
            let raw = try await client.send("POST", "/__hui/browser", body: API.BrowserControl(action: action), as: API.JSONValue.self)
            let next = try await core.normalizeBrowserStatus(raw)
            loads += 1
            status = next
            label = try await core.browserStatusLabel(next)
            failure = nil
        } catch let error {
            failure = ToolsCopy.message(error)
            await load(client)
        }
        busy = false
    }
}

enum ToolsCopy {
    static func message(_ error: any Error) -> String {
        (error as? GatewayError)?.message ?? error.localizedDescription
    }
}