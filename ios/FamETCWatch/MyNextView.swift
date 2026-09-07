import SwiftUI
import WatchKit

private let watchAccent = Color(red: 185 / 255, green: 140 / 255, blue: 1)
private let watchCoral = Color(red: 240 / 255, green: 112 / 255, blue: 79 / 255)

struct MyNextView: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var completedAction: String?
    var onDisconnect: () -> Void = {}

    var body: some View {
        NavigationStack {
            TabView {
                nowPage
                    .tag(0)
                dayPage
                    .tag(1)
                morePage
                    .tag(2)
            }
            .tabViewStyle(.verticalPage)
            .navigationTitle("Fam ETC")
            .fontDesign(.rounded)
            .tint(watchAccent)
        }
    }

    private var nowPage: some View {
        ScrollView {
            TimelineView(.periodic(from: Date(), by: 60)) { clock in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        WatchIdentity(profile: store.snapshot.context?.profile)
                        Text(store.snapshot.isParent ? "Family next" : greeting)
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let session = store.focusSession {
                        FocusSessionCard(session: session)
                    } else if let moment = store.snapshot.moments(at: clock.date).first {
                        momentGlance(moment, at: clock.date)
                    } else if store.connection == .refreshing {
                        ProgressView("Finding your next thing…")
                    } else {
                        Image(systemName: "sun.max.fill")
                            .font(.largeTitle)
                            .foregroundStyle(watchCoral)
                            .accessibilityHidden(true)
                        Text(store.snapshot.updatedAt == nil ? "Your day is on its way" : "Room to breathe")
                            .font(.title3.bold())
                        Text(store.snapshot.updatedAt == nil ? "Refresh to load your schedule and work." : "Nothing needs your attention right now. Enjoy the pause.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                    completionAcknowledgment
                    if store.reminderStatus == "Turn on gentle reminders" || store.reminderStatus == "Enable reminders to get a nudge" {
                        Button("Turn on reminders", systemImage: "bell.badge") {
                            Task { await store.enableReminders() }
                        }
                        .buttonStyle(.bordered)
                    }
                    NavigationLink {
                        WatchConnectionView(onDisconnect: onDisconnect)
                    } label: {
                        Label(connectionSummary, systemImage: store.connection == .offline || store.connection == .disconnected ? "wifi.slash" : "arrow.triangle.2.circlepath")
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.bottom, 20)
            }
        }
        .refreshable { await store.refresh() }
        .accessibilityLabel("Now")
    }

    @ViewBuilder private var completionAcknowledgment: some View {
        if let completedAction {
            Label("Saved on watch: \(completedAction)", systemImage: "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(watchAccent)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
                .task(id: completedAction) {
                    do { try await Task.sleep(for: .seconds(4)) } catch { return }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { self.completedAction = nil }
                }
        }
    }

    private func completeAction(_ action: WatchAction) async {
        await store.completeAction(action)
        guard store.snapshot.actions.first(where: { $0.id == action.id })?.isDone == true else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { completedAction = action.title }
        WKInterfaceDevice.current().play(.success)
    }

    private var greeting: String {
        guard let name = store.snapshot.context?.profile.name.split(separator: " ").first else { return "Your next thing" }
        return "Hey, \(name)"
    }

    private var connectionSummary: String {
        if store.pendingMutationCount > 0 { return "\(store.pendingMutationCount) changes waiting to sync" }
        if store.lastError != nil { return "Sync needs attention" }
        return store.connection.label
    }

    @ViewBuilder private func momentGlance(_ moment: WatchMoment, at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: moment.symbol)
                .font(.largeTitle)
                .foregroundStyle(watchCoral)
                .accessibilityHidden(true)
            Text(moment.title)
                .font(.title3.bold())
                .fixedSize(horizontal: false, vertical: true)
            Text(moment.caption(at: now))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(watchAccent)
            if !moment.detail.isEmpty {
                Text(moment.detail)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch moment {
            case .homework(let item):
                NavigationLink("Open assignment") { HomeworkDetailView(item: item) }
                    .buttonStyle(.borderedProminent)
            case .action(let action):
                Button("Mark done", systemImage: "checkmark") {
                    Task { await completeAction(action) }
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Mark \(action.title) done")
            case .event(let event):
                NavigationLink("See details") { WatchEventDetail(event: event) }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private var dayPage: some View {
        List {
            Text("Your day").font(.title3.bold())
            TimelineView(.periodic(from: Date(), by: 60)) { clock in
                let events = store.snapshot.dayEvents(at: clock.date)
                if events.isEmpty {
                    EmptyWatchRow(text: "No calendar events today. Your work is in More.")
                } else {
                    ForEach(events) { event in
                        NavigationLink { WatchEventDetail(event: event) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(event.allDay ? "All day" : event.startsAt?.formatted(date: .omitted, time: .shortened) ?? "Time unavailable")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(watchAccent)
                                Text(event.title).fixedSize(horizontal: false, vertical: true)
                                if WatchMoment.event(event).isHappening(at: clock.date) {
                                    Text("Happening now").font(.caption).foregroundStyle(watchCoral)
                                }
                            }
                        }
                    }
                }
            }
        }
        .accessibilityLabel("Day")
    }

    private var morePage: some View {
        List {
            Text("More").font(.title3.bold())
            NavigationLink {
                List {
                    if store.openHomework.isEmpty { EmptyWatchRow(text: "All caught up. Nice work!") }
                    ForEach(store.openHomework) { item in
                        NavigationLink { HomeworkDetailView(item: item) } label: { HomeworkRow(item: item) }
                    }
                }.navigationTitle("School work")
            } label: { Label("School work · \(store.openHomework.count)", systemImage: "book.closed") }
            NavigationLink {
                List {
                    completionAcknowledgment
                    if importantActions.isEmpty { EmptyWatchRow(text: "Nothing waiting here") }
                    ForEach(importantActions) { action in
                        ActionRow(action: action) { Task { await completeAction(action) } }
                    }
                }.navigationTitle("To do")
            } label: { Label("To do · \(importantActions.count)", systemImage: "checklist") }
            if store.snapshot.isParent {
                NavigationLink {
                    List {
                        if store.openShopping.isEmpty { EmptyWatchRow(text: "Shopping is caught up") }
                        ForEach(store.openShopping) { item in
                            ShoppingRow(item: item) { Task { await store.toggleShopping(item) } }
                        }
                    }.navigationTitle("Shopping")
                } label: { Label("Shopping · \(store.openShopping.count)", systemImage: "cart") }
            }
            NavigationLink { WatchConnectionView(onDisconnect: onDisconnect) } label: {
                Label("Settings & sync", systemImage: "gearshape")
            }
        }
        .accessibilityLabel("More")
    }

    private var importantActions: [WatchAction] {
        store.urgentActions.filter { action in
            !(action.sourceType == "homework" && store.openHomework.contains { $0.id == action.sourceId })
        }
    }
}

private struct WatchIdentity: View {
    let profile: WatchProfile?

    private var color: Color {
        guard let value = profile?.color, value.count == 7, value.hasPrefix("#"),
              let hex = UInt32(value.dropFirst(), radix: 16) else { return watchAccent }
        return Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }

    private var photo: UIImage? {
        guard let value = profile?.photo, value.hasPrefix("data:image/jpeg;base64,"), value.count <= 200_000,
              let data = Data(base64Encoded: String(value.dropFirst("data:image/jpeg;base64,".count))) else { return nil }
        return UIImage(data: data)
    }

    var body: some View {
        Group {
            if let photo { Image(uiImage: photo).resizable().scaledToFill() }
            else {
                Text(String(profile?.name.prefix(1) ?? "F").uppercased())
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.6))
            }
        }
        .frame(width: 34, height: 34)
        .background(color)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(color, lineWidth: 2))
        .accessibilityHidden(true)
    }
}

private struct WatchEventDetail: View {
    let event: WatchEvent
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: event.isTimetable ? "backpack.fill" : "calendar")
                    .font(.largeTitle).foregroundStyle(watchCoral).accessibilityHidden(true)
                Text(event.title).font(.title3.bold())
                if let start = event.startsAt {
                    Text(start.formatted(date: .abbreviated, time: event.allDay ? .omitted : .shortened))
                    if event.allDay { Text("All day").foregroundStyle(.secondary) }
                    else { Text("Until \(event.endsAt.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary) }
                }
                if let location = event.location, !location.isEmpty { Label(location, systemImage: "mappin") }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }.navigationTitle("On your calendar")
    }
}

private struct WatchConnectionView: View {
    @EnvironmentObject private var store: WatchStore
    @State private var confirmDisconnect = false
    let onDisconnect: () -> Void

    var body: some View {
        List {
            Section("Sync") {
                Text(store.connection.label)
                if let error = store.lastError { Text(error).font(.footnote).foregroundStyle(.secondary) }
                if store.pendingMutationCount > 0 {
                    Text("\(store.pendingMutationCount) saved changes are waiting to sync. Refresh when connected.")
                        .font(.footnote)
                }
                if let updated = store.snapshot.updatedAt {
                    Text("Last updated \(updated.formatted(date: .abbreviated, time: .shortened))").font(.footnote)
                }
                Button("Refresh now", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
                    .disabled(store.connection == .refreshing)
            }
            Section("Reminders") {
                Text(store.reminderStatus).font(.footnote)
                Button("Enable reminders", systemImage: "bell.badge") { Task { await store.enableReminders() } }
            }
            Section {
                Button("Disconnect watch", role: .destructive) { confirmDisconnect = true }
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog("Disconnect this watch?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive, action: onDisconnect)
        } message: {
            Text(store.pendingMutationCount > 0
                 ? "You have \(store.pendingMutationCount) unsynced changes. Disconnecting removes saved data and these changes from this watch."
                 : "Saved data will be removed from this watch. You can connect again from setup.")
        }
    }
}

private struct HomeworkDetailView: View {
    @EnvironmentObject private var store: WatchStore
    let item: WatchHomework

    private var currentItem: WatchHomework {
        store.snapshot.homework.first(where: { $0.id == item.id }) ?? item
    }

    private var isFocused: Bool {
        store.focusSession?.homeworkID == currentItem.id
    }

    private var anotherFocusIsActive: Bool {
        store.focusSession != nil && !isFocused
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(currentItem.title)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                Text(homeworkContext(currentItem))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Assignment context")
                    .accessibilityValue(homeworkContext(currentItem))

                if currentItem.checklist.isEmpty {
                    Text("There are no steps listed yet. Open the assignment and spend 20 minutes on the first move.")
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Checklist progress")
                            .font(.subheadline.weight(.semibold))
                        Text("\(currentItem.completedChecklistCount) of \(currentItem.checklist.count) steps complete")
                            .font(.body)
                            .accessibilityLabel("Checklist progress")
                            .accessibilityValue("\(currentItem.completedChecklistCount) of \(currentItem.checklist.count) steps complete")

                        if let step = currentItem.firstIncompleteChecklistItem {
                            Text("Next step")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .padding(.top, 4)
                            Text(step.text)
                                .font(.body)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityLabel("Next step")
                                .accessibilityValue(step.text)
                        } else {
                            Text("All listed steps are done. You can finish the assignment when it is ready.")
                                .font(.body)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !currentItem.checklist.isEmpty {
                    ForEach(currentItem.checklist.indices, id: \.self) { index in
                        let step = currentItem.checklist[index]
                        Button {
                            Task { await store.markHomeworkStepDone(currentItem, index: index) }
                        } label: {
                            Label(step.text, systemImage: step.done ? "checkmark.circle.fill" : "circle")
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .disabled(step.done || currentItem.isDone)
                        .accessibilityLabel("\(step.text), \(step.done ? "complete" : "mark step done")")
                    }
                }

                if currentItem.isDone {
                    Label("Assignment complete", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(watchAccent)
                } else if isFocused {
                    Text("Focus is in progress")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tint)
                        .accessibilityAddTraits(.isHeader)
                } else if anotherFocusIsActive {
                    Text("Finish your current focus before starting another.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Another focus is in progress")
                        .accessibilityHint("End the current focus before starting this assignment.")
                } else {
                    Button("Start 20 min") {
                        Task {
                            await store.startFocus(
                                on: currentItem,
                                checklistIndex: currentItem.firstIncompleteChecklistIndex
                            )
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("Start 20 minute focus")
                    .accessibilityHint("Starts a focus block for this assignment.")
                }

                Button("Finish assignment") {
                    Task { await store.finishAssignment(currentItem) }
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
                .disabled(currentItem.isDone)
                .accessibilityLabel("Finish assignment")
                .accessibilityHint("Marks this assignment done. It will not finish automatically.")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .navigationTitle("Assignment")
    }
}

private struct FocusSessionCard: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var celebration = false
    let session: WatchFocusSession

    private var currentStep: WatchChecklistItem? {
        guard let index = session.checklistIndex,
              let homework = store.snapshot.homework.first(where: { $0.id == session.homeworkID }),
              homework.checklist.indices.contains(index) else {
            return nil
        }
        return homework.checklist[index]
    }

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let complete = session.isComplete(at: context.date)
            VStack(alignment: .leading, spacing: 9) {
                Text(session.titleSnapshot.isEmpty ? "Your focus block" : session.titleSnapshot)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                if let currentStep {
                    Text(currentStep.text)
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Focus step")
                        .accessibilityValue(currentStep.text)
                } else {
                    Text("Open the assignment and spend 20 minutes on the first move.")
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if complete {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title2).foregroundStyle(watchCoral)
                        .symbolEffect(.bounce, value: celebration)
                        .accessibilityHidden(true)
                    Text("Nice focus! Ready for the next step?")
                        .font(.subheadline.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(timerInterval: session.startedAt...session.endsAt, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .accessibilityLabel("Focus time remaining")
                        .accessibilityValue(timerAccessibilityValue(session, at: context.date))
                }

                if currentStep != nil {
                    Button("Step done") {
                        Task { await store.markSelectedStepDone() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(currentStep?.done ?? false)
                    .accessibilityLabel("Step done")
                    .accessibilityHint(currentStep?.done == true ? "This step is already marked done." : "Marks the selected step done and saves it for sync.")
                }

                if let homework = store.snapshot.homework.first(where: { $0.id == session.homeworkID }) {
                    Button("Finish assignment") { Task { await store.finishAssignment(homework) } }
                        .buttonStyle(.bordered)
                        .accessibilityHint("Marks the assignment done only when you choose.")
                }

                Button("End focus") {
                    store.endFocus()
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("End focus")
                .accessibilityHint("Ends this focus block without changing assignment status.")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .onAppear {
                acknowledgeCompletionIfNeeded(at: context.date)
            }
            .onChange(of: complete) { _, didComplete in
                if didComplete {
                    acknowledgeCompletionIfNeeded(at: context.date)
                }
            }
        }
    }

    private func acknowledgeCompletionIfNeeded(at date: Date) {
        guard store.acknowledgeFocusCompletion(at: date) else { return }
        if !reduceMotion { celebration.toggle() }
        WKInterfaceDevice.current().play(.success)
    }
}

private struct EmptyWatchRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 5)
    }
}

private struct ActionRow: View {
    let action: WatchAction
    let complete: () -> Void

    var body: some View {
        Button(action: complete) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "circle")
                    .foregroundStyle(watchAccent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(action.title)
                        .font(.body.weight(.medium))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let due = dueText(date: action.dueDate, time: action.dueTime) {
                        Text(due)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Complete \(action.title)")
        .accessibilityValue(dueText(date: action.dueDate, time: action.dueTime) ?? "No due date")
        .accessibilityHint("Marks this important action done.")
    }
}

private struct HomeworkRow: View {
    let item: WatchHomework

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "book.closed")
                .foregroundStyle(watchAccent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.body.weight(.medium))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(homeworkContext(item))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

private struct ShoppingRow: View {
    let item: WatchShoppingItem
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "circle")
                    .foregroundStyle(watchAccent)
                    .accessibilityHidden(true)
                Text(item.text)
                    .font(.body.weight(.medium))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mark \(item.text) bought")
        .accessibilityHint("Marks this item bought.")
    }
}

private func homeworkContext(_ item: WatchHomework) -> String {
    var values: [String] = []
    if let subject = item.subject, !subject.isEmpty {
        values.append(subject)
    }
    if let due = dueText(date: item.dueDate, time: item.dueTime) {
        values.append(due)
    }
    return values.joined(separator: " · ")
}

private func timerAccessibilityValue(_ session: WatchFocusSession, at date: Date) -> String {
    let remaining = Int(ceil(session.remaining(at: date)))
    let minutes = remaining / 60
    let seconds = remaining % 60
    return minutes > 0 ? "\(minutes) minutes \(seconds) seconds" : "\(seconds) seconds"
}

private func dueText(date: String?, time: String?) -> String? {
    guard let date, !date.isEmpty else { return nil }
    if let time, !time.isEmpty { return "Due \(date) at \(time)" }
    return "Due \(date)"
}
