// One Files view in the Work pane: the navigator (the conversation folder's tree, expanded on demand, a filter, New file
// and New folder) above the open file's draft, as the web's Files view lays them side by side. A row's menu asks to
// delete it, which opens the confirmation the web shows, listing what goes. Words come from `FilesModel`'s copy, which
// the core holds for both platforms; the dialog sheets read their live state from the model so a refusal stays on
// screen with its reason.
import SwiftUI

struct FilesView: View {
    @Bindable var model: FilesModel
    let core: HUICore

    var body: some View {
        VStack(spacing: 0) {
            navigator
            if model.selected != nil {
                Divider()
                editor
                    .frame(maxHeight: .infinity)
            }
        }
        .task { await model.load() }
        .sheet(item: $model.deleteDialog) { dialog in
            FilesDeleteSheet(model: model, dialog: dialog)
        }
    }

    private var copy: FilesCopy? { model.copy }

    private var navigator: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(model.root).typeface(.headline)
                Spacer()
            }
            HStack(spacing: 8) {
                Button(copy?.newFile ?? "") { Task { await model.openCreate(.file) } }
                Button(copy?.newFolder ?? "") { Task { await model.openCreate(.directory) } }
                Spacer()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").accessibilityHidden(true).foregroundStyle(.secondary)
                TextField(copy?.filter ?? "", text: Binding(get: { model.filter }, set: { model.filterChanged($0) }))
                    .accessibilityLabel(copy?.filter ?? "")
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            .padding(6)
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
            List {
                ForEach(model.rows) { item in
                    row(item)
                }
            }
            .listStyle(.plain)
            .accessibilityIdentifier("files-tree")
            if let failure = model.failure {
                Text(failure).typeface(.footnote).foregroundStyle(.red)
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(copy?.navigator ?? "")
        .sheet(item: $model.createDialog) { dialog in
            FilesCreateSheet(model: model, dialog: dialog)
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.selected ?? "")
                .typeface(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.head)
            if let file = model.file, file.kind == .text {
                TextEditor(text: Binding(get: { model.text }, set: { model.edit($0) }))
                    .accessibilityLabel(model.editorLabel)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .disabled(!file.writable)
            } else if let note = model.fileNote {
                Text(note).typeface(.footnote).foregroundStyle(.secondary)
                Spacer()
            } else {
                Text(copy?.loadingFolder ?? "").typeface(.footnote).foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    @ViewBuilder private func row(_ item: FilesModel.Row) -> some View {
        switch item {
        case .note(let text, let depth):
            Text(text)
                .typeface(.footnote)
                .foregroundStyle(.secondary)
                .padding(.leading, CGFloat(depth) * 16)
        case .entry(let entry, let depth):
            HStack(spacing: 8) {
                Image(systemName: glyph(entry)).accessibilityHidden(true).foregroundStyle(.secondary)
                switch entry.kind {
                case .directory:
                    Button { Task { await model.toggle(entry) } } label: {
                        Text(entry.name).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                case .file:
                    Button { Task { await model.open(entry) } } label: {
                        Text(entry.name).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                default:
                    Text(entry.name)
                    Text(entry.kind == .symlink ? copy?.linkOutside ?? "" : copy?.notRegularFile ?? "")
                        .typeface(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.leading, CGFloat(depth) * 16)
            .contextMenu {
                Button(model.deleteLabels[entry.path] ?? "") { Task { await model.askDelete(entry) } }
            }
        }
    }

    private func glyph(_ entry: API.FileEntry) -> String {
        if entry.kind == .directory { return model.expanded.contains(entry.path) ? "folder.fill" : "folder" }
        if entry.kind == .symlink { return "link" }
        return "doc"
    }
}

private struct FilesCreateSheet: View {
    let model: FilesModel
    let dialog: FilesModel.CreateDialog

    var body: some View {
        let copy = model.copy
        let live = model.createDialog ?? dialog
        NavigationStack {
            Form {
                Text(live.title).typeface(.headline)
                Text(live.destination)
                TextField(copy?.name ?? "", text: Binding(get: { model.createDialog?.name ?? "" }, set: { model.createName($0) }))
                    .accessibilityLabel(copy?.name ?? "")
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                if !live.error.isEmpty {
                    Text(live.error).foregroundStyle(.red)
                }
                Button(live.busy ? "Creating…" : live.createLabel) {
                    Task { await model.submitCreate(dialog: live) }
                }
                .disabled(live.busy)
                Button(copy?.cancel ?? "") { model.createDialog = nil }
            }
        }
    }
}

private struct FilesDeleteSheet: View {
    let model: FilesModel
    let dialog: FilesModel.DeleteDialog

    var body: some View {
        let copy = model.copy
        let live = model.deleteDialog ?? dialog
        NavigationStack {
            Form {
                Text(live.title).typeface(.headline)
                Text(copy?.irreversible ?? "")
                ForEach(live.risks, id: \.self) { risk in
                    Text(risk)
                }
                if !live.error.isEmpty {
                    Text(live.error).foregroundStyle(.red)
                }
                Button(copy?.delete ?? "", role: .destructive) {
                    Task { await model.confirmDelete(dialog: live) }
                }
                Button(copy?.cancel ?? "") { model.deleteDialog = nil }
            }
        }
    }
}