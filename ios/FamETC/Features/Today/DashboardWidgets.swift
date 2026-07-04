import SwiftUI

/// A colorful tinted widget card — the building block of the Today dashboard,
/// matching the web app's widgets grid. Each widget picks a distinct tint.
struct DashCard<Content: View>: View {
    let icon: String
    let title: String
    let tint: Color
    let content: Content

    init(_ icon: String, _ title: String, tint: Color, @ViewBuilder content: () -> Content) {
        self.icon = icon; self.title = title; self.tint = tint; self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            HStack(spacing: 6) {
                Text(icon).font(.system(size: 16))
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.5)
                    .foregroundStyle(tint)
            }
            content
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(tint.opacity(0.28), lineWidth: 1)
        )
    }
}

// MARK: - Daily content widgets (ported from the web widgets grid)

struct QuoteWidget: View {
    var body: some View {
        let q = Daily.quote
        return DashCard("💬", "Quote of the Day", tint: Palette.coral) {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("“\(q.text)”")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text("— \(q.author)").font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
        }
    }
}

struct WordWidget: View {
    var body: some View {
        let w = Daily.word
        return DashCard("📖", "SAT Word of the Day", tint: Palette.teal) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(w.word).font(Typography.title).foregroundStyle(Palette.text)
                    Text(w.pos).font(Typography.caption.italic()).foregroundStyle(Palette.textSecond)
                }
                Text(w.def).font(Typography.body).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text("“\(w.example)”").font(Typography.caption).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct FactWidget: View {
    var body: some View {
        let f = Daily.fact
        return DashCard(f.icon, "\(f.type) Fact", tint: Palette.amber) {
            Text(f.text).font(Typography.body).foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NewsWidget: View {
    var body: some View {
        let n = Daily.news
        return DashCard("📰", "Interesting News", tint: Palette.green) {
            VStack(alignment: .leading, spacing: 6) {
                Text(n.cat)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Palette.green)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Palette.green.opacity(0.16), in: Capsule())
                Text(n.headline).font(Typography.body.weight(.bold)).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(n.summary).font(Typography.caption).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct QuizWidget: View {
    @State private var index = Daily.quizStartIndex
    @State private var picked: Int? = nil

    private var q: QuizQuestion { Daily.quiz[index % Daily.quiz.count] }

    var body: some View {
        DashCard("🧠", "Daily Brain Teaser", tint: Palette.violet) {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text(q.q).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(q.opts.indices, id: \.self) { i in
                    Button {
                        guard picked == nil else { return }
                        Haptics.selection()
                        withAnimation(.easeOut(duration: 0.2)) { picked = i }
                    } label: {
                        HStack {
                            Text(q.opts[i]).font(Typography.body).foregroundStyle(Palette.text)
                            Spacer(minLength: Space.sm)
                            if picked != nil && i == q.ans {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.green)
                            } else if picked == i {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.red)
                            }
                        }
                        .padding(.horizontal, Space.md).padding(.vertical, Space.sm)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(optionBackground(i), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(picked != nil)
                }
                if picked != nil {
                    Text(q.exp).font(Typography.caption).foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Next question →") {
                        withAnimation { index = (index + 1) % Daily.quiz.count; picked = nil }
                    }
                    .font(Typography.caption.weight(.bold)).foregroundStyle(Palette.violet)
                }
            }
        }
    }

    private func optionBackground(_ i: Int) -> Color {
        guard picked != nil else { return Palette.panel }
        if i == q.ans { return Palette.green.opacity(0.18) }
        if i == picked { return Palette.red.opacity(0.15) }
        return Palette.panel
    }
}
