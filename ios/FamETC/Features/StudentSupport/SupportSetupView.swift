import SwiftUI

struct SupportSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @State var snapshot: StudentSupportSnapshot
    @Bindable var model: StudentSupportStore
    @State private var saving = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Agree together") {
                    Text("Choose useful routines with your student. Start small. No diagnosis, rewards or Screen Time restrictions are required.")
                    Toggle("Enable My Next", isOn: $snapshot.enabled).accessibilityIdentifier("studentSupport.enable")
                }
                Section("Preferences • \(snapshot.timezone)") {
                    TextField("Quiet start HH:mm", text: $snapshot.preferences.quietStart)
                    TextField("Quiet end HH:mm", text: $snapshot.preferences.quietEnd)
                    TextField("Homework HH:mm", text: $snapshot.preferences.homeworkTime)
                    TextField("Evening packing HH:mm", text: $snapshot.preferences.packingTime)
                    TextField("Morning packing HH:mm", text: $snapshot.preferences.morningTime)
                    Picker("Focus minutes", selection: $snapshot.preferences.focusMinutes) {
                        ForEach([5, 10, 15, 20], id: \.self) { Text("\($0)").tag($0) }
                    }
                    Text("These are agreed cue windows. This iPad does not schedule notifications; the timer is local to this device.").font(.caption)
                }
                Section("Materials") {
                    ForEach($snapshot.materialRules) { $rule in
                        NavigationLink(rule.title.isEmpty ? "New material" : rule.title) {
                            Form {
                                TextField("Item name", text: $rule.title).accessibilityIdentifier("studentSupport.ruleTitle")
                                Picker("Needed for", selection: $rule.matchKind) {
                                    Text("Every school day").tag("everyday"); Text("Subject").tag("subject")
                                    Text("Activity").tag("activity"); Text("Specific date").tag("date")
                                }
                                if rule.matchKind != "everyday" { TextField(rule.matchKind == "date" ? "YYYY-MM-DD" : "Match name", text: $rule.matchValue) }
                                Picker("Pack when", selection: $rule.phase) { Text("Evening").tag("evening"); Text("Morning").tag("morning") }
                                Picker("Usually kept", selection: $rule.location) { Text("Home").tag("home"); Text("School").tag("school") }
                                Text("School location is a reminder. The student still explicitly accounts for the item.")
                            }.navigationTitle("Material rule")
                        }
                    }.onDelete { snapshot.materialRules.remove(atOffsets: $0) }
                    Button("Add material") {
                        snapshot.materialRules.append(SupportMaterialRule(id: UUID().uuidString, title: "", matchKind: "everyday", matchValue: "", phase: "evening", location: "home"))
                    }.disabled(snapshot.materialRules.count >= 60).accessibilityIdentifier("studentSupport.addMaterial")
                }
                Section("Recurring routines") {
                    ForEach($snapshot.routines) { $routine in
                        NavigationLink(routine.title.isEmpty ? "New routine" : routine.title) {
                            Form {
                                TextField("Routine name", text: $routine.title).accessibilityIdentifier("studentSupport.routineTitle")
                                Toggle("Active", isOn: $routine.active)
                                TextField("Time HH:mm", text: $routine.time).accessibilityIdentifier("studentSupport.routineTime")
                                ForEach(1...7, id: \.self) { day in
                                    Toggle(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1], isOn: Binding(get: { routine.weekdays.contains(day) }, set: { value in
                                        routine.weekdays.removeAll { $0 == day }; if value { routine.weekdays.append(day) }; routine.weekdays.sort()
                                    }))
                                }
                                Section("Small steps") {
                                    ForEach($routine.steps) { $step in TextField("Step", text: $step.title) }
                                        .onDelete { routine.steps.remove(atOffsets: $0) }
                                    Button("Add step") { routine.steps.append(SupportRoutineStep(id: UUID().uuidString, title: "")) }.disabled(routine.steps.count >= 15)
                                }
                            }.navigationTitle("Routine")
                        }
                    }.onDelete { snapshot.routines.remove(atOffsets: $0) }
                    Button("Add routine") { snapshot.routines.append(SupportRoutine(id: UUID().uuidString, title: "", weekdays: [1, 2, 3, 4, 5], time: "17:00", steps: [], active: true)) }
                        .disabled(snapshot.routines.count >= 20).accessibilityIdentifier("studentSupport.addRoutine")
                }
                if let message = model.message { Section { Text(message) } }
                Section {
                    Button("Save agreed setup") {
                        guard model.snapshot?.revision == snapshot.revision else {
                            model.message = "The plan changed while setup was open. Close and reopen setup to review it before saving."
                            return
                        }
                        saving = true
                        Task {
                            do {
                                let data = try JSONEncoder().encode(snapshot)
                                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
                                let payload = object.filter { ["enabled", "preferences", "materialRules", "routines"].contains($0.key) }
                                await model.send("configure", payload)
                                if model.pending.isEmpty && model.message == nil { dismiss() }
                            } catch { model.message = error.localizedDescription }
                            saving = false
                        }
                    }.disabled(saving || model.conflict || !model.pending.isEmpty).accessibilityIdentifier("studentSupport.setupSave")
                    if !model.pending.isEmpty { Text("Setup saved locally, waiting for sync. Close to retry or discard from the organizer.") }
                }
            }.navigationTitle("Student setup")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
