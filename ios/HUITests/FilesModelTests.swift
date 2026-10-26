// The Files view's model against a stubbed gateway: the folder's listing and its expansion, the filter's result, a new
// entry in the open file's folder, and the delete confirmation's list read from the open draft. Every word it asserts
// comes from the core, as the screen's do.
import Foundation
import Testing
@testable import HUI

@MainActor
struct FilesModelTests {
    private func model(_ routes: [String: [(status: Int, body: Data)]]) async throws -> (FilesModel, String) {
        let host = "\(UUID().uuidString.lowercased()).stub.test"
        GatewayStub.serve(host, routes: routes)
        let core = try HUICore.bundled()
        let copy = try await core.filesCopy()
        let model = FilesModel(sessionId: "s1", client: GatewayClient(baseURL: URL(string: "http://\(host)")!), core: core, copy: copy)
        return (model, host)
    }

    private func info() -> Data {
        Data(#"{"available":true,"root":"/tmp/hui-fixture/workspace","name":"workspace"}"#.utf8)
    }

    private func listing(_ entries: String, path: String = "") -> Data {
        Data(#"{"path":"\#(path)","entries":[\#(entries)],"truncated":false}"#.utf8)
    }

    @Test func theNavigatorListsTheFolderAndOpensAFolderOnDemand() async throws {
        let (model, _) = try await model([
            "/__hui/sessions/s1/files": [(200, info())],
            "/__hui/sessions/s1/files/list": [
                (200, listing(#"{"name":"empty","path":"empty","kind":"directory","size":0},{"name":"outside","path":"outside","kind":"symlink","size":0},{"name":"sub","path":"sub","kind":"directory","size":0}"#)),
                (200, listing(#"{"name":"keep.txt","path":"sub/keep.txt","kind":"file","size":5}"#, path: "sub")),
                (200, listing("", path: "empty")),
            ],
        ])
        await model.load()
        #expect(model.rows.compactMap { row -> String? in if case .entry(let entry, let depth) = row, depth == 0 { entry.name } else { nil } } == ["empty", "outside", "sub"])
        #expect(model.rows.count == 3)

        let sub = try #require(model.rows.compactMap { row -> API.FileEntry? in if case .entry(let entry, _) = row { entry } else { nil } }.first { $0.name == "sub" })
        await model.toggle(sub)
        #expect(model.deleteLabels["sub/keep.txt"] == "Delete keep.txt")
        let keep = try #require(model.rows.compactMap { row -> (String, Int)? in if case .entry(let entry, let depth) = row { (entry.name, depth) } else { nil } }.first { $0.0 == "keep.txt" })
        #expect(keep.1 == 1)

        let empty = try #require(model.rows.compactMap { row -> API.FileEntry? in if case .entry(let entry, _) = row { entry } else { nil } }.first { $0.name == "empty" })
        await model.toggle(empty)
        #expect(model.rows.contains { row in if case .note(let text, let depth) = row { text == model.copy?.emptyFolder && depth == 1 } else { false } })
    }

    @Test func aNewEntryGoesInTheOpenFilesFolderAndTheDeleteConfirmationListsTheOpenDraft() async throws {
        let (model, host) = try await model([
            "/__hui/sessions/s1/files": [(200, info())],
            "/__hui/sessions/s1/files/list": [
                (200, listing(#"{"name":"docs","path":"docs","kind":"directory","size":0},{"name":"sub","path":"sub","kind":"directory","size":0}"#)),
                (200, listing(#"{"name":"keep.txt","path":"sub/keep.txt","kind":"file","size":5}"#, path: "sub")),
            ],
            "/__hui/sessions/s1/files/file": [(200, Data(#"{"path":"sub/keep.txt","name":"keep.txt","size":5,"mtime":"2026-01-01T00:00:00.000Z","etag":"v1","writable":true,"kind":"text","mimeType":"text/plain","content":"sub\n"}"#.utf8))],
        ])
        await model.load()
        let sub = try #require(model.rows.compactMap { row -> API.FileEntry? in if case .entry(let entry, _) = row { entry } else { nil } }.first { $0.name == "sub" })
        await model.toggle(sub)
        let keep = try #require(model.rows.compactMap { row -> API.FileEntry? in if case .entry(let entry, _) = row { entry } else { nil } }.first { $0.name == "keep.txt" })
        await model.open(keep)
        #expect(model.editorLabel == "Contents of sub/keep.txt")
        model.edit("edited on screen")
        #expect(model.dirty)

        await model.openCreate(.directory)
        let dialog = try #require(model.createDialog)
        #expect(dialog.title == "New folder")
        #expect(dialog.destination == "In sub")
        #expect(dialog.createLabel == "Create folder")

        let docs = try #require(model.rows.compactMap { row -> API.FileEntry? in if case .entry(let entry, _) = row { entry } else { nil } }.first { $0.name == "docs" })
        await model.askDelete(docs)
        let confirmation = try #require(model.deleteDialog)
        #expect(confirmation.title == "Delete docs?")
        #expect(confirmation.risks == [
            "The folder docs and everything inside it.",
            "Unsaved edits to keep.txt.",
            "The open file sub/keep.txt closes.",
        ])
        #expect(GatewayStub.paths(host).contains("/__hui/sessions/s1/files/file"))
    }
}