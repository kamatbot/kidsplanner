import SwiftUI

/// Minimal stand-ins for the four native tabs' main screens. Each just needs to
/// compile and render — full builds land tab-by-tab in later phases. Settings,
/// Goals, and Activities are NOT tabs; they're reached via a "More" entry (hosted
/// by `HybridWebView`) from within Today. That "More" sheet itself is out of
/// scope for this scaffold.
private struct ComingSoonScreen: View {
    let title: String
    let systemImage: String

    var body: some View {
        SurfaceScaffold(title: title) {
            Card {
                VStack(alignment: .leading, spacing: Space.md) {
                    Image(systemName: systemImage)
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(Palette.accent)
                    Text("Coming soon")
                        .font(Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                    Text("The \(title) surface is scaffolded but not yet built.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                }
            }
        }
    }
}

// TodayScreen  → Features/Today/TodayView.swift
// ChatScreen   → Features/Chat/ChatView.swift
// CalendarScreen → Features/Calendar/CalendarView.swift

struct HomeworkScreen: View {
    var body: some View {
        ComingSoonScreen(title: "Homework", systemImage: "book.closed.fill")
    }
}
