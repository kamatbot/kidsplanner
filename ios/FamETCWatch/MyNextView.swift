import SwiftUI

struct MyNextView: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header

                if store.connection == .disconnected || store.connection == .offline {
                    connectionBanner
                }

                nextSection
                homeworkSection
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

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("My next")
                .font(.headline)
            Text(store.connection.label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var connectionBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: store.connection == .disconnected ? "wifi.slash" : "arrow.triangle.2.circlepath")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.connection == .disconnected ? "Not connected" : "Working offline")
                    .font(.caption.weight(.semibold))
                Text(store.lastError ?? "Saved items stay available on this watch.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(9)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }

    private var nextSection: some View {
        WatchSection(title: "Urgent", systemImage: "exclamationmark.circle.fill") {
            if store.urgentActions.isEmpty {
                EmptyWatchRow(text: "Nothing urgent")
            } else {
                ForEach(store.urgentActions) { action in
                    ActionRow(action: action) {
                        Task { await store.completeAction(action) }
                    }
                }
            }
        }
    }

    private var homeworkSection: some View {
        WatchSection(title: "Homework", systemImage: "book.closed.fill") {
            if store.openHomework.isEmpty {
                EmptyWatchRow(text: "Homework is caught up")
            } else {
                ForEach(store.openHomework) { item in
                    HomeworkRow(item: item) {
                        Task { await store.toggleHomework(item) }
                    }
                }
            }
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
            .font(.caption)
            .foregroundStyle(.secondary)
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
                VStack(alignment: .leading, spacing: 2) {
                    Text(action.title)
                        .font(.caption.weight(.medium))
                        .multilineTextAlignment(.leading)
                    if let due = dueText(date: action.dueDate, time: action.dueTime) {
                        Text(due)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Complete \(action.title)")
    }
}

private struct HomeworkRow: View {
    let item: WatchHomework
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "circle")
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.caption.weight(.medium))
                        .multilineTextAlignment(.leading)
                    Text(dueText(date: item.dueDate, time: item.dueTime) ?? "Due soon")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mark \(item.title) complete")
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
                Text(item.text)
                    .font(.caption.weight(.medium))
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mark \(item.text) bought")
    }
}

private func dueText(date: String?, time: String?) -> String? {
    guard let date, !date.isEmpty else { return nil }
    if let time, !time.isEmpty { return "Due \(date) at \(time)" }
    return "Due \(date)"
}
