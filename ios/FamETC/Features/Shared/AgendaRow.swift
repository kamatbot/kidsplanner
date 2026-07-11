import SwiftUI

/// One agenda row shared by Today + Calendar. Homework rows carry a tappable
/// checkbox that marks the item done/undone (optimistic, via AppStore).
struct AgendaRow: View {
    @Environment(AppStore.self) private var store
    let item: AgendaItem

    var body: some View {
        HStack(spacing: Space.md) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(item.homework?.isDone == true ? Palette.textSecond : Palette.text)
                    .strikethrough(item.homework?.isDone == true, color: Palette.textSecond)
                if let sub = item.subtitle, !sub.isEmpty {
                    Text(sub).font(Typography.caption).foregroundStyle(Palette.textSecond)
                }
            }
            Spacer(minLength: Space.sm)
            if let t = item.time {
                Text(t)
                    .font(Typography.mono(11.5))
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize()
            }
        }
        .padding(.vertical, Space.sm)
        .contentShape(Rectangle())
    }

    @ViewBuilder private var leading: some View {
        switch item.kind {
        case .homework:
            Button {
                guard let hw = item.homework else { return }
                Haptics.selection()
                Task { await store.toggleHomeworkDone(hw) }
            } label: {
                Image(systemName: item.homework?.isDone == true ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(item.homework?.isDone == true ? Palette.accent : Palette.textSecond)
            }
            .buttonStyle(.plain)
        case .deadline:
            icon("flag.fill", Palette.coral)
        case .event:
            icon("calendar", Palette.accent)
        }
    }

    private func icon(_ symbol: String, _ color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 22, height: 22)
    }
}
