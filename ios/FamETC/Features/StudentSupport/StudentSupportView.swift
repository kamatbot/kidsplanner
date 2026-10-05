import SwiftUI

struct StudentSupportEntry: View {
    @Environment(AppStore.self) private var app
    @State private var presented = false
    var body: some View {
        if app.productPlan == .full, app.me != nil, app.family != nil, !app.needsAuth {
            Button { presented = true } label: {
                Label(app.isParent ? "Student organizer" : "My Next", systemImage: "checklist")
                    .font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .buttonStyle(.bordered).accessibilityIdentifier("studentSupport.entry")
            .sheet(isPresented: $presented) { StudentSupportView() }
            .onChange(of: app.me?.id) { _, _ in presented = false }
            .onChange(of: app.family?.id) { _, _ in presented = false }
            .onChange(of: app.needsAuth) { _, value in if value { presented = false } }
        }
    }
}

struct StudentSupportView: View {
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = StudentSupportStore.shared
    @State private var selectedKid = ""
    @State private var showSetup = false
    @State private var discard = false
    private var kids: [Kid] { app.family?.kids.filter { app.isParent || $0.id == app.me?.kidId } ?? [] }
    var body: some View {
        NavigationStack {
            List {
                if app.isParent {
                    Section {
                        Picker("Student", selection: $selectedKid) {
                            ForEach(kids) { Text($0.name).tag($0.id) }
                        }.disabled(!model.pending.isEmpty || model.busy)
                        Button("Set up agreed routines and materials") { showSetup = true }
                            .disabled(model.snapshot == nil || !model.pending.isEmpty)
                    }
                }
                if let message = model.message { Section { Text(message).foregroundStyle(.secondary) } }
                if !model.pending.isEmpty {
                    Section("Saved changes: \(model.pending.count)") {
                        Text("These changes are pending, not confirmed by the server. Keep this student selected until synced or discarded.")
                        Button("Retry sync") { Task { await model.sync() } }.disabled(model.conflict || model.busy)
                        Button("Discard pending changes and reload", role: .destructive) { discard = true }
                            .disabled(model.busy)
                    }
                }
                if let snapshot = model.snapshot {
                    if snapshot.enabled {
                        if app.isParent {
                            Section("Exceptions for this student") {
                                let missing = snapshot.packing.items.filter { $0.status == "missing" }
                                let help = snapshot.occurrences.filter { $0.status == "help" || $0.status == "handed_off" }
                                if let warning = snapshot.packing.parentWarning {
                                    Label(warning, systemImage: "exclamationmark.triangle")
                                        .accessibilityIdentifier("studentSupport.packingWarning")
                                }
                                if missing.isEmpty && help.isEmpty && snapshot.packing.parentWarning == nil { Text("No reported exceptions. This does not confirm all work is finished.") }
                                ForEach(missing) { Text("Missing: \($0.title)") }
                                ForEach(help) { Text("\($0.title): \($0.status == "help" ? "help requested" : "handed off")") }
                            }
                        } else {
                            nowCard(snapshot)
                            packing(snapshot)
                            Section("Homework") {
                                let homework = app.homework.filter { $0.kidId == selectedKid }
                                if homework.isEmpty { Text("No assignments loaded. Refresh Homework if you expected one.") }
                                ForEach(homework) { item in
                                    NavigationLink(item.title) {
                                        SupportHomeworkView(item: item, model: model)
                                    }.accessibilityIdentifier("studentSupport.homework.\(item.id)")
                                }
                            }
                            routines(snapshot)
                            Section("Focus timer • this device only") { SupportTimerView(model: model) }
                        }
                    } else {
                        Section { Text(app.isParent ? "Organizer is off. Agree a first routine with your student, then enable it in setup." : "My Next is off. Ask a parent to agree and set up your first routine with you.") }
                    }
                    Section { Text("Updated \(snapshot.refreshedAt) • \(snapshot.timezone)").font(.caption).foregroundStyle(.secondary) }
                } else if model.busy { ProgressView("Loading organizer") }
                else { ContentUnavailableView("Organizer unavailable", systemImage: "wifi.exclamationmark", description: Text("Check your connection and try again. Your other family screens remain available.")) }
                Button("Refresh") { Task { await model.refresh() } }.disabled(model.busy || model.conflict)
            }
            .navigationTitle(app.isParent ? "Student organizer" : "My Next")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
            .sheet(isPresented: $showSetup) { if let snapshot = model.snapshot { SupportSetupView(snapshot: snapshot, model: model) } }
            .confirmationDialog("Discard all pending changes for this student?", isPresented: $discard) {
                Button("Discard and reload", role: .destructive) { Task { await model.discardAndReload() } }
            }
            .task {
                let recovered = model.recoverableKidID(userID: app.me?.id ?? "", familyID: app.family?.id ?? "")
                selectedKid = app.me?.kidId ?? kids.first(where: { $0.id == recovered })?.id ?? kids.first?.id ?? ""
                await load()
            }
            .onChange(of: selectedKid) { _, _ in Task { await load() } }
        }
    }
    private func load() async {
        guard let user = app.me, let family = app.family, !selectedKid.isEmpty, !app.needsAuth else { return }
        model.select(SupportScope(userID: user.id, familyID: family.id, kidID: selectedKid))
        await model.refresh()
    }
    @ViewBuilder private func packing(_ snapshot: StudentSupportSnapshot) -> some View {
        Section("Pack • \(snapshot.packing.date ?? "date unconfirmed")") {
            Text(snapshot.packing.message ?? "Coverage: \(snapshot.packing.coverage)")
            if let updated = snapshot.packing.sourceUpdatedAt { Text("School source updated: \(updated)").font(.caption) }
            if snapshot.packing.items.isEmpty { Text("No confirmed list. Check your school timetable or ask a parent; this is not an all-clear.") }
            ForEach(["evening", "morning"], id: \.self) { phase in
                Text(phase == "evening" ? "Evening pass" : "Morning pass").font(.headline)
                ForEach(snapshot.packing.items.filter { $0.phase == phase }) { item in
                    VStack(alignment: .leading) {
                        Text(item.title).font(.headline)
                        Text(item.reasons.joined(separator: ", ")).font(.caption)
                        Menu("Status: \(item.status.replacingOccurrences(of: "_", with: " "))") {
                            ForEach(["needed", "packed", "morning", "at_school", "missing"], id: \.self) { status in
                                Button(status.replacingOccurrences(of: "_", with: " ")) {
                                    Task { await model.send("packing_item", ["date": snapshot.packing.date ?? "", "itemId": item.id, "status": status]) }
                                }
                            }
                        }.disabled(model.conflict).accessibilityIdentifier("studentSupport.pack.\(item.id)")
                    }.padding(.vertical, 4)
                }
            }
            Text(snapshot.packing.complete ? "All listed items accounted for. Check any school changes too." : "There are still items to check. Missing items stay visible to your parents.")
        }
    }
    @ViewBuilder private func routines(_ snapshot: StudentSupportSnapshot) -> some View {
        Section("Routines") {
            if snapshot.occurrences.isEmpty { Text("No agreed routine due in this window.") }
            ForEach(snapshot.occurrences.filter { $0.date == snapshot.today }) { occurrence in
                VStack(alignment: .leading, spacing: 10) {
                    Text(occurrence.title).font(.headline)
                    Text("\(occurrence.date) • \(occurrence.time) • \(occurrence.status)")
                    ForEach(occurrence.steps) { step in
                        Button { Task { await model.send("routine_step", ["occurrenceId": occurrence.id, "stepId": step.id, "done": !step.done]) } } label: {
                            Label(step.title, systemImage: step.done ? "checkmark.circle.fill" : "circle")
                        }
                    }
                    Menu("Choose outcome") {
                        ForEach(["open", "done", "skipped", "handed_off"], id: \.self) { status in
                            Button(status.replacingOccurrences(of: "_", with: " ")) { Task { await model.send("routine_status", ["occurrenceId": occurrence.id, "status": status]) } }
                        }
                        Button("Snooze 15 minutes") { Task { await model.send("routine_status", ["occurrenceId": occurrence.id, "status": "snoozed", "snoozedUntil": ISO8601DateFormatter().string(from: Date().addingTimeInterval(900))]) } }
                    }
                    NavigationLink("Ask a parent for help") {
                        List {
                            Text("Your authorized parents will see: “Help requested with \(occurrence.title)”. This is a routine exception; it is not sent to family chat.")
                            Button("Send help request") { Task { await model.send("routine_status", ["occurrenceId": occurrence.id, "status": "help"]) } }.disabled(model.conflict)
                        }.navigationTitle("Preview help request")
                    }
                }.disabled(model.conflict).padding(.vertical, 6)
            }
            DisclosureGroup("Upcoming routines") {
                ForEach(snapshot.occurrences.filter { $0.date > snapshot.today }) { occurrence in
                    Text("\(occurrence.title) • \(occurrence.date) at \(occurrence.time)")
                }
            }
        }
    }
    @ViewBuilder private func nowCard(_ snapshot: StudentSupportSnapshot) -> some View {
        Section("Now • one small next step") {
            let selection = SupportNowChoice.choose(snapshot: snapshot, homework: app.homework, now: Date())
            switch selection {
            case .routine(let occurrence):
                Text(occurrence.title).font(.headline)
                Text("This agreed routine is due now in your family timezone.")
                NavigationLink("Open this routine") {
                    List { routines(snapshotForRoutine(model.snapshot ?? snapshot, occurrence)) }.navigationTitle(occurrence.title)
                }.accessibilityIdentifier("studentSupport.nowAction")
            case .homework(let item, let reason):
                Text(item.title).font(.headline)
                Text(reason)
                if let plan = snapshot.homeworkPlans.first(where: { $0.homeworkId == item.id }), !plan.nextStep.isEmpty { Text(plan.nextStep) }
                NavigationLink("Open this homework step") { SupportHomeworkView(item: item, model: model) }
                    .accessibilityIdentifier("studentSupport.nowAction")
            case .none:
                Text("No next task is confirmed. Choose homework below, check packing, or agree a routine.")
            }
            NavigationLink("Choose another homework task") {
                List {
                    ForEach(app.homework.filter { $0.kidId == snapshot.kidId && !$0.isDone }) { item in
                        NavigationLink(item.title) { SupportHomeworkView(item: item, model: model) }
                    }
                }.navigationTitle("Choose a task")
            }.accessibilityIdentifier("studentSupport.chooseAnother")
        }
    }
    private func snapshotForRoutine(_ snapshot: StudentSupportSnapshot, _ occurrence: SupportOccurrence) -> StudentSupportSnapshot {
        var copy = snapshot; copy.occurrences = snapshot.occurrences.filter { $0.id == occurrence.id }; return copy
    }
}

private struct SupportHomeworkView: View {
    let item: HomeworkItem
    @Bindable var model: StudentSupportStore
    @State private var nextStep = ""
    @State private var plannedDate = ""
    private var plan: SupportHomeworkPlan? { model.snapshot?.homeworkPlans.first { $0.homeworkId == item.id } }
    var body: some View {
        List {
            Section("School assignment") {
                Text(item.title); Text("Due \(item.dueDate)\(item.dueTime.map { " at \($0)" } ?? " • date only")")
                if let notes = item.notes { Text(notes) }
                Text("School status: \(item.status). Organizer reports below do not change school status or rewards.").font(.caption)
            }
            Section("My plan") {
                TextField("One small next step", text: $nextStep, axis: .vertical).accessibilityIdentifier("studentSupport.nextStep")
                TextField("Work date (YYYY-MM-DD, optional)", text: $plannedDate)
                Button("Save my plan") { send(["nextStep": nextStep, "plannedDate": plannedDate.isEmpty ? NSNull() : plannedDate as Any]) }.accessibilityIdentifier("studentSupport.homeworkSave")
                Button(plan?.workFinished == true ? "Reopen work" : "My work is finished") { send(["workFinished": !(plan?.workFinished ?? false)]) }
                Text(plan?.workFinished == true ? "Work finished • hand-in is separate" : "Work not yet reported finished")
            }
            Section("Hand-in • self-reported") {
                Menu("Method: \(plan?.handInMethod ?? "unknown")") {
                    ForEach(["unknown", "portal", "teacher", "pack", "none"], id: \.self) { method in Button(method) { send(["handInMethod": method]) } }
                }
                Text("Hand-in: \(plan?.submission ?? "unknown")")
                Button("I handed it in (self-report)") { send(["submission": "reported"]) }.accessibilityIdentifier("studentSupport.handIn")
                Button("Still need to hand in") { send(["submission": "pending"]) }
            }
            if let message = model.message { Text(message) }
            if !model.pending.isEmpty { Text("\(model.pending.count) changes pending sync") }
        }.disabled(model.conflict).navigationTitle("Homework steps")
            .onAppear { nextStep = plan?.nextStep ?? ""; plannedDate = plan?.plannedDate ?? "" }
    }
    private func send(_ values: [String: Any]) { var payload = values; payload["homeworkId"] = item.id; Task { await model.send("homework_plan", payload) } }
}

private struct SupportTimerView: View {
    @Bindable var model: StudentSupportStore
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = model.timer.seconds(at: context.date)
            Text("\(seconds / 60):\(String(format: "%02d", seconds % 60))").font(.largeTitle.monospacedDigit()).accessibilityLabel("\(seconds / 60) minutes, \(seconds % 60) seconds remaining")
            Menu("Choose interval / restart") {
                ForEach([0, 5, 10, 15, 20], id: \.self) { minutes in
                    Button(minutes == 0 ? "No timer" : "\(minutes) minutes") { model.timer = SupportTimer(remaining: Double(minutes * 60)); model.saveTimer() }
                }
            }
            Button(model.timer.endsAt == nil ? "Start / resume" : "Pause") {
                if model.timer.endsAt == nil { model.timer.resume(at: .now) } else { model.timer.pause(at: .now) }
                model.saveTimer()
            }.disabled(seconds == 0)
            Button("End timer") { model.timer = SupportTimer(remaining: 0); model.saveTimer() }
            Text("A timer does not mark work done. No focus history is shared.").font(.caption)
        }
    }
}
