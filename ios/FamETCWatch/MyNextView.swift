import SwiftUI
import WatchKit

struct MyNextView: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header

                    if store.connection == .disconnected || store.connection == .offline {
                        connectionBanner
                    }

                    if let focusSession = store.focusSession {
                        WatchSection(title: "Focus", systemImage: "timer") {
                            FocusSessionCard(session: focusSession)
                        }
                    }

                    focusHomeworkSection
                    schoolSection
                    shoppingSection
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            .navigationTitle("My next")
            .refreshable {
                await store.refresh()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("My next")
                .font(.headline)
            Text(store.connection.label)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Connection")
                .accessibilityValue(store.connection.label)
        }
    }

    private var connectionBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: store.connection == .disconnected ? "wifi.slash" : "arrow.triangle.2.circlepath")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(store.connection == .disconnected ? "Not connected" : "Working offline")
                    .font(.subheadline.weight(.semibold))
                Text(store.lastError ?? "Your saved work stays available on this watch.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(9)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(store.connection == .disconnected ? "Not connected" : "Working offline")
        .accessibilityValue(store.lastError ?? "Saved changes stay available on this watch.")
    }

    private var focusHomeworkSection: some View {
        WatchSection(title: "Focus next", systemImage: "arrow.right.circle.fill") {
            if let item = store.focusHomework {
                NavigationLink {
                    HomeworkDetailView(item: item)
                } label: {
                    HomeworkHero(item: item)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Focus next: (item.title)")
                .accessibilityValue(homeworkAccessibilityValue(item))
                .accessibilityHint("Opens the assignment and its next step.")
            } else if store.connection == .refreshing && store.snapshot.updatedAt == nil {
                EmptyWatchRow(text: "Checking your work…")
            } else {
                EmptyWatchRow(text: "Homework is caught up")
            }
        }
    }

    private var schoolSection: some View {
        let actions = importantActions
        let remainingHomework = Array(store.openHomework.dropFirst())

        return WatchSection(title: "School & important", systemImage: "book.closed.fill") {
            if actions.isEmpty && remainingHomework.isEmpty {
                EmptyWatchRow(text: "Nothing else needs your attention")
            } else {
                if !actions.isEmpty {
                    ForEach(actions) { action in
                        ActionRow(action: action) {
                            Task { await store.completeAction(action) }
                        }
                    }
                }
                if !remainingHomework.isEmpty {
                    Text("More school work")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, actions.isEmpty ? 0 : 5)
                    ForEach(remainingHomework) { item in
                        NavigationLink {
                            HomeworkDetailView(item: item)
                        } label: {
                            HomeworkRow(item: item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title)
                        .accessibilityValue(homeworkAccessibilityValue(item))
                        .accessibilityHint("Opens the assignment details.")
                    }
                }
            }
        }
    }

    private var importantActions: [WatchAction] {
        store.urgentActions.filter { action in
            guard action.sourceType == "homework", let sourceID = action.sourceId else { return true }
            // A homework-derived action is already represented by the hero or
            // the secondary homework list. Keep it out of the important queue.
            return !store.openHomework.contains { $0.id == sourceID }
        }
    }

    private var shoppingSection: some View {
        WatchSection(title: "Shopping", systemImage: "cart.fill") {
            if store.openShopping.isEmpty {
                EmptyWatchRow(text: "Shopping is caught up")
            } else {
                ForEach(store.openShopping) { item in
                    ShoppingRow(item: item) {
                        Task { await store.toggleShopping(item) }
                    }
                }
            }
        }
    }
}

private struct HomeworkHero: View {
    let item: WatchHomework

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.title)
                .font(.headline)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)

            Text(homeworkContext(item))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if item.checklist.isEmpty {
                Text("No steps yet. Start with 20 minutes on the assignment.")
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("(item.completedChecklistCount) of (item.checklist.count) steps complete")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityLabel("Checklist progress")
                    .accessibilityValue("(item.completedChecklistCount) of (item.checklist.count) steps complete")

                if let step = item.firstIncompleteChecklistItem {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Next step")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(step.text)
                            .font(.body)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    Text("All listed steps are done. Choose when to finish the assignment.")
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 5) {
                Text("Open assignment")
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.tint)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
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
                        Text("(currentItem.completedChecklistCount) of (currentItem.checklist.count) steps complete")
                            .font(.body)
                            .accessibilityLabel("Checklist progress")
                            .accessibilityValue("(currentItem.completedChecklistCount) of (currentItem.checklist.count) steps complete")

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

                if isFocused {
                    Text("Focus is in progress")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.tint)
                        .accessibilityAddTraits(.isHeader)
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
                    Text("Nice work — pick up here when you’re ready.")
                        .font(.subheadline.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(timerInterval: session.startedAt...session.endsAt, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .accessibilityLabel("Focus time remaining")
                        .accessibilityValue(timerAccessibilityValue(session, at: context.date))
                }

                if session.checklistIndex != nil {
                    Button("Step done") {
                        Task { await store.markSelectedStepDone() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(currentStep?.done ?? false)
                    .accessibilityLabel("Step done")
                    .accessibilityHint(currentStep?.done == true ? "This step is already marked done." : "Marks the selected step done and saves it for sync.")
                }

                Button("End focus") {
                    store.endFocus()
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("End focus")
                .accessibilityHint("Ends this focus block without changing assignment status.")
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
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
        WKInterfaceDevice.current().play(.success)
    }
}

private struct WatchSection<Content: View>: View {
    let title: String
    let systemImage: String
    let content: () -> Content

    init(title: String,
         systemImage: String,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            VStack(spacing: 5) {
                content()
            }
        }
        .accessibilityElement(children: .contain)
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
                    .foregroundStyle(.orange)
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
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Complete (action.title)")
        .accessibilityValue(dueText(date: action.dueDate, time: action.dueTime) ?? "No due date")
        .accessibilityHint("Marks this important action done.")
    }
}

private struct HomeworkRow: View {
    let item: WatchHomework

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "book.closed")
                .foregroundStyle(.blue)
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
                    .foregroundStyle(.green)
                    .accessibilityHidden(true)
                Text(item.text)
                    .font(.body.weight(.medium))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mark (item.text) bought")
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

private func homeworkAccessibilityValue(_ item: WatchHomework) -> String {
    var values = [homeworkContext(item)]
    if item.checklist.isEmpty {
        values.append("No steps listed")
    } else if let step = item.firstIncompleteChecklistItem {
        values.append("(item.completedChecklistCount) of (item.checklist.count) steps complete")
        values.append("Next step: (step.text)")
    } else {
        values.append("All (item.checklist.count) steps complete")
    }
    return values.filter { !$0.isEmpty }.joined(separator: ". ")
}

private func timerAccessibilityValue(_ session: WatchFocusSession, at date: Date) -> String {
    let remaining = Int(ceil(session.remaining(at: date)))
    let minutes = remaining / 60
    let seconds = remaining % 60
    return minutes > 0 ? "(minutes) minutes (seconds) seconds" : "(seconds) seconds"
}

private func dueText(date: String?, time: String?) -> String? {
    guard let date, !date.isEmpty else { return nil }
    if let time, !time.isEmpty { return "Due (date) at (time)" }
    return "Due (date)"
}
