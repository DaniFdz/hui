// Appearance's pickers as the web's searchable selects are on a phone: Interface font and Chat prose font open the
// core's face catalogue (TYPEFACES, its labels and each face's family drawn in that face), Terminal font opens the
// core's TERMINAL_FONTS with the search field that offers a typed family as "Use this local font", and the accent
// swatches offer the core's ACCENTS with the colour picker's hex field beside them. Each row reads as the web's control
// does, "<label>: <chosen>", and the chosen face of a list carries the selected trait, as the web's aria-pressed does.
import SwiftUI

struct AccentSwatches: View {
    let settings: SettingsModel
    let client: GatewayClient?
    let inherited: Color
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44))], spacing: 10) {
            ForEach(settings.accents, id: \.id) { preset in
                let chosen = settings.settings?.accent == preset.value
                Button {
                    settings.change(client) { $0.accent = preset.value }
                } label: {
                    Circle()
                        .fill(Color(hex: preset.value) ?? inherited)
                        .frame(width: 34, height: 34)
                        .overlay {
                            if chosen { Image(systemName: preset.value.isEmpty ? "arrow.counterclockwise" : "checkmark").foregroundStyle(.white).font(.system(size: 15, weight: .bold)) }
                        }
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(preset.label)
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Accent color")
    }
}

struct FacePickerRow: View {
    let label: String
    let chosen: String
    let faces: [TypefaceFace]
    let pick: (String) -> Void
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack {
                Text(label).typeface(.body)
                Spacer()
                Text(chosen).typeface(.body).foregroundStyle(.secondary)
                Image(systemName: "chevron.up.chevron.down")
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(chosen)")
        .accessibilityAddTraits(.isButton)
        .sheet(isPresented: $open) {
            NavigationStack {
                List(faces, id: \.id) { face in
                    Button {
                        open = false
                        pick(face.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(face.label).typeface(.body)
                            Text(face.note).typeface(.footnote).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .accessibilityAddTraits(face.label == chosen ? .isSelected : [])
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(label)
                .navigationTitle(label)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }
}

struct TerminalPickerRow: View {
    let label: String
    let chosen: String
    let fonts: [String]
    let normalize: (String) async -> String
    let pick: (String) -> Void
    @State private var open = false
    @State private var query = ""
    @State private var local = ""

    private var matches: [String] {
        query.isEmpty ? fonts : fonts.filter { $0.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        Button { open = true } label: {
            HStack {
                Text(label).typeface(.body)
                Spacer()
                Text(chosen).typeface(.body).foregroundStyle(.secondary)
                Image(systemName: "chevron.up.chevron.down")
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(chosen)")
        .accessibilityAddTraits(.isButton)
        .sheet(isPresented: $open) {
            NavigationStack {
                List {
                    TextField("Search or type a font name", text: $query)
                        .accessibilityLabel("Search or type a font name")
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    ForEach(matches, id: \.self) { font in
                        Button {
                            open = false
                            pick(font)
                        } label: {
                            Text(font).typeface(.body, mono: true).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .accessibilityAddTraits(font == chosen ? .isSelected : [])
                    }
                    if !local.isEmpty {
                        Button {
                            open = false
                            pick(local)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(local).typeface(.body, mono: true)
                                Text("Use this local font").typeface(.footnote).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                    }
                    if matches.isEmpty, local.isEmpty { Text("No matches").typeface(.body).foregroundStyle(.secondary) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(label)
                .navigationTitle(label)
                .navigationBarTitleDisplayMode(.inline)
                .task(id: query) {
                    let normalized = await normalize(query)
                    local = normalized == query && !query.isEmpty ? query : ""
                }
            }
        }
    }
}