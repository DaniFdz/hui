// The Settings pages past Appearance, as the web's settings view renders them on a phone. Models: HUI model routing's
// Primary, Fallback and Utility pickers over PI's model catalog (GET /__hui/pi) and Use PI default, written to the
// settings document's `models`. Diagnostics: the gateway's runtime, activity retention and token total from
// GET /__hui/observability, "Reading diagnostics…" while it reads and the error with Retry when it fails.
import SwiftUI

struct ModelsSections: View {
    let settings: SettingsModel
    let client: GatewayClient?
    @State private var catalog: [API.PiModelCatalogEntry]?
    @State private var open: WritableKeyPath<API.Settings.Models, String>?
    @Environment(\.themeCard) private var card

    var body: some View {
        if let current = settings.settings?.models, let catalog {
            Section {
                route("Primary model", \.primary, current, catalog, "The smartest model you have. Speed doesn't matter: it does the real work of new sessions and bots.")
                route("Fallback model", \.fallback, current, catalog, "Tried when the primary fails before producing useful output. Example: Anthropic Sonnet when OpenAI is unavailable.")
                route("Utility model", \.utility, current, catalog, "The fastest model you have, ideally a cheap one. It names sessions and branches, drafts Jira items and answers /btw; for bots without their own, it writes memory summaries, answers quick questions on calls and writes call summaries.")
            } header: {
                Text("HUI model routing")
            } footer: {
                Text("Saved by HUI and applied to new sessions.").typeface(.footnote)
            }
            .listRowBackground(card)
        } else {
            Text("Reading models…").typeface(.body)
                .task {
                    guard let client else { return }
                    catalog = (try? await client.get("/__hui/pi", as: API.PiSnapshot.self))?.model.catalog ?? []
                }
        }
    }

    private func route(_ label: String, _ key: WritableKeyPath<API.Settings.Models, String>, _ current: API.Settings.Models, _ catalog: [API.PiModelCatalogEntry], _ description: String) -> some View {
        let options = [("", "Use PI default")] + catalog.map { ("\($0.provider)/\($0.id)", $0.name) }
        let chosen = options.first { $0.0 == current[keyPath: key] }?.1 ?? current[keyPath: key]
        return VStack(alignment: .leading, spacing: 8) {
            Button { open = open == key ? nil : key } label: {
                HStack {
                    Text(label).typeface(.body)
                    Spacer()
                    Text(chosen).typeface(.body).foregroundStyle(.secondary)
                    Image(systemName: "chevron.up.chevron.down")
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(label): \(chosen)")
            .accessibilityAddTraits(.isButton)
            Text(description).typeface(.footnote).foregroundStyle(.secondary)
            if open == key {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(options, id: \.0) { option in
                        Button {
                            open = nil
                            settings.change(client) { $0.models[keyPath: key] = option.0 }
                        } label: {
                            Text(option.1).typeface(.body).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .accessibilityAddTraits(option.0 == current[keyPath: key] ? .isSelected : [])
                    }
                }
                .padding(.leading)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(label)
            }
        }
        .buttonStyle(.borderless)
    }
}

struct DiagnosticsSections: View {
    let client: GatewayClient?
    @State private var snapshot: API.ObservabilitySnapshot?
    @State private var failure: String?
    @State private var reads = 0
    @Environment(\.themeCard) private var card

    var body: some View {
        Group {
            if let snapshot {
                Section {
                    row("Runtime", "\(snapshot.debug.platform) · \(snapshot.debug.node)", "Online")
                    row("Activity retention", "Best-effort in-memory operational metadata.", "\(Int(snapshot.debug.eventCount)) / \(Int(snapshot.retention.maximum))")
                    row("Usage metadata", "Aggregated without transcript content.", "\(Int(snapshot.usage.totalTokens).formatted(.number.locale(Locale(identifier: "en_US")))) tokens")
                } header: {
                    Text("Gateway")
                } footer: {
                    Text("Current process-level diagnostic state.").typeface(.footnote)
                }
                .listRowBackground(card)
            } else {
                Section {
                    Text(failure ?? "Reading diagnostics…").typeface(.body)
                    Button("Retry") { reads += 1 }
                }
                .listRowBackground(card)
            }
        }
        .task(id: reads) {
            guard let client else { return }
            do {
                snapshot = try await client.get("/__hui/observability")
                failure = nil
            } catch {
                failure = (error as? GatewayError)?.message ?? error.localizedDescription
            }
        }
    }

    private func row(_ title: String, _ description: String, _ value: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).typeface(.body)
                Text(description).typeface(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Text(value).typeface(.body)
        }
    }
}
