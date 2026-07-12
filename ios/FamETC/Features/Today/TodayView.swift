import SwiftUI

/// The home dashboard — restyled to the Horizon "Daily 5" card stack
/// (docs/design/redesign/canvas-1f parent, canvas-1g kid). Parents get
/// Today's schedule / Homework due / Daily 5; kids get a bigger, simpler
/// version of the same three plus their own homework in full.
struct TodayScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var showAddEvent = false

    private var firstName: String {
        guard let name = store.me?.name, !name.isEmpty else { return "" }
        return String(name.split(separator: " ").first ?? Substring(name))
    }
    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening")
        return firstName.isEmpty ? part : "\(part), \(firstName)"
    }
    private var dateLabel: String { Date().formatted(.dateTime.weekday(.wide).month(.wide).day()) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.lg) {
                if store.isParent {
                    ParentHeader(greeting: greeting, dateLabel: dateLabel, onAdd: { showAddEvent = true })
                    ParentTodayStack()
                } else {
                    KidHeader(dateLabel: dateLabel)
                    KidTodayStack()
                }
            }
            .padding(Space.lg)
            .padding(.bottom, hSize == .compact ? Layout.tabBarClearance : Space.xl)
            // Chat-style: tapping anywhere that isn't a field/button/card control
            // puts the keyboard away. (Controls consume their own taps first.)
            .contentShape(Rectangle())
            .onTapGesture { famDismissKeyboard() }
        }
        .background(ScreenBackground())
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await store.refreshDashboard() }
        .sheet(isPresented: $showAddEvent) { AddEventSheet() }
    }
}

// MARK: - Parent header (canvas-1f)

private struct ParentHeader: View {
    let greeting: String
    let dateLabel: String
    let onAdd: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: Space.md) {
            VStack(alignment: .leading, spacing: 3) {
                MicroLabel(text: dateLabel)
                Text(greeting).font(Typography.title).foregroundStyle(Palette.text)
            }
            Spacer(minLength: Space.sm)
            Button(action: { Haptics.impact(.light); onAdd() }) {
                Label("Add event", systemImage: "plus")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.onAccent)
                    .padding(.horizontal, Space.lg)
                    .padding(.vertical, Space.sm + 2)
                    .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
            .buttonStyle(PressableStyle())
        }
    }
}

// MARK: - Parent card stack (canvas-1f: schedule / homework due + Daily 5)

private struct ParentTodayStack: View {
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            ScheduleCard()
            if hSize == .compact {
                VStack(alignment: .leading, spacing: Space.lg) {
                    HomeworkDueCard()
                    DailyFiveCard()
                }
            } else {
                HStack(alignment: .top, spacing: Space.lg) {
                    HomeworkDueCard()
                    DailyFiveCard()
                }
            }
        }
    }
}

// MARK: - Today's schedule card

private struct ScheduleCard: View {
    @Environment(AppStore.self) private var store

    private var items: [AgendaItem] {
        Agenda.items(on: Agenda.todayKey(), events: store.events, familyEvents: store.familyEvents, homework: store.homework)
            .filter { $0.kind != .homework }
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                MicroLabel(text: "Today's schedule")
                if items.isEmpty {
                    Text("Nothing scheduled today — enjoy! 🎉")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    VStack(spacing: 0) {
                        ForEach(items) { item in
                            ScheduleRow(item: item)
                            if item.id != items.last?.id { Divider().overlay(Palette.border) }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One schedule row: mono time · kid-color bar · title · kid name (right).
private struct ScheduleRow: View {
    @Environment(AppStore.self) private var store
    let item: AgendaItem

    var body: some View {
        HStack(spacing: Space.md) {
            Text(item.time ?? "—")
                .font(Typography.mono(12.5))
                .foregroundStyle(Palette.textSecond)
                .frame(width: 50, alignment: .leading)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.accent)
                .frame(width: 3, height: 28)
            Text(item.title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .lineLimit(1)
            Spacer(minLength: Space.sm)
            if let name = Agenda.kidName(item.kidId, kids: store.kids) {
                Text(name)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.textSecond)
                    .fixedSize()
            }
        }
        .padding(.vertical, Space.sm + 2)
        .contentShape(Rectangle())
    }
}

// MARK: - Homework due card

private struct HomeworkDueCard: View {
    @Environment(AppStore.self) private var store

    private var items: [HomeworkItem] { Agenda.homeworkDueSoon(store.homework, days: 7) }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework due")
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count)").font(Typography.mono(11)).foregroundStyle(Palette.textSecond)
                    }
                }
                if items.isEmpty {
                    Text("No homework due this week 🎉")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    VStack(spacing: Space.sm + 2) {
                        ForEach(items.prefix(5)) { HomeworkDueRow(item: $0) }
                        if items.count > 5 {
                            Text("+\(items.count - 5) more")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Palette.textSecond)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A due-soon homework row with a tappable done checkbox — same toggle as
/// AgendaRow, restyled to the design's outline box + mono due label.
private struct HomeworkDueRow: View {
    @Environment(AppStore.self) private var store
    let item: HomeworkItem

    private static let shortWeekday: DateFormatter = { let f = DateFormatter(); f.dateFormat = "EEE"; return f }()

    private var due: (text: String, color: Color) {
        let today = Agenda.todayKey()
        if item.dueDate < today { return ("overdue", Palette.red) }
        if item.dueDate == today { return ("today", Palette.warn) }
        let d = DateFmt.ymd.date(from: item.dueDate) ?? Date()
        return (Self.shortWeekday.string(from: d), Palette.textSecond)
    }

    var body: some View {
        Button {
            Haptics.selection()
            Task { await store.toggleHomeworkDone(item) }
        } label: {
            HStack(spacing: Space.sm + 2) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(due.text == "overdue" ? Palette.red : Palette.border, lineWidth: 1.5)
                    .frame(width: 18, height: 18)
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                Spacer(minLength: Space.sm)
                Text(due.text)
                    .font(Typography.mono(11))
                    .foregroundStyle(due.color)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Kid header (canvas-1g)

private struct KidHeader: View {
    @Environment(AppStore.self) private var store
    let dateLabel: String

    private var kid: Kid? { store.kids.first { $0.id == store.me?.kidId } }
    private var kidIndex: Int? { store.kids.firstIndex { $0.id == store.me?.kidId } }
    private var kidColor: Color { kidIndex.map { Palette.kidColor(index: $0) } ?? Palette.accent }
    private var kidName: String { kid?.name ?? store.me?.name ?? "there" }
    private var initial: String { String(kidName.first ?? "?").uppercased() }

    var body: some View {
        HStack(spacing: Space.md) {
            Text(initial)
                .font(Typography.title)
                .foregroundStyle(Palette.onAccent)
                .frame(width: 52, height: 52)
                .background(kidColor, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                MicroLabel(text: dateLabel)
                Text("Hey \(kidName)!").font(Typography.largeTitle).foregroundStyle(Palette.text)
            }
            Spacer()
            // ponytail: no streak-days data source yet (server doesn't track a
            // streak) — skipping the canvas-1g coral→violet ring rather than
            // showing a fake number. Add once /api/streak (or similar) exists.
        }
    }
}

// MARK: - Kid card stack (canvas-1g)

private struct KidTodayStack: View {
    @Environment(AppStore.self) private var store

    private var todayItems: [AgendaItem] {
        Agenda.items(on: Agenda.todayKey(), events: store.events, familyEvents: store.familyEvents, homework: store.homework)
            .filter { $0.kind != .homework }
    }
    private var nextUp: AgendaItem? { todayItems.first }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.lg) {
            if let next = nextUp {
                HStack(spacing: Space.sm + 2) {
                    Text("⏰").font(.system(size: 20))
                    Text("Next up: **\(next.title)**" + (next.time.map { " at \($0)" } ?? ""))
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                }
                .padding(.horizontal, Space.lg).padding(.vertical, Space.md)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }

            Card {
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "Your day")
                    if todayItems.isEmpty {
                        Text("Nothing scheduled today — enjoy! 🎉")
                            .font(Typography.body).foregroundStyle(Palette.textSecond)
                    } else {
                        VStack(spacing: Space.sm) {
                            ForEach(todayItems) { item in
                                HStack(spacing: Space.md) {
                                    Text(item.time ?? "—")
                                        .font(Typography.mono(14, .bold))
                                        .frame(width: 56, alignment: .leading)
                                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                                        .fill(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.accent)
                                        .frame(width: 4, height: 30)
                                    Text(item.title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                                        .lineLimit(1)
                                    Spacer(minLength: Space.sm)
                                    if let sub = item.subtitle, !sub.isEmpty {
                                        Text(sub).font(Typography.caption).foregroundStyle(Palette.textSecond).lineLimit(1)
                                    }
                                }
                                .padding(.horizontal, Space.md).padding(.vertical, Space.sm + 2)
                                .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
                            }
                        }
                    }
                }
            }

            KidHomeworkCard()

            // ponytail: canvas-1g pairs this with a "Today's habits" card, but
            // there's no habits API/data source yet — full-width Daily 5 alone
            // rather than fabricating habit rows. Add the habits card + the
            // paired 1fr/1fr layout once that data exists.
            DailyFiveCard(isKid: true)
        }
    }
}

/// The kid's own homework: overdue/today/upcoming (not done, "catch up!" styling)
/// plus done items due today (celebratory strikethrough row).
private struct KidHomeworkCard: View {
    @Environment(AppStore.self) private var store

    private var items: [HomeworkItem] {
        let today = Agenda.todayKey(); let limit = Agenda.dayKey(offset: 7)
        return store.homework
            .filter { ($0.dueDate >= today && $0.dueDate <= limit) || ($0.isDone && $0.dueDate == today) }
            .sorted { a, b in
                if a.isDone != b.isDone { return !a.isDone }
                return a.dueDate < b.dueDate
            }
    }
    private var leftCount: Int { items.filter { !$0.isDone }.count }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Homework")
                    Spacer()
                    Text("\(leftCount) left").font(Typography.mono(12)).foregroundStyle(Palette.textSecond)
                }
                if items.isEmpty {
                    Text("No homework due this week 🎉")
                        .font(Typography.body).foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(items) { KidHomeworkRow(item: $0) }
                    }
                }
            }
        }
    }
}

private struct KidHomeworkRow: View {
    @Environment(AppStore.self) private var store
    let item: HomeworkItem

    private var isOverdue: Bool { !item.isDone && item.dueDate < Agenda.todayKey() }
    private var isToday: Bool { !item.isDone && item.dueDate == Agenda.todayKey() }

    var body: some View {
        Button {
            Haptics.selection()
            Task { await store.toggleHomeworkDone(item) }
        } label: {
            HStack(spacing: Space.md) {
                checkbox
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(item.isDone ? Palette.textSecond : Palette.text)
                    .strikethrough(item.isDone, color: Palette.textSecond)
                    .lineLimit(1)
                Spacer(minLength: Space.sm)
                trailing
            }
            .padding(.horizontal, Space.md).padding(.vertical, Space.sm + 2)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isOverdue ? Palette.red : Palette.border, lineWidth: isOverdue ? 1.5 : 1))
            .opacity(item.isDone ? 0.55 : 1)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var checkbox: some View {
        if item.isDone {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Palette.green)
        } else {
            Circle()
                .strokeBorder(isOverdue ? Palette.red : Palette.border, lineWidth: 2)
                .frame(width: 26, height: 26)
        }
    }

    @ViewBuilder private var trailing: some View {
        if item.isDone {
            Text("🎉")
        } else if isOverdue {
            Text("catch up!").font(Typography.mono(12, .bold)).foregroundStyle(Palette.red)
        } else if isToday {
            Text("today").font(Typography.mono(12, .bold)).foregroundStyle(Palette.warn)
        }
    }
}
