import SwiftUI

// Shared controls for the soft layout (docs/design/soft-rings/IOS-BRIEF.md §2–3).
// Colours come only from the Family Rings `Palette.fr*` tokens.

// MARK: - Section header

/// Serif section heading with an optional trailing text action ("See all",
/// "Add event"). The action keeps a 44pt hit area.
struct SectionHeader: View {
    let title: String
    var actionTitle: String? = nil
    var actionSystemImage: String? = nil
    var actionIdentifier: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
            Text(title)
                .font(Typography.sectionTitle)
                .foregroundStyle(Palette.frInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: Space.sm)
            if let actionTitle, let action {
                Button {
                    Haptics.selection()
                    action()
                } label: {
                    HStack(spacing: 4) {
                        if let actionSystemImage {
                            Image(systemName: actionSystemImage)
                                .font(.system(size: 13, weight: .bold))
                                .accessibilityHidden(true)
                        }
                        Text(actionTitle)
                    }
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.frYouInk)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(actionIdentifier ?? "section.action.\(title)")
            }
        }
    }
}

// MARK: - Circle icon button

/// 44pt circular icon button (add, previous/next, account). `prominent` fills
/// it with the violet action colour.
struct CircleIconButton: View {
    let systemImage: String
    let label: String
    var hint: String = ""
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.impact(.light)
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(prominent ? Palette.frOnYou : Palette.frInk)
                .frame(width: 44, height: 44)
                .background(prominent ? Palette.frYou : Palette.frCard, in: Circle())
                .overlay(Circle().strokeBorder(prominent ? Color.clear : Palette.frRule, lineWidth: 1))
                .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.08), .black.opacity(0.35)), radius: 8, y: 4)
        }
        .buttonStyle(PressableStyle(scale: 0.94))
        .accessibilityLabel(label)
        .accessibilityHint(hint)
    }
}

// MARK: - Pill segmented control

/// A capsule segmented control: white track, violet selected pill, 44pt
/// segments. Each segment is a real button carrying the selected trait.
struct PillSegmentedControl<Value: Hashable>: View {
    let label: String
    @Binding var selection: Value
    let options: [Value]
    let title: (Value) -> String
    var systemImage: (Value) -> String? = { _ in nil }
    /// UI tests find the control by this identifier, then its segments by title.
    var identifier: String? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { option in
                segment(option)
            }
        }
        .padding(4)
        .background(Palette.frCard, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.frRule, lineWidth: 1))
        .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.05), .black.opacity(0.3)), radius: 10, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier ?? "pill.\(label)")
    }

    private func segment(_ option: Value) -> some View {
        let selected = option == selection
        return Button {
            guard option != selection else { return }
            Haptics.selection()
            withAnimation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion)) { selection = option }
        } label: {
            HStack(spacing: 6) {
                if let symbol = systemImage(option) {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .semibold))
                        .accessibilityHidden(true)
                }
                Text(title(option))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .font(Typography.body.weight(.semibold))
            .foregroundStyle(selected ? Palette.frOnYou : Palette.frInk2)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background {
                if selected {
                    Capsule()
                        .fill(Palette.frYou)
                        .matchedGeometryEffect(id: "pill", in: pill)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Week strip

/// One day of the Today week strip. `dots` holds up to three owner keys
/// (a child id, or "family") so a child with several events shows one dot.
struct WeekStripDay: Identifiable {
    let key: String
    let weekday: String
    let day: String
    let spokenDate: String
    let dots: [Color]
    let eventCount: Int
    var id: String { key }
}

enum WeekStripData {
    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEEEE")
        return formatter
    }()
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter
    }()
    private static let spokenFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEEdMMMM")
        return formatter
    }()

    /// Monday–Sunday of the week containing `date`. Homework is excluded: the
    /// strip shows calendar events only, like the Calendar dots. `kidID` limits
    /// a child session to its own and family events.
    static func days(
        containing date: Date = Date(),
        events: [CalendarEvent],
        familyEvents: [FamilyEvent],
        kids: [Kid],
        kidID: String? = nil
    ) -> [WeekStripDay] {
        guard let monday = DateFmt.ymd.date(from: Agenda.mondayKey(containing: date)) else { return [] }
        let byDay = Agenda.itemsByDay(events: events, familyEvents: familyEvents, homework: [])
        return (0..<7).compactMap { offset -> WeekStripDay? in
            guard let day = Calendar.current.date(byAdding: .day, value: offset, to: monday) else { return nil }
            let key = DateFmt.ymd.string(from: day)
            let items = (byDay[key] ?? []).filter { kidID == nil || $0.kidId == nil || $0.kidId == kidID }
            var owners: [String] = []
            var dots: [Color] = []
            for item in items {
                let owner = item.kidId ?? "family"
                guard !owners.contains(owner) else { continue }
                owners.append(owner)
                dots.append(Agenda.kidColor(item.kidId, kids: kids) ?? Palette.frYou)
                if dots.count == 3 { break }
            }
            return WeekStripDay(
                key: key,
                weekday: weekdayFormatter.string(from: day),
                day: dayFormatter.string(from: day),
                spokenDate: spokenFormatter.string(from: day),
                dots: dots,
                eventCount: items.count
            )
        }
    }
}

/// Monday–Sunday strip with today as a tall violet capsule. Tapping a day calls
/// `onSelect` with its yyyy-MM-dd key (Today opens Calendar on that day).
struct WeekStrip: View {
    let days: [WeekStripDay]
    var selectedKey: String = Agenda.todayKey()
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            ForEach(days) { day in
                dayButton(day)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("This week")
        .accessibilityIdentifier("today.weekstrip")
    }

    private func dayButton(_ day: WeekStripDay) -> some View {
        let selected = day.key == selectedKey
        let isToday = day.key == Agenda.todayKey()
        let events = day.eventCount == 0 ? "no events" : "\(day.eventCount) event\(day.eventCount == 1 ? "" : "s")"
        // No haptic here: opening the Calendar tab plays RootView's selection haptic.
        return Button {
            onSelect(day.key)
        } label: {
            VStack(spacing: 4) {
                Text(day.weekday)
                    .font(Typography.caption.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? Palette.frOnYou : Palette.frInk2)
                Text(day.day)
                    .font(Theme.font(selected ? 20 : 17, weight: selected ? .bold : .semibold, relativeTo: .headline))
                    .monospacedDigit()
                    .foregroundStyle(selected ? Palette.frOnYou : Palette.frInk)
                HStack(spacing: 3) {
                    ForEach(Array(day.dots.enumerated()), id: \.offset) { _, color in
                        Circle()
                            .fill(selected ? Palette.frOnYou : color)
                            .frame(width: 5, height: 5)
                    }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 70)
            .background {
                if selected {
                    Capsule()
                        .fill(Palette.frYou)
                        .shadow(color: Palette.frYou.opacity(0.32), radius: 10, y: 6)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(day.spokenDate)\(isToday ? ", today" : ""), \(events)")
        .accessibilityHint("Opens Calendar on this day")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityIdentifier("today.weekstrip.\(day.key)")
    }
}
