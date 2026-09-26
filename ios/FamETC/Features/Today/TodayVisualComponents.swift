import SwiftUI
import UIKit

struct TodayParentHeader: View {
    let greeting: String
    let dateLabel: String
    let onAddEvent: () -> Void
    let onMore: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var overdue: Int {
        store.kids.reduce(0) { $0 + FamilyRingsMath.homework(kidID: $1.id, items: store.homework, today: Agenda.todayKey()).overdue }
    }
    private var eventCount: Int {
        Agenda.items(on: Agenda.todayKey(), events: store.visibleEvents, familyEvents: store.visibleFamilyEvents, homework: [])
            .filter { $0.kind != .homework }.count
    }

    var body: some View {
        HStack(alignment: .center, spacing: Space.md) {
            VStack(alignment: .leading, spacing: 3) {
                Text(greeting)
                    .font(sizeClass == .regular ? Typography.greetingRegular : Typography.greeting)
                    .tracking(-0.5)
                    .foregroundStyle(Palette.text)
                Text(dateLabel)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                (Text(overdue > 0 ? "\(overdue) overdue" : "Nothing overdue")
                    .foregroundColor(overdue > 0 ? Palette.frDanger : Palette.frInk2)
                 + Text(" · \(eventCount) event\(eventCount == 1 ? "" : "s") today").foregroundColor(Palette.frInk2))
                    .font(Typography.label).fixedSize(horizontal: false, vertical: true)
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
                Text("Hi \(kidName)")
                    .font(Typography.greeting)
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
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(Palette.frCard, in: Capsule())
            .overlay(
                Capsule().strokeBorder(Palette.frYou, lineWidth: 1)
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
