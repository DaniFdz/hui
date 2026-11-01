// The web's Automation settings page: the scheduler's snapshot from GET /__hui/automation, rendered as the web renders
// it (the Scheduler section with its next wake and how many runs are in flight or "Idle.", the task list with each
// task's schedule, next and last run and its Run now, Enable and Actions controls, and Run history with each run's
// label, start, finish, summary, error and Cancel while it runs). A refused task or run action reads above the list it
// belongs to, and the task editor saves through PUT /__hui/automation/tasks/:id. Run now
// (POST …/tasks/:id/run), Cancel (POST …/runs/:id/cancel) and Delete (DELETE …/tasks/:id) refresh the snapshot, which
// is polled every 3 s while the page shows, as the web's automation controller polls it.
import Observation
import SwiftUI

struct AutomationSections: View {
    let client: GatewayClient?
    @State private var model = AutomationModel()
    @State private var editing: EditedTask?
    @Environment(\.themeCard) private var card

    var body: some View {
        Group {
            if let snapshot = model.snapshot {
                scheduler(snapshot)
                if let actionError = model.actionError {
                    Section {
                        Text(actionError).typeface(.body).foregroundStyle(.red)
                            .accessibilityIdentifier("automation-action-error")
                    }
                    .listRowBackground(card)
                }
                tasks(snapshot)
                history(snapshot)
                if let error = model.error {
                    Section {
                        Text("Refresh failed: \(error)").typeface(.footnote).foregroundStyle(.red)
                    }
                    .listRowBackground(card)
                }
            } else {
                Section {
                    Text(model.error ?? "Reading automation state…").typeface(.body)
                    if model.error != nil {
                        Button {
                            Task { await load() }
                        } label: {
                            Text("Retry").typeface(.body)
                        }
                    }
                }
                .listRowBackground(card)
            }
        }
        .task {
            guard let client else { return }
            await model.load(client)
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                if !model.pending { await model.load(client) }
            }
        }
        .sheet(item: $editing) { edited in
            TaskEditor(task: edited.task, save: { input in await model.save(edited.task, input, client) }, dismiss: { editing = nil })
        }
    }

    private func load() async {
        guard let client else { return }
        await model.load(client)
    }

    private func scheduler(_ snapshot: API.AutomationSnapshot) -> some View {
        let runs = Int(snapshot.scheduler.activeRuns)
        return Section {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next wake").typeface(.body)
                    Text("When the scheduler next checks for due tasks.").typeface(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                Text(AutomationCopy.timestamp(snapshot.scheduler.nextWakeAt)).typeface(.body).foregroundStyle(.secondary)
            }
        } header: {
            Text("Scheduler").typeface(.footnote)
        } footer: {
            Text(runs > 0 ? "\(runs) run\(runs == 1 ? "" : "s") in flight" : "Idle.").typeface(.footnote)
        }
        .listRowBackground(card)
    }

    private func tasks(_ snapshot: API.AutomationSnapshot) -> some View {
        Section {
            if snapshot.tasks.isEmpty {
                HStack {
                    Text("Nothing scheduled").typeface(.body)
                    Spacer()
                    Text("—").typeface(.body).foregroundStyle(.secondary)
                }
            }
            ForEach(snapshot.tasks, id: \.id) { task in
                taskRow(task, snapshot)
            }
        } header: {
            Text("Tasks").typeface(.footnote)
        } footer: {
            Text(snapshot.tasks.isEmpty ? "No tasks configured." : "\(snapshot.tasks.count) task\(snapshot.tasks.count == 1 ? "" : "s") configured").typeface(.footnote)
        }
        .listRowBackground(card)
    }

    private func taskRow(_ task: API.AutomationTask, _ snapshot: API.AutomationSnapshot) -> some View {
        let lastRun = snapshot.runs.first { $0.taskId == task.id }
        let retryAt = lastRun?.status == .queued ? lastRun?.retryAt : nil
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                editing = EditedTask(task: task)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.name).typeface(.body, weight: .semibold)
                    Text(task.description.isEmpty ? task.sessionId : task.description).typeface(.footnote).foregroundStyle(.secondary)
                    Text(task.prompt).typeface(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Edit \(task.name)")
            .accessibilityAddTraits(.isButton)
            Text(AutomationCopy.schedule(task.schedule)).typeface(.footnote).foregroundStyle(.secondary)
            Text("\(retryAt == nil ? "Next run" : "Next retry") \(AutomationCopy.timestamp(retryAt ?? task.nextRunAt))").typeface(.footnote).foregroundStyle(.secondary)
            Text("Last run \(lastRun.map(AutomationCopy.label) ?? "—")").typeface(.footnote).foregroundStyle(.secondary)
            HStack(spacing: 16) {
                Button {
                    Task { await model.run(task, client) }
                } label: {
                    Image(systemName: "play")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Run now: \(task.name)")
                Toggle(isOn: Binding(get: { task.enabled }, set: { enabled in Task { await model.setEnabled(task, enabled, client) } })) {
                    Text("Enable \(task.name)").typeface(.footnote)
                }
                Spacer()
                Menu {
                    Button(role: .destructive) {
                        Task { await model.delete(task, client) }
                    } label: {
                        Text("Delete").typeface(.body)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Actions for \(task.name)")
            }
            .disabled(model.pending)
        }
    }

    private func history(_ snapshot: API.AutomationSnapshot) -> some View {
        Section {
            if snapshot.runs.isEmpty {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("No runs").typeface(.body)
                        Text("Manual and scheduled runs appear here with their outcome.").typeface(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("—").typeface(.body).foregroundStyle(.secondary)
                }
            }
            ForEach(snapshot.runs, id: \.id) { run in
                runRow(run)
            }
        } header: {
            Text("Run history").typeface(.footnote)
        } footer: {
            Text(snapshot.runs.isEmpty ? "No runs recorded yet." : "\(snapshot.runs.count) recorded run\(snapshot.runs.count == 1 ? "" : "s")").typeface(.footnote)
        }
        .listRowBackground(card)
    }

    private func runRow(_ run: API.AutomationRun) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(run.taskName).typeface(.body, weight: .semibold)
                Spacer()
                Text(AutomationCopy.label(run)).typeface(.body).foregroundStyle(.secondary)
            }
            Text("\(run.source == .manual ? "Manual" : "Scheduled") · started \(AutomationCopy.timestamp(run.startedAt ?? run.createdAt))\(run.finishedAt.map { " · finished \(AutomationCopy.timestamp($0))" } ?? "")")
                .typeface(.footnote).foregroundStyle(.secondary)
            if let summary = run.summary, !summary.isEmpty {
                Text(summary).typeface(.footnote)
            }
            if let error = run.error {
                Text(error).typeface(.footnote).foregroundStyle(.red)
            }
            if AutomationCopy.active(run) {
                Button {
                    Task { await model.cancel(run, client) }
                } label: {
                    Text("Cancel").typeface(.body)
                }
                .buttonStyle(.bordered)
                .disabled(model.pending)
            }
        }
    }
}

private struct TaskEditor: View {
    let task: API.AutomationTask
    let save: (API.AutomationTaskInput) async -> String?
    let dismiss: () -> Void
    @State private var name: String
    @State private var description: String
    @State private var prompt: String
    @State private var timeout: String
    @State private var failure: String?
    @State private var saving = false

    init(task: API.AutomationTask, save: @escaping (API.AutomationTaskInput) async -> String?, dismiss: @escaping () -> Void) {
        self.task = task
        self.save = save
        self.dismiss = dismiss
        _name = State(initialValue: task.name)
        _description = State(initialValue: task.description)
        _prompt = State(initialValue: task.prompt)
        _timeout = State(initialValue: String(Int(task.timeoutSeconds)))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).typeface(.body).accessibilityLabel("Name")
                    TextField("Description", text: $description).typeface(.body).accessibilityLabel("Description")
                    TextField("Prompt", text: $prompt, axis: .vertical).typeface(.body).accessibilityLabel("Prompt")
                    TextField("Timeout (seconds)", text: $timeout).typeface(.body).keyboardType(.numberPad).accessibilityLabel("Timeout (seconds)")
                    Text(AutomationCopy.schedule(task.schedule)).typeface(.footnote).foregroundStyle(.secondary)
                } header: {
                    Text("Edit task").typeface(.footnote)
                } footer: {
                    Text("The schedule and session stay as they are.").typeface(.footnote)
                }
                Section {
                    if let failure {
                        Text(failure).typeface(.footnote).foregroundStyle(.red)
                    }
                    Button {
                        Task { await submit() }
                    } label: {
                        Text("Update task").typeface(.body)
                    }
                    .disabled(saving)
                    Button {
                        dismiss()
                    } label: {
                        Text("Cancel edit").typeface(.body)
                    }
                }
            }
            .navigationTitle(task.name)
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func submit() async {
        guard let seconds = Double(timeout) else {
            failure = "Timeout must be a whole number of seconds."
            return
        }
        saving = true
        failure = await save(task.input(name: name, description: description, prompt: prompt, timeoutSeconds: seconds))
        saving = false
        if failure == nil { dismiss() }
    }
}

private struct EditedTask: Identifiable {
    let task: API.AutomationTask
    var id: String { task.id }
}

@MainActor
@Observable
final class AutomationModel {
    private(set) var snapshot: API.AutomationSnapshot?
    private(set) var error: String?
    private(set) var actionError: String?
    private(set) var pending = false
    private var loads = 0

    func load(_ client: GatewayClient) async {
        loads += 1
        let load = loads
        do {
            let next = try await client.get("/__hui/automation", as: API.AutomationSnapshot.self)
            guard load == loads else { return }
            snapshot = next
            error = nil
        } catch let failure {
            guard load == loads else { return }
            error = AutomationCopy.message(failure)
        }
    }

    func run(_ task: API.AutomationTask, _ client: GatewayClient?) async {
        actionError = await mutate(client) { client in
            _ = try await client.send("POST", "/__hui/automation/tasks/\(task.id)/run", as: API.AutomationRunResponse.self)
        }
    }

    func cancel(_ run: API.AutomationRun, _ client: GatewayClient?) async {
        actionError = await mutate(client) { client in
            _ = try await client.send("POST", "/__hui/automation/runs/\(run.id)/cancel", as: API.AutomationCancelResponse.self)
        }
    }

    func delete(_ task: API.AutomationTask, _ client: GatewayClient?) async {
        actionError = await mutate(client) { client in
            _ = try await client.send("DELETE", "/__hui/automation/tasks/\(task.id)", as: API.AutomationMutationResponse.self)
        }
    }

    func setEnabled(_ task: API.AutomationTask, _ enabled: Bool, _ client: GatewayClient?) async {
        actionError = await mutate(client) { client in
            _ = try await client.send("PUT", "/__hui/automation/tasks/\(task.id)", body: task.input(enabled: enabled), as: API.AutomationMutationResponse.self)
        }
    }

    func save(_ task: API.AutomationTask, _ input: API.AutomationTaskInput, _ client: GatewayClient?) async -> String? {
        await mutate(client) { client in
            _ = try await client.send("PUT", "/__hui/automation/tasks/\(task.id)", body: input, as: API.AutomationMutationResponse.self)
        }
    }

    private func mutate(_ client: GatewayClient?, _ change: (GatewayClient) async throws -> Void) async -> String? {
        guard let client else { return "Not connected to a gateway." }
        guard !pending else { return nil }
        pending = true
        actionError = nil
        do {
            try await change(client)
        } catch let failure {
            pending = false
            return AutomationCopy.message(failure)
        }
        await load(client)
        pending = false
        return nil
    }
}

private enum AutomationCopy {
    static func schedule(_ schedule: API.AutomationSchedule) -> String {
        switch schedule {
        case .at(let value):
            return "Once at \(timestamp(value.at))"
        case .every(let value):
            let minutes = Int((value.everyMs / 60_000).rounded())
            if minutes % 1440 == 0 {
                let days = minutes / 1440
                return "Every \(days == 1 ? "day" : "\(days) days")"
            }
            if minutes % 60 == 0 {
                let hours = minutes / 60
                return "Every \(hours == 1 ? "hour" : "\(hours) hours")"
            }
            return "Every \(minutes == 1 ? "minute" : "\(minutes) minutes")"
        case .cron(let value):
            return "Cron \(value.expression) (\(value.timezone))"
        case .unrecognized:
            return "A schedule this app does not know"
        }
    }

    static func label(_ run: API.AutomationRun) -> String {
        if run.status == .queued, run.retryAt != nil { return "Retry scheduled" }
        if run.status == .failed, run.failure?.needsAttention == true { return "Needs attention" }
        switch run.status {
        case .queued: return "Queued"
        case .running: return "Running"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .skipped: return "Skipped"
        case .cancelled: return "Cancelled"
        case .unrecognized(let value): return value
        }
    }

    static func active(_ run: API.AutomationRun) -> Bool {
        run.status == .queued || run.status == .running
    }

    static func timestamp(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        return parsed(value).map { $0.formatted(date: .numeric, time: .shortened) } ?? value
    }

    static func message(_ error: any Error) -> String {
        (error as? GatewayError)?.message ?? error.localizedDescription
    }

    private static func parsed(_ value: String) -> Date? {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) { return date }
        return try? Date.ISO8601FormatStyle().parse(value)
    }
}

extension API.AutomationTask {
    func input(enabled: Bool? = nil, name: String? = nil, description: String? = nil, prompt: String? = nil, timeoutSeconds: Double? = nil) -> API.AutomationTaskInput {
        API.AutomationTaskInput(
            name: name ?? self.name,
            description: description ?? self.description,
            sessionId: sessionId,
            prompt: prompt ?? self.prompt,
            schedule: schedule,
            enabled: enabled ?? self.enabled,
            timeoutSeconds: timeoutSeconds ?? self.timeoutSeconds
        )
    }
}