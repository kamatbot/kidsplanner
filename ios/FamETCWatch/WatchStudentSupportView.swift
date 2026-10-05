import SwiftUI

struct WatchStudentSupportLink: View {
    @EnvironmentObject private var store: WatchStore
    var body: some View {
        if store.snapshot.context?.profile.role == "kid" {
            NavigationLink { WatchStudentSupportView() } label: {
                Label("My Next · Pack, homework, routines", systemImage: "checklist")
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct WatchStudentSupportView: View {
    @EnvironmentObject private var store: WatchStore
    @State private var discard = false
    var body: some View {
        List {
            if let error = store.supportError { Text(error).foregroundStyle(.orange) }
            if !store.supportOutbox.isEmpty {
                Section("Saved on Watch · \(store.supportOutbox.count) pending") {
                    Text("These changes are not confirmed yet.")
                    ForEach(store.supportOutbox) { command in
                        Text("\(command.type.replacingOccurrences(of: "_", with: " ")): \(command.payload.status ?? command.payload.nextStep ?? command.payload.submission ?? "step change")")
                    }
                    Button("Discard saved changes & reload", role: .destructive) { discard = true }
                        .disabled(store.drainingSupport)
                }
            }
            if let support = store.studentSupport {
                Text("Updated \(support.refreshedAt)").font(.caption)
                if support.enabled {
                    NavigationLink("Pack") { packing(support) }
                    NavigationLink("Homework") { homework }
                    NavigationLink("Routines") { routines(support) }
                    Toggle("Gentle support cues", isOn: Binding(get: {
                        store.snapshot.supportRemindersEnabled == true
                    }, set: { enabled in Task { await store.setSupportReminders(enabled) } }))
                    Text("Generic cues on this Watch. Quiet hours and Schooltime still apply. Offline cues may remain until refresh.").font(.footnote)
                } else { Text("My Next is off. Ask a parent to set it up.") }
            } else { Text("Support unavailable. Refresh when connected.") }
            Button("Refresh") { Task { await store.refresh() } }
        }
        .navigationTitle("My Next")
        .confirmationDialog("Discard all saved support changes?", isPresented: $discard) {
            Button("Discard & reload", role: .destructive) { Task { await store.discardSupportChanges() } }
        }
    }

    private func packing(_ support: WatchStudentSupport) -> some View {
        let support = store.studentSupport ?? support
        return List {
            Text(support.packing.date ?? "No school date confirmed")
            Text("Source: \(support.packing.coverage)")
            if let message = support.packing.message { Text(message) }
            if support.packing.items.isEmpty { Text("No packing list available. Check with a parent.") }
            ForEach(support.packing.items) { item in
                NavigationLink {
                    List {
                        Text(item.title).font(.headline)
                        Text("\(item.phase.capitalized) · \(item.status.replacingOccurrences(of: "_", with: " "))")
                        Text(item.reasons.joined(separator: ", "))
                        ForEach(["needed", "packed", "morning", "at_school", "missing"], id: \.self) { status in
                            Button(status.replacingOccurrences(of: "_", with: " ").capitalized) {
                                Task { await store.supportCommand("packing_item", .init(date: support.packing.date, itemId: item.id, status: status)) }
                            }.disabled(store.supportConflict)
                        }
                    }
                } label: { Text("\(item.title) · \(item.status.replacingOccurrences(of: "_", with: " "))") }
            }
        }.navigationTitle("Pack")
    }

    private func routines(_ support: WatchStudentSupport) -> some View {
        let support = store.studentSupport ?? support
        return List {
            if support.occurrences.isEmpty { Text("No agreed routines yet.") }
            ForEach(support.occurrences) { occurrence in
                NavigationLink {
                    List {
                        Text(occurrence.title).font(.headline)
                        Text("\(occurrence.date) \(occurrence.time) · \(occurrence.status)")
                        ForEach(occurrence.steps) { step in
                            Button("\(step.done ? "✓ " : "")\(step.title)") {
                                let done = store.studentSupport?.occurrences.first(where: { $0.id == occurrence.id })?.steps.first(where: { $0.id == step.id })?.done ?? step.done
                                Task { await store.supportCommand("routine_step", .init(occurrenceId: occurrence.id, stepId: step.id, done: !done)) }
                            }
                        }
                        ForEach(["done", "skipped", "handed_off", "open"], id: \.self) { status in
                            Button(status.replacingOccurrences(of: "_", with: " ").capitalized) {
                                Task { await store.supportCommand("routine_status", .init(status: status, occurrenceId: occurrence.id)) }
                            }
                        }
                        Button("Snooze 15 minutes") {
                            Task { await store.supportCommand("routine_status", .init(status: "snoozed", occurrenceId: occurrence.id, snoozedUntil: ISO8601DateFormatter().string(from: Date().addingTimeInterval(900)))) }
                        }
                        NavigationLink("Ask parent for help") {
                            List {
                                Text("Your parents will see that you need help with \(occurrence.title). No chat message is sent.")
                                Button("Share help request") {
                                    Task { await store.supportCommand("routine_status", .init(status: "help", occurrenceId: occurrence.id)) }
                                }
                            }
                        }
                    }.disabled(store.supportConflict)
                } label: { Text("\(occurrence.title) · \(occurrence.status)") }
            }
        }.navigationTitle("Routines")
    }

    private var homework: some View {
        List {
            if store.snapshot.homework.isEmpty { Text("No homework loaded. Refresh to check.") }
            ForEach(store.snapshot.homework) { work in
                NavigationLink(work.title) { WatchSupportHomeworkView(work: work) }
            }
        }.navigationTitle("Homework")
    }
}

private struct WatchSupportHomeworkView: View {
    @EnvironmentObject private var store: WatchStore
    let work: WatchHomework
    @State private var nextStep = ""
    @State private var minutes = 10
    var body: some View {
        let plan = store.studentSupport?.homeworkPlans.first { $0.homeworkId == work.id }
        List {
            Text(work.title).font(.headline)
            Text("School due: \(work.dueDate)")
            TextField("One next step", text: $nextStep)
            Button("Save next step") { send(.init(homeworkId: work.id, nextStep: nextStep)) }
            Text(plan?.workFinished == true ? "Work finished" : "Work not yet finished")
            Button(plan?.workFinished == true ? "Reopen work" : "Work finished") {
                send(.init(homeworkId: work.id, workFinished: !(plan?.workFinished ?? false)))
            }
            Text("Hand-in: \(plan?.submission == "reported" ? "self-reported" : plan?.submission ?? "unknown")")
            Text("Method: \(plan?.handInMethod ?? "unknown")")
            Button("I handed it in (self-report)") { send(.init(homeworkId: work.id, submission: "reported")) }
            Button("Still need to hand in") { send(.init(homeworkId: work.id, submission: "pending")) }
            Text("This does not confirm school receipt or change school completion.").font(.footnote)
            Picker("Timer minutes", selection: $minutes) {
                Text("No timer").tag(0)
                ForEach([5, 10, 15, 20], id: \.self) { Text("\($0)").tag($0) }
            }
            if minutes > 0 {
                Button("Start Watch timer") { Task { await store.startFocus(on: work, minutes: minutes) } }
                    .disabled(store.focusSession != nil)
            }
            Text("Timer is local to this Watch. It never finishes homework.").font(.footnote)
        }
        .disabled(store.supportConflict)
        .onAppear { nextStep = plan?.nextStep ?? "" }
    }
    private func send(_ payload: WatchSupportCommand.Payload) {
        Task { await store.supportCommand("homework_plan", payload) }
    }
}
