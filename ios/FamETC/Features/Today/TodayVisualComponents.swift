import SwiftUI
import UIKit

/// Soft layout header: the account menu avatar, a serif greeting ("Good
/// afternoon," in medium, the name in bold), the date with the overdue and
/// events line, and a white add-event circle.
struct TodayParentHeader: View {
    let greetingLead: String
    let name: String
    let dateLabel: String
    let onAddEvent: () -> Void
    let onMore: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var editingName = false
    @State private var nameDraft = ""
    @State private var nameError: String?

    private var isCompactPhone: Bool {
        !textSize.isAccessibilitySize && (
            sizeClass != .regular ||
            (UIDevice.current.userInterfaceIdiom == .phone && verticalSizeClass == .compact)
        )
    }

    private var overdue: Int {
        store.kids.reduce(0) { $0 + FamilyRingsMath.homework(kidID: $1.id, items: store.homework, today: Agenda.todayKey()).overdue }
    }
    private var eventCount: Int {
        Agenda.items(on: Agenda.todayKey(), events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: [])
            .filter { $0.kind != .homework }.count
    }

    private var spokenGreeting: String { name.isEmpty ? greetingLead : "\(greetingLead), \(name)" }

    var body: some View {
        HStack(alignment: isCompactPhone ? .top : .center, spacing: isCompactPhone ? Space.sm + 2 : Space.md) {
            Menu {
                Button(action: onMore) { Label("Notes", systemImage: "note.text") }
                Button {
                    nameDraft = store.ownName
                    editingName = true
                } label: { Label("Your name", systemImage: "person.text.rectangle") }
            } label: {
                TodayInitialAvatar(
                    text: store.me?.name?.first.map(String.init) ?? "F",
                    color: Palette.frCard
                )
                .frame(width: isCompactPhone ? 44 : 52, height: isCompactPhone ? 44 : 52)
                .contentShape(Circle())
            }
            .accessibilityLabel("More")
            .accessibilityHint("Open Notes and other family tools")

            headerCopy
            Spacer(minLength: Space.xs)
            CircleIconButton(systemImage: "plus", label: "Add event", hint: "Create a family event", action: onAddEvent)
        }
        .alert("Your name", isPresented: $editingName) {
            TextField("First and last name", text: $nameDraft)
                .textContentType(.name)
            Button("Save") { Task { nameError = await store.updateMyName(nameDraft) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("How Fam ETC greets you and signs your messages.")
        }
        .alert("Couldn't save your name", isPresented: Binding(get: { nameError != nil }, set: { if !$0 { nameError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(nameError ?? "")
        }
    }

    /// The lead words in the medium weight and the name in bold, as one Text so
    /// it wraps naturally.
    private var greetingText: Text {
        let leadFont: Font
        let nameFont: Font
        if isCompactPhone {
            leadFont = Theme.display(23, weight: .medium, relativeTo: .title2)
            nameFont = Theme.display(23, weight: .bold, relativeTo: .title2)
        } else if sizeClass == .regular {
            leadFont = Typography.greetingLeadRegular
            nameFont = Typography.greetingRegular
        } else {
            leadFont = Typography.greetingLead
            nameFont = Typography.greeting
        }
        guard !name.isEmpty else { return Text(greetingLead).font(nameFont) }
        return Text("\(greetingLead), ").font(leadFont) + Text(name).font(nameFont)
    }

    @ViewBuilder private var headerCopy: some View {
        VStack(alignment: .leading, spacing: isCompactPhone ? 2 : 3) {
            greetingText
                .tracking(-0.3)
                .foregroundStyle(Palette.text)
                .lineLimit(isCompactPhone ? 2 : nil)
                .minimumScaleFactor(isCompactPhone ? 0.9 : 1)
                .accessibilityLabel(spokenGreeting)

            if isCompactPhone {
                Text(dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.frInk2)
                    .lineLimit(1)
                (Text(overdue > 0 ? "\(overdue) overdue" : "Nothing overdue")
                    .foregroundColor(overdue > 0 ? Palette.frDanger : Palette.frInk2)
                 + Text(" · \(eventCount) event\(eventCount == 1 ? "" : "s") today").foregroundColor(Palette.frInk2))
                    .font(Typography.label)
                    .lineLimit(1)
                    .accessibilityLabel("\(overdue > 0 ? "\(overdue) overdue" : "Nothing overdue"). \(eventCount) event\(eventCount == 1 ? "" : "s") today")
            } else {
                Text(dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                (Text(overdue > 0 ? "\(overdue) overdue" : "Nothing overdue")
                    .foregroundColor(overdue > 0 ? Palette.frDanger : Palette.frInk2)
                 + Text(" · \(eventCount) event\(eventCount == 1 ? "" : "s") today").foregroundColor(Palette.frInk2))
                    .font(Typography.label)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .layoutPriority(1)
    }
}

struct TodayChildHeader: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    let dateLabel: String
    let onMore: () -> Void

    private var kid: Kid? { store.kids.first { $0.id == store.me?.kidId } }
    private var kidName: String { kid?.name ?? store.me?.name ?? "there" }
    private var isCompactPhone: Bool {
        !textSize.isAccessibilitySize && (
            sizeClass != .regular ||
            (UIDevice.current.userInterfaceIdiom == .phone && verticalSizeClass == .compact)
        )
    }

    var body: some View {
        HStack(alignment: isCompactPhone ? .top : .center, spacing: isCompactPhone ? Space.sm : Space.md) {
            if let kid {
                KidProfileAvatar(kid: kid, size: isCompactPhone ? 40 : 48)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            } else {
                TodayInitialAvatar(text: String(kidName.prefix(1)), color: Palette.accentSoft)
                    .frame(width: isCompactPhone ? 40 : 48, height: isCompactPhone ? 40 : 48)
            }
            VStack(alignment: .leading, spacing: isCompactPhone ? 2 : 3) {
                Text("Hi \(kidName)")
                    .font(isCompactPhone ? Theme.display(23, weight: .bold, relativeTo: .title2) : Typography.greeting)
                    .foregroundStyle(Palette.text)
                    .lineLimit(isCompactPhone ? 2 : nil)
                    .minimumScaleFactor(isCompactPhone ? 0.9 : 1)
                    .accessibilityLabel("Hi \(kidName)")
                Text(textSize.isAccessibilitySize ? Date().formatted(.dateTime.month(.abbreviated).day()) : dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .lineLimit(isCompactPhone ? 1 : nil)
            }
            .layoutPriority(1)
            Spacer(minLength: Space.sm)
            Menu {
                Button(action: onMore) { Label("Notes", systemImage: "note.text") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Palette.frInk)
                    .frame(width: 44, height: 44)
                    .background(Palette.frCard, in: Circle())
                    .overlay(Circle().strokeBorder(Palette.frRule, lineWidth: 1))
            }
            .accessibilityLabel("More")
            .accessibilityHint("Open Notes and other family tools")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Today for \(kidName)")
        .accessibilityValue(dateLabel)
    }
}

private struct TodayInitialAvatar: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(Theme.display(20, weight: .bold, relativeTo: .title3))
            .foregroundStyle(Palette.frYouInk)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(color, in: Circle())
            .overlay(Circle().strokeBorder(Palette.frRule, lineWidth: 1))
            .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.08), .black.opacity(0.35)), radius: 8, y: 4)
            .accessibilityHidden(true)
    }
}

// MARK: - Utilities and secondary disclosure

struct TodayUtilitiesRow: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let onScanNotice: () -> Void
    let onOpenActions: () -> Void
    var onAddEvent: () -> Void = {}

    private var layout: AnyLayout {
        (dynamicTypeSize.isAccessibilitySize || sizeClass != .regular)
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
                title: "Family actions",
                subtitle: "What needs doing",
                symbol: "checklist",
                action: onOpenActions,
                identifier: "today.actions.open"
            )
            utilityButton(title: "Add event", subtitle: "Family calendar", symbol: "calendar.badge.plus",
                          action: onAddEvent, identifier: "today.event.add")
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
                .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.accent)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Palette.textSecond)
            }
            .padding(.horizontal, Space.md)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background(Palette.frCard, in: Capsule())
            .overlay(
                Capsule().strokeBorder(Palette.frRule, lineWidth: 1)
            )
            .cardShadow()
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
            .background(Palette.frCard, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .cardShadow()
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
