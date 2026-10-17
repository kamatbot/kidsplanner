import SwiftUI
import UIKit

/// Activity art for calendar events (docs/design/soft-rings/IOS-BRIEF.md §3).
/// An event's title and feed label map to an activity key and an SF Symbol.
/// An image set named `EventArt-<key>` in the asset catalog replaces the
/// symbol for that activity, so illustrations can be added without code.
enum EventArt {
    struct Activity: Equatable {
        let key: String
        let symbol: String
    }

    static let fallback = Activity(key: "event", symbol: "calendar")

    /// Ordered: specific activities before generic ones, so "Piano lesson" is
    /// music rather than school and "Swim squad training" is swimming rather
    /// than sport. Single words match whole words only ("brunch" is not "run");
    /// phrases match as substrings.
    private static let table: [(keywords: [String], activity: Activity)] = [
        (["football", "soccer", "futsal"], Activity(key: "football", symbol: "figure.soccer")),
        (["swim", "swimming", "swimmers", "gala", "aquatics"], Activity(key: "swimming", symbol: "figure.pool.swim")),
        (["basketball", "netball"], Activity(key: "basketball", symbol: "figure.basketball")),
        (["tennis", "badminton", "squash"], Activity(key: "tennis", symbol: "figure.tennis")),
        (["rugby"], Activity(key: "rugby", symbol: "figure.rugby")),
        (["cricket"], Activity(key: "cricket", symbol: "figure.cricket")),
        (["hockey"], Activity(key: "hockey", symbol: "figure.hockey")),
        (["volleyball"], Activity(key: "volleyball", symbol: "figure.volleyball")),
        (["dance", "dancing", "ballet"], Activity(key: "dance", symbol: "figure.dance")),
        (["music", "piano", "violin", "guitar", "choir", "band", "orchestra", "singing", "drums", "cello", "flute", "ukulele"],
         Activity(key: "music", symbol: "music.note")),
        (["drama", "theatre", "theater", "musical"], Activity(key: "drama", symbol: "theatermasks")),
        (["art", "arts", "drawing", "painting", "pottery", "craft", "crafts"], Activity(key: "art", symbol: "paintpalette")),
        (["running", "athletics", "cross country", "sports day", "marathon"], Activity(key: "running", symbol: "figure.run")),
        (["birthday", "party"], Activity(key: "birthday", symbol: "birthday.cake")),
        (["doctor", "dentist", "clinic", "hospital", "vaccination", "checkup", "check-up", "orthodontist"],
         Activity(key: "doctor", symbol: "stethoscope")),
        (["trip", "flight", "holiday", "vacation", "airport", "travel"], Activity(key: "trip", symbol: "airplane")),
        (["dinner", "lunch", "breakfast", "brunch", "picnic", "barbecue", "bbq"], Activity(key: "food", symbol: "fork.knife")),
        (["reading", "library", "book", "books"], Activity(key: "reading", symbol: "books.vertical")),
        (["exam", "exams", "test", "quiz", "assessment"], Activity(key: "exam", symbol: "pencil.and.outline")),
        (["sport", "sports", "gym", "training", "practice", "match", "fixture", "pe"], Activity(key: "sport", symbol: "figure.run")),
        (["school", "assembly", "conference", "graduation", "open day", "term", "class"], Activity(key: "school", symbol: "graduationcap")),
    ]

    static func activity(title: String, subtitle: String? = nil) -> Activity {
        let text = [title, subtitle ?? ""].joined(separator: " ").lowercased()
        let words = Set(text.split { !$0.isLetter }.map(String.init))
        for entry in table {
            for keyword in entry.keywords {
                let isPhrase = keyword.contains(" ") || keyword.contains("-")
                if isPhrase ? text.contains(keyword) : words.contains(keyword) {
                    return entry.activity
                }
            }
        }
        return fallback
    }

    static func assetName(for activity: Activity) -> String { "EventArt-\(activity.key)" }

    static func hasIllustration(_ activity: Activity) -> Bool {
        UIImage(named: assetName(for: activity)) != nil
    }

    /// Guards against a symbol missing on an older OS: never render a blank card.
    static func resolvedSymbol(_ activity: Activity) -> String {
        UIImage(systemName: activity.symbol) != nil ? activity.symbol : fallback.symbol
    }
}

/// The "Up next" card: a white card washed with the child's profile colour
/// (violet for family events), the activity art, a serif title, the time and
/// place, and an owner chip. Wrap it in a Button to open the event.
struct EventArtCard: View {
    let title: String
    let detail: String
    let kid: Kid?
    let activity: EventArt.Activity
    var minHeight: CGFloat = 196

    @Environment(\.colorScheme) private var scheme
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var tint: Color { kid?.profileColor ?? Palette.frYou }
    private var illustrated: Bool { EventArt.hasIllustration(activity) }
    private var radius: CGFloat { sizeClass == .regular ? Radius.cardLarge : Radius.card }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            EventOwnerChip(kid: kid)
            Spacer(minLength: Space.md)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(Typography.eventTitle)
                    .foregroundStyle(illustrated ? Color.white : Palette.frInk)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Label(detail, systemImage: "clock")
                    .font(Typography.label.weight(.medium))
                    .foregroundStyle(illustrated ? Color.white.opacity(0.92) : Palette.frInk2)
                    .lineLimit(2)
            }
            .padding(.trailing, illustrated ? 0 : 92)
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
        .background { art }
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .shadow(color: Color.adaptive(Color(hex: 0x101828, alpha: 0.06), .black.opacity(0.4)), radius: 12, y: 8)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var art: some View {
        if illustrated {
            Image(EventArt.assetName(for: activity))
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(
                    LinearGradient(colors: [Color.black.opacity(0), Color.black.opacity(0.62)],
                                   startPoint: .center, endPoint: .bottom)
                )
                .accessibilityHidden(true)
        } else {
            ZStack(alignment: .topTrailing) {
                Palette.frCard
                LinearGradient(
                    colors: [tint.opacity(scheme == .dark ? 0.34 : 0.22), tint.opacity(scheme == .dark ? 0.14 : 0.06)],
                    startPoint: .topTrailing,
                    endPoint: .bottomLeading
                )
                Image(systemName: EventArt.resolvedSymbol(activity))
                    .font(.system(size: 80, weight: .regular))
                    .foregroundStyle(tint.opacity(0.85))
                    .padding(.top, Space.xl)
                    .padding(.trailing, Space.xl)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// Small owner capsule on event cards: the child's avatar and name, or a
/// violet house for family events.
struct EventOwnerChip: View {
    let kid: Kid?

    var body: some View {
        HStack(spacing: 6) {
            if let kid {
                KidProfileAvatar(kid: kid, size: 24)
            } else {
                Image(systemName: "house.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.frOnYou)
                    .frame(width: 24, height: 24)
                    .background(Palette.frYou, in: Circle())
                    .accessibilityHidden(true)
            }
            Text(kid?.name ?? "Family")
                .font(Typography.caption.weight(.semibold))
                .foregroundStyle(Palette.frInk)
                .lineLimit(1)
        }
        .padding(.leading, 4)
        .padding(.trailing, 10)
        .frame(height: 32)
        .background(Palette.frCard.opacity(0.94), in: Capsule())
    }
}
