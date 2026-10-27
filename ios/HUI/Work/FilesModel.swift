// One Files view of a conversation's working directory on the iPhone: the navigator's tree and filter, the new file and
// folder dialog, the delete confirmation and the one open file's draft, over the same `/__hui/sessions/:id/files…`
// routes the web view uses. The gateway owns the disk; this asks for one folder at a time as the reader expands it, and
// words every label through the core's `src/lib/files/copy.ts` so the phone says what the web says. A text file opens
// as a draft that saves itself a moment after typing stops; the delete confirmation reads that draft to say which
// unsaved edits and open file go with the entry.
import Foundation
import Observation

@MainActor
@Observable
final class FilesModel: Identifiable {
    struct Directory {
        var entries: [API.FileEntry]?
        var error: String?
        var truncated = false
    }

    struct CreateDialog: Identifiable {
        let id = UUID()
        var kind: API.FileCreateRequest.Kind
        var folder: String
        var title: String
        var destination: String
        var createLabel: String
        var name = ""
        var busy = false
        var error = ""
    }

    struct DeleteDialog: Identifiable {
        let id = UUID()
        var entry: API.FileEntry
        var title: String
        var risks: [String]
        var error = ""
    }

    let id = UUID()
    let sessionId: String
    private let client: GatewayClient
    private let core: HUICore

    private(set) var copy: FilesCopy?
    private(set) var info: API.FilesInfo?
    private(set) var failure: String?
    private(set) var directories: [String: Directory] = [:]
    private(set) var expanded: Set<String> = []
    private(set) var filter = ""
    private(set) var search: API.FilesSearch?
    private(set) var searchNote: String?
    private(set) var deleteLabels: [String: String] = [:]
    private(set) var selected: String?
    private(set) var file: API.FileRead?
    private(set) var text = ""
    private(set) var dirty = false
    private(set) var fileNote: String?
    private(set) var title = ""
    private(set) var editorLabel = ""
    var createDialog: CreateDialog?
    var deleteDialog: DeleteDialog?

    private var saved = ""
    private var searchTyping: Task<Void, Never>?
    private var saving: Task<Void, Never>?

    init(sessionId: String, client: GatewayClient, core: HUICore, copy: FilesCopy) {
        self.sessionId = sessionId
        self.client = client
        self.core = core
        self.copy = copy
        self.title = copy.view
    }

    var root: String {
        if case .available(let available) = info { return available.name }
        return copy?.workingDirectory ?? ""
    }

    // MARK: - Routes

    private func path(_ action: String = "", _ query: [String: String] = [:]) -> String {
        let base = "/__hui/sessions/\(sessionId)/files\(action.isEmpty ? "" : "/\(action)")"
        guard !query.isEmpty else { return base }
        let written = query.sorted { $0.key < $1.key }.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value)"
        }
        return "\(base)?\(written.joined(separator: "&"))"
    }

    func load() async {
        if info != nil { return }
        do {
            info = try await client.get(path(), as: API.FilesInfo.self)
        } catch {
            failure = error.localizedDescription
            return
        }
        if case .notAvailable(let missing) = info { failure = missing.reason; return }
        await loadDirectory("")
    }

    func loadDirectory(_ directory: String) async {
        directories[directory] = Directory(entries: directories[directory]?.entries, error: nil, truncated: false)
        do {
            let listing = try await client.get(path("list", ["path": directory]), as: API.FilesListing.self)
            directories[directory] = Directory(entries: listing.entries, error: nil, truncated: listing.truncated)
            for entry in listing.entries {
                if let label = try? await core.filesDeleteLabel(entry.name) { deleteLabels[entry.path] = label }
            }
        } catch {
            directories[directory] = Directory(entries: nil, error: error.localizedDescription, truncated: false)
        }
    }

    func toggle(_ entry: API.FileEntry) async {
        if expanded.contains(entry.path) {
            expanded.remove(entry.path)
            return
        }
        expanded.insert(entry.path)
        if directories[entry.path]?.entries == nil { await loadDirectory(entry.path) }
    }

    // MARK: - Filter

    func filterChanged(_ value: String) {
        filter = value
        searchTyping?.cancel()
        guard !value.trimmingCharacters(in: .whitespaces).isEmpty else {
            search = nil
            searchNote = nil
            return
        }
        searchTyping = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            await runSearch(value)
        }
    }

    private func runSearch(_ query: String) async {
        do {
            let found = try await client.get(path("search", ["q": query]), as: API.FilesSearch.self)
            guard query == filter else { return }
            search = found
            searchNote = found.entries.isEmpty ? try? await core.filesNoMatch(query) : nil
        } catch {
            guard query == filter else { return }
            search = nil
            searchNote = error.localizedDescription
        }
    }

    // MARK: - The open file

    func open(_ entry: API.FileEntry) async {
        await open(path: entry.path)
    }

    func open(path: String) async {
        selected = path
        file = nil
        text = ""
        saved = ""
        dirty = false
        fileNote = nil
        if let caption = try? await core.filesTabTitle(path) { title = caption }
        if let label = try? await core.filesEditorLabel(path) { editorLabel = label }
        do {
            let read = try await client.get(self.path("file", ["path": path]), as: API.FileRead.self)
            guard selected == path else { return }
            file = read
            text = read.content ?? ""
            saved = text
        } catch {
            guard selected == path else { return }
            fileNote = error.localizedDescription
        }
    }

    func edit(_ value: String) {
        text = value
        dirty = value != saved
        guard file?.kind == .text, file?.writable == true else { return }
        fileNote = nil
        saving?.cancel()
        saving = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func save() async {
        guard let open = file, open.kind == .text, open.writable, text != saved else { return }
        let content = text
        do {
            let answer = try await client.send("PUT", path("file", ["path": open.path]),
                                               body: API.FileSaveRequest(content: content),
                                               headers: ["if-match": "\"\(open.etag)\""], as: API.FileSaved.self)
            guard selected == open.path, file?.etag == open.etag else { return }
            var next = open
            next.etag = answer.etag
            next.size = answer.size
            next.mtime = answer.mtime
            file = next
            saved = content
            dirty = text != content
        } catch {
            guard selected == open.path else { return }
            fileNote = "Not saved: \(error.localizedDescription)"
        }
    }

    // MARK: - New file and folder

    func openCreate(_ kind: API.FileCreateRequest.Kind) async {
        let folder = selected.map { Self.parent(of: $0) } ?? ""
        let written = kind == .file ? "file" : "directory"
        createDialog = CreateDialog(kind: kind, folder: folder, title: kind == .file ? copy?.newFile ?? "" : copy?.newFolder ?? "",
                                    destination: (try? await core.filesCreateIn(folder, root)) ?? folder,
                                    createLabel: (try? await core.filesCreatedLabel(written)) ?? "")
    }

    func createName(_ value: String) {
        guard var dialog = createDialog else { return }
        dialog.name = value
        dialog.error = ""
        createDialog = dialog
    }

    func submitCreate(dialog: CreateDialog) async {
        guard var pending = createDialog, pending.id == dialog.id, !pending.busy else { return }
        let name = pending.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            pending.error = "Type a name."
            createDialog = pending
            return
        }
        pending.busy = true
        pending.error = ""
        createDialog = pending
        do {
            let entry = try await client.post(path("entry"), body: API.FileCreateRequest(path: Self.join(pending.folder, name), kind: pending.kind == .file ? .file : .directory),
                                              as: API.FileEntryResponse.self).entry
            createDialog = nil
            if !pending.folder.isEmpty { expanded.insert(pending.folder) }
            await loadDirectory(Self.parent(of: entry.path))
            if entry.kind == .file {
                await open(path: entry.path)
            } else {
                await toggle(entry)
            }
        } catch {
            guard var failed = createDialog, failed.id == pending.id else { return }
            failed.busy = false
            failed.error = error.localizedDescription
            createDialog = failed
        }
    }

    // MARK: - Delete

    func askDelete(_ entry: API.FileEntry) async {
        let open = selected.flatMap { Self.within($0, entry.path) ? $0 : nil }
        let unsaved = dirty && open != nil
        let size = entry.kind == .file && entry.size > 0 ? try? await core.filesBytes(entry.size) : nil
        let risk = FilesDeleteRiskInput(path: entry.path, directory: entry.kind == .directory, symlink: entry.kind == .symlink || entry.symlink == true,
                                        size: size, open: open, unsaved: unsaved ? Self.name(of: open ?? entry.path) : nil)
        deleteDialog = DeleteDialog(entry: entry, title: (try? await core.filesDeleteTitle(entry.name)) ?? "", risks: (try? await core.filesDeleteRisks(risk)) ?? [])
    }

    func confirmDelete(dialog: DeleteDialog) async {
        guard let pending = deleteDialog, pending.id == dialog.id else { return }
        let entry = pending.entry
        var query = ["path": entry.path]
        if entry.kind == .directory && entry.symlink != true { query["recursive"] = "1" }
        do {
            _ = try await client.send("DELETE", path("entry", query), as: API.FileDeleted.self)
        } catch {
            var failed = pending
            failed.error = error.localizedDescription
            deleteDialog = failed
            return
        }
        deleteDialog = nil
        if let open = selected, Self.within(open, entry.path) {
            selected = nil
            editorLabel = ""
            file = nil
            text = ""
            saved = ""
            dirty = false
            title = copy?.view ?? ""
        }
        expanded = expanded.filter { !Self.within($0, entry.path) }
        await loadDirectory(Self.parent(of: entry.path))
        if !filter.trimmingCharacters(in: .whitespaces).isEmpty { await runSearch(filter) }
    }

    // MARK: - What the navigator shows

    enum Row: Identifiable {
        case entry(API.FileEntry, depth: Int)
        case note(String, depth: Int)

        var id: String {
            switch self {
            case .entry(let entry, _): "entry:\(entry.path)"
            case .note(let text, let depth): "note:\(depth):\(text)"
            }
        }
    }

    var filtering: Bool {
        !filter.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// The navigator's rows in the order the web shows them: the matching files while filtering, else the folder's
    /// tree with the folders the reader opened, each empty, loading or refused folder saying so where its children go.
    var rows: [Row] {
        if filtering {
            guard let found = search?.entries, !found.isEmpty else {
                return searchNote.map { [.note($0, depth: 0)] } ?? []
            }
            return found.map { .entry($0, depth: 0) }
        }
        let root = directories[""]
        if let error = root?.error { return [.note(error, depth: 0)] }
        guard let entries = root?.entries else { return [.note(copy?.loading ?? "", depth: 0)] }
        if entries.isEmpty { return [.note(copy?.emptyRoot ?? "", depth: 0)] }
        return tree(entries, depth: 0)
    }

    private func tree(_ entries: [API.FileEntry], depth: Int) -> [Row] {
        var rows: [Row] = []
        for entry in entries {
            rows.append(.entry(entry, depth: depth))
            guard entry.kind == .directory, expanded.contains(entry.path) else { continue }
            let state = directories[entry.path]
            if let error = state?.error {
                rows.append(.note(error, depth: depth + 1))
            } else if let children = state?.entries {
                if children.isEmpty { rows.append(.note(copy?.emptyFolder ?? "", depth: depth + 1)) }
                else { rows.append(contentsOf: tree(children, depth: depth + 1)) }
                if state?.truncated == true { rows.append(.note(copy?.truncated ?? "", depth: depth + 1)) }
            } else {
                rows.append(.note(copy?.loadingFolder ?? "", depth: depth + 1))
            }
        }
        return rows
    }

    // MARK: - Paths

    static func parent(of path: String) -> String {
        path.contains("/") ? String(path[..<path.lastIndex(of: "/")!]) : ""
    }

    static func name(of path: String) -> String {
        String(path[(path.lastIndex(of: "/").map { path.index(after: $0) } ?? path.startIndex)...])
    }

    static func join(_ folder: String, _ name: String) -> String {
        folder.isEmpty ? name : "\(folder)/\(name)"
    }

    static func within(_ path: String, _ folder: String) -> Bool {
        path == folder || path.hasPrefix("\(folder)/")
    }
}

struct FilesDeleteRiskInput: Encodable, Sendable {
    var path: String
    var directory: Bool
    var symlink: Bool
    var size: String?
    var open: String?
    var unsaved: String?
}