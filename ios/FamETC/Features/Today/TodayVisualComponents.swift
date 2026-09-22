import SwiftUI
import UIKit

// MARK: - Today-only environment

private struct TodayKidFilterKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    var todayKidFilter: String? {
        get { self[TodayKidFilterKey.self] }
        set { self[TodayKidFilterKey.self] = newValue }
    }
}

// MARK: - Headers and filters

struct TodayParentHeader: View {
    let greeting: String
    let dateLabel: String
    let onAddEvent: () -> Void
    let onMore: () -> Void

    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(alignment: .center, spacing: Space.md) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Today")
                    .font(Typography.largeTitle)
                    .foregroundStyle(Palette.text)
                Text(dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Space.sm)
            Button {
                Haptics.impact(.light)
                onAddEvent()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Palette.onAccent)
                    .frame(width: 44, height: 44)
                    .background(Palette.accent, in: Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.94))
            .accessibilityLabel("Add event")
            .accessibilityHint("Create a family event")

            Menu {
                Button(action: onMore) { Label("Notes", systemImage: "note.text") }
            } label: {
                TodayInitialAvatar(
                    text: store.me?.name?.first.map(String.init) ?? "F",
                    color: Palette.accentSoft
                )
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("More")
            .accessibilityHint("Open Notes and other family tools")
        }
    }
}

struct TodayChildHeader: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var textSize
    let dateLabel: String
    let onMore: () -> Void

    private var kid: Kid? { store.kids.first { $0.id == store.me?.kidId } }
    private var kidName: String { kid?.name ?? store.me?.name ?? "there" }

    var body: some View {
        HStack(alignment: .center, spacing: Space.md) {
            if let kid {
                KidProfileAvatar(kid: kid, size: 48)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            } else {
                TodayInitialAvatar(text: String(kidName.prefix(1)), color: Palette.accentSoft)
                    .frame(width: 48, height: 48)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(textSize.isAccessibilitySize ? kidName : "Hey, \(kidName)")
                    .font(textSize.isAccessibilitySize ? Typography.body.weight(.bold) : Typography.largeTitle)
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(textSize.isAccessibilitySize ? Date().formatted(.dateTime.month(.abbreviated).day()) : dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer(minLength: Space.sm)
            Menu {
                Button(action: onMore) { Label("Notes", systemImage: "note.text") }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Palette.text)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("More")
            .accessibilityHint("Open Notes and other family tools")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Today for \(kidName)")
        .accessibilityValue(dateLabel)
    }
}

struct TodayKidFilter: View {
    @Environment(AppStore.self) private var store
    @Binding var selectedKidID: String?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Space.sm) {
                filterButton(id: nil, title: "Everyone", symbol: "person.3.fill")
                ForEach(store.kids) { kid in
                    Button {
                        Haptics.selection()
                        selectedKidID = kid.id
                    } label: {
                        HStack(spacing: Space.sm) {
                            KidProfileAvatar(kid: kid, size: 24)
                            Text(kid.name)
                                .font(Typography.body.weight(.semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(selectedKidID == kid.id ? Palette.accent : Palette.text)
                        .frame(minHeight: 44)
                        .padding(.horizontal, Space.md)
                        .background(
                            selectedKidID == kid.id ? Palette.accentSoft : Palette.panel,
                            in: Capsule()
                        )
                        .overlay(
                            Capsule().strokeBorder(
                                selectedKidID == kid.id ? Palette.accent : Palette.border,
                                lineWidth: 1
                            )
                        )
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("Show \(kid.name)")
                    .accessibilityAddTraits(selectedKidID == kid.id ? .isSelected : [])
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityLabel("Filter Today by child")
    }

    @ViewBuilder
    private func filterButton(id: String?, title: String, symbol: String) -> some View {
        Button {
            Haptics.selection()
            selectedKidID = id
        } label: {
            Label(title, systemImage: symbol)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(selectedKidID == nil ? Palette.accent : Palette.text)
                .frame(minHeight: 44)
                .padding(.horizontal, Space.md)
                .background(
                    selectedKidID == nil ? Palette.accentSoft : Palette.panel,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        selectedKidID == nil ? Palette.accent : Palette.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Show everyone")
        .accessibilityAddTraits(selectedKidID == nil ? .isSelected : [])
    }
}

private struct TodayInitialAvatar: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.accent)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(color, in: Circle())
            .overlay(Circle().strokeBorder(Palette.accent.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Parent priority and progress

struct TodayParentPriorityCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.todayKidFilter) private var selectedKidID
    let onReview: () -> Void

    private var openHomework: [HomeworkItem] {
        let tomorrow = Agenda.dayKey(offset: 1)
        return store.homework
            .filter {
                !$0.isDone && $0.dueDate <= tomorrow &&
                (selectedKidID == nil || $0.kidId == selectedKidID)
            }
            .sorted {
                ($0.dueDate, $0.dueTime ?? "23:59", $0.id) < ($1.dueDate, $1.dueTime ?? "23:59", $1.id)
            }
    }

    private var priority: HomeworkItem? { StudyStartPriority.select(from: openHomework) }

    private var kidName: String {
        guard let kidID = priority?.kidId ?? selectedKidID else { return "Everyone" }
        return store.kids.first { $0.id == kidID }?.name ?? "your child"
    }

    private var isVerifiedParent: Bool {
        guard let user = store.me, user.role != "kid" else { return false }
        return store.family?.parentIds.contains(user.id) == true
    }

    var body: some View {
        if isVerifiedParent {
            Button {
                Haptics.selection()
                onReview()
            } label: {
                HStack(alignment: .center, spacing: Space.md) {
                    VStack(alignment: .leading, spacing: Space.sm) {
                        MicroLabel(text: priority == nil ? "Family check-in" : "Needs your help")
                            .foregroundStyle(Palette.coral)
                        Text(priority?.title ?? (store.isLoadingHomework || store.isRefreshing
                            ? "Checking homework…" : store.homeworkError != nil
                            ? "Homework could not refresh" : "No open homework needs a review"))
                            .font(Typography.title)
                            .foregroundStyle(Palette.text)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(kidName)
                            .font(Typography.caption.weight(.semibold))
                            .foregroundStyle(Palette.coral)
                            .lineLimit(1)
                        Text(priority.map { StudyStartPriority.dueText(for: $0) } ?? "Review your family’s day")
                            .font(Typography.body)
                            .foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: Space.sm) {
                            Text("Review brief")
                                .font(Typography.body.weight(.semibold))
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .bold))
                        }
                        .foregroundStyle(Palette.accent)
                        .frame(minHeight: 44, alignment: .leading)
                    }
                    Spacer(minLength: Space.sm)
                    TodayAssetImage(name: "TodayStudyArt", fallback: "book.closed.fill")
                        .frame(width: 112, height: 96)
                        .accessibilityHidden(true)
                }
                .padding(Space.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(
                        colors: [Palette.coral.opacity(0.09), Palette.panel],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                        .strokeBorder(Palette.border, lineWidth: 1)
                )
                .cardShadow()
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("today.priority.review")
            .accessibilityLabel(priority.map { "Review \(kidName)'s \($0.title)" } ?? "Review family brief")
            .accessibilityHint("Open the parent attention brief")
        }
    }
}

struct TodayParentProgressCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.todayKidFilter) private var selectedKidID
    @State private var progressByKid: [String: FamilyDailyFiveProgress] = [:]

    private var children: [Kid] {
        if let selectedKidID { return store.kids.filter { $0.id == selectedKidID } }
        return store.kids
    }

    private var progressTaskID: String {
        let accountID = store.me?.id ?? ""
        let familyID = store.family?.id ?? ""
        let update = store.attentionUpdatedAt?.timeIntervalSince1970 ?? 0
        return "\(accountID)|\(familyID)|\(selectedKidID ?? "")|\(update)|\(store.assistanceIdentityVerified)|\(store.needsAuth)|\(Agenda.todayKey())"
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: "Their progress")
                    Spacer()
                    Text(children.count == 1 ? "1 child" : "\(children.count) children")
                        .font(Typography.mono(11))
                        .foregroundStyle(Palette.textSecond)
                }
                if children.isEmpty {
                    Text("Add a child in Settings to see family progress.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: 0) {
                        ForEach(children) { kid in
                            TodayProgressRow(
                                kid: kid,
                                progress: progressByKid[kid.id],
                                homework: store.homework,
                                homeworkUnavailable: store.isLoadingHomework || store.homeworkError != nil
                            )
                            if kid.id != children.last?.id {
                                Divider().overlay(Palette.border)
                            }
                        }
                    }
                }
            }
        }
        .task(id: progressTaskID) {
            await loadSnapshot()
        }
        .onReceive(NotificationCenter.default.publisher(for: .famsRewardsChanged)) { _ in
            Task { await loadSnapshot() }
        }
    }

    private func loadSnapshot() async {
        guard !store.needsAuth, store.assistanceIdentityVerified,
              let user = store.me, let family = store.family,
              user.role != "kid", family.parentIds.contains(user.id) else {
            progressByKid = [:]
            return
        }

        progressByKid = [:]
        let day = Agenda.todayKey()
        let cookies = HTTPCookieStorage.shared.cookies(for: Config.baseURL) ?? []
        guard cookies.contains(where: { $0.name == "fam_sess" }) else { return }
        let cookie = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"] ?? ""
        let requestID = progressTaskID
        for kid in children {
            let result = try? await APIClient.shared.childDailyFiveProgress(kidID: kid.id, date: day, cookie: cookie)
            guard !Task.isCancelled, !store.needsAuth, store.assistanceIdentityVerified,
                  store.me?.id == user.id, store.family?.id == family.id,
                  progressTaskID == requestID, Agenda.todayKey() == day else { return }
            if let result { progressByKid[kid.id] = result }
        }
    }
}

private struct TodayProgressRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let kid: Kid
    let progress: FamilyDailyFiveProgress?
    let homework: [HomeworkItem]
    let homeworkUnavailable: Bool

    private var dueCount: Int {
        let limit = Agenda.dayKey(offset: 7)
        return homework.filter {
            $0.kidId == kid.id && !$0.isDone && $0.dueDate <= limit
        }.count
    }

    private var dailyText: String {
        guard let completed = progress?.daily3Completed else { return "Not loaded" }
        return "\(completed)/3"
    }

    private var challengeText: String {
        guard let progress else { return "Not loaded" }
        switch progress.scheduledChallengeStatus {
        case "completed": return "Done"
        case "started": return "In progress"
        default: return "Ready"
        }
    }

    private var homeworkText: String {
        if homeworkUnavailable { return "Not loaded" }
        return dueCount == 0 ? "No homework due" : "\(dueCount) due"
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: Space.sm) {
                    leadingContent
                    metricsContent
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.md) {
                        leadingContent
                        metricsContent
                    }
                    VStack(alignment: .leading, spacing: Space.sm) {
                        leadingContent
                        metricsContent
                    }
                }
            }
        }
        .padding(.vertical, Space.sm + 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kid.name), Daily 3 \(dailyText), scheduled challenge \(challengeText), \(homeworkText)")
    }

    @ViewBuilder
    private var leadingContent: some View {
        HStack(spacing: Space.md) {
            KidProfileAvatar(kid: kid, size: 36)
            Text(kid.name)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var metricsContent: some View {
        HStack(spacing: Space.lg) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Daily 3")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                Text(dailyText)
                    .font(Typography.mono(14, .bold))
                    .foregroundStyle(Palette.accent)
            }
            .frame(minWidth: 58, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text("Challenge")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                Text(challengeText)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.accent)
            }
            .frame(minWidth: 76, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text("Homework")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                Text(homeworkText)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(homeworkUnavailable ? Palette.textSecond : (dueCount == 0 ? Palette.green : Palette.coral))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Schedule timeline

struct TodayScheduleTimelineCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.todayKidFilter) private var selectedKidID
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showDetails = false

    /// A child receives `kidID` from their signed-in session. A parent uses the
    /// optional child filter; both paths still start from AppStore's scoped
    /// visible events, never from synthetic times or guessed home travel.
    var kidID: String? = nil

    private var effectiveKidID: String? { kidID ?? selectedKidID }

    private var items: [AgendaItem] {
        Agenda.items(
            on: Agenda.todayKey(),
            events: store.visibleEvents,
            familyEvents: store.visibleFamilyEvents,
            homework: store.homework
        )
        .filter { item in
            item.kind != .homework && (effectiveKidID == nil || item.kidId == nil || item.kidId == effectiveKidID)
        }
    }

    private var compactItems: [AgendaItem] { Array(items.prefix(3)) }
    private var title: String { store.isParent ? "Today's schedule" : "Your day" }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: title)
                    Spacer()
                    if !items.isEmpty {
                        Text("\(items.count) event\(items.count == 1 ? "" : "s")")
                            .font(Typography.mono(11))
                            .foregroundStyle(Palette.textSecond)
                    }
                }
                if compactItems.isEmpty {
                    Text(store.isRefreshing || store.isLoadingHomework ? "Loading today's schedule…"
                         : store.syncError != nil ? "Schedule could not refresh. Pull down to retry."
                         : "Nothing is scheduled today.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .padding(.top, Space.xs)
                } else {
                    compactTimeline
                    DisclosureGroup("View full schedule", isExpanded: $showDetails) {
                        VStack(spacing: 0) {
                            ForEach(items) { item in
                                TodayScheduleRow(item: item)
                                if item.id != items.last?.id {
                                    Divider().overlay(Palette.border)
                                }
                            }
                        }
                        .padding(.top, Space.xs)
                    }
                    .font(Typography.caption.weight(.semibold))
                    .tint(Palette.accent)
                    .frame(minHeight: 44, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var compactTimeline: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: Space.sm))
            : AnyLayout(HStackLayout(alignment: .top, spacing: Space.sm))
        layout {
            timelineItems
        }
    }

    @ViewBuilder
    private var timelineItems: some View {
        ForEach(compactItems) { item in
            TodayScheduleCompactItem(item: item)
        }
    }
}

private struct TodayScheduleCompactItem: View {
    @Environment(AppStore.self) private var store
    let item: AgendaItem

    private var symbol: String {
        switch item.kind {
        case .deadline: return "exclamationmark.circle"
        case .event: return "calendar"
        case .homework: return "book.closed"
        }
    }

    private var kindLabel: String {
        switch item.kind {
        case .deadline: return "Deadline"
        case .event: return "Event"
        case .homework: return "Homework"
        }
    }

    private var kidName: String? {
        guard let kidID = item.kidId else { return nil }
        return store.kids.first { $0.id == kidID }?.name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.xs) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                    .accessibilityHidden(true)
                Spacer(minLength: Space.xs)
                if let kidID = item.kidId,
                   let kid = store.kids.first(where: { $0.id == kidID }) {
                    KidProfileAvatar(kid: kid, size: 22)
                }
            }
            Text(item.time ?? "All day")
                .font(Typography.mono(11, .semibold))
                .foregroundStyle(Palette.textSecond)
            Text(item.title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.text)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Space.sm)
        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 90, alignment: .topLeading)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                .strokeBorder(Palette.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kindLabel), \(item.title), \(item.time ?? "All day")\(kidName.map { ", \($0)" } ?? "")")
    }
}

private struct TodayScheduleRow: View {
    @Environment(AppStore.self) private var store
    let item: AgendaItem

    var body: some View {
        HStack(alignment: .top, spacing: Space.md) {
            Text(item.time ?? "All day")
                .font(Typography.mono(11))
                .foregroundStyle(Palette.textSecond)
                .frame(width: 52, alignment: .leading)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(Agenda.kidColor(item.kidId, kids: store.kids) ?? Palette.accent)
                .frame(width: 3, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Space.xs)
            if let kidID = item.kidId,
               let kid = store.kids.first(where: { $0.id == kidID }) {
                KidProfileAvatar(kid: kid, size: 24)
            }
        }
        .padding(.vertical, Space.sm + 2)
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Kid rewards

struct TodayChildFamsCard: View {
    let kidID: String?

    var body: some View {
        if let kidID {
            TodayFamsMiniCard(kidID: kidID)
        }
    }
}

private struct TodayFamsMiniCard: View {
    @Environment(AppStore.self) private var store
    @State private var wallet: FamsWallet?
    @State private var loading = false
    @State private var failed = false
    let kidID: String

    private var identity: String {
        "\(store.me?.id ?? "")|\(store.family?.id ?? "")|\(kidID)"
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(alignment: .firstTextBaseline) {
                    MicroLabel(text: store.isParent ? "Fams balance" : "Your fams")
                    Spacer()
                    Text("1 fam = ฿1")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
                if let wallet {
                    HStack(alignment: .center, spacing: Space.md) {
                        FamsCoin(trigger: 0, compact: true)
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text("\(famsAmount(wallet.balance)) fams")
                                .font(Typography.statNumber)
                                .foregroundStyle(Palette.text)
                                .monospacedDigit()
                            Text("\(famsAmount(wallet.weekly.earned)) / \(famsAmount(wallet.weekly.limit)) this week")
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                            ProgressView(value: wallet.weeklyFraction)
                                .tint(Palette.accent)
                                .accessibilityLabel("Weekly fams")
                                .accessibilityValue("\(famsAmount(wallet.weekly.earned)) of \(famsAmount(wallet.weekly.limit))")
                        }
                        Spacer(minLength: 0)
                    }
                } else if loading {
                    ProgressView("Loading rewards…")
                        .font(Typography.caption)
                } else {
                    Text(failed ? "Rewards are unavailable. Try again later." : "Rewards will appear here.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                }
            }
        }
        .task(id: identity) { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .famsRewardsChanged)) { _ in
            Task { await load() }
        }
    }

    private func load() async {
        guard !kidID.isEmpty else { return }
        loading = true
        failed = false
        defer { loading = false }
        do {
            let result = try await APIClient.shared.famsWallet(kidId: kidID)
            guard !Task.isCancelled, result.kidId == kidID, store.me != nil else { return }
            wallet = result
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

// MARK: - Utilities and secondary disclosure

struct TodayUtilitiesRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let onScanNotice: () -> Void
    let onOpenActions: () -> Void

    private var layout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: Space.md))
            : AnyLayout(HStackLayout(spacing: Space.md))
    }

    var body: some View {
        layout {
            utilityButton(
                title: "Scan a notice",
                subtitle: "Add to calendar",
                symbol: "doc.text.viewfinder",
                action: onScanNotice,
                identifier: "today.notice.scan",
                accessibilityTitle: "Turn a school notice into a plan"
            )
            utilityButton(
                title: "All actions",
                subtitle: "What needs doing",
                symbol: "checklist",
                action: onOpenActions,
                identifier: "today.actions.open"
            )
        }
    }

    private func utilityButton(
        title: String,
        subtitle: String,
        symbol: String,
        action: @escaping () -> Void,
        identifier: String,
        accessibilityTitle: String? = nil
    ) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: Space.sm) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.textSecond)
            }
            .padding(.horizontal, Space.md)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: 1)
            )
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(accessibilityTitle ?? title)
        .accessibilityHint(subtitle)
    }
}

enum TodaySecondaryRole: Equatable {
    case parent, kid
}

struct TodaySecondaryDisclosure: View {
    @Binding var isExpanded: Bool
    let role: TodaySecondaryRole
    let extra: AnyView?

    init(
        isExpanded: Binding<Bool>,
        role: TodaySecondaryRole,
        extra: AnyView? = nil
    ) {
        _isExpanded = isExpanded
        self.role = role
        self.extra = extra
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: Space.lg) {
                if let extra {
                    extra
                }
                if role == .parent {
                    ActionCard()
                    FamsHomeCard()
                } else {
                    ActionCard()
                    FamsHomeCard()
                }
            }
            .padding(.top, Space.sm)
        } label: {
            HStack(spacing: Space.sm) {
                Image(systemName: "square.stack.3d.up")
                    .foregroundStyle(Palette.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("More family tools")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Text("Homework, actions and rewards")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Space.sm)
            }
            .padding(Space.lg)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: 1)
            )
        }
        .tint(Palette.accent)
        .accessibilityIdentifier("today.secondary.toggle")
        .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
    }
}

// MARK: - Asset helpers

struct TodayAssetImage: View {
    let name: String
    let fallback: String

    var body: some View {
        Group {
            if UIImage(named: name) != nil {
                Image(name)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: fallback)
                    .resizable()
                    .scaledToFit()
                    .padding(Space.lg)
                    .foregroundStyle(Palette.accent)
                    .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
        }
        .accessibilityHidden(true)
    }
}
