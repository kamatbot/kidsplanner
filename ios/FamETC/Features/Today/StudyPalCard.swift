import SwiftUI

/// A device-local, per-account preference. No child activity or private data
/// is persisted. Static artwork respects reduced motion without special cases.
struct StudyPalCard: View {
    @Environment(AppStore.self) private var store
    private let userID: String
    @Environment(\.dynamicTypeSize) private var textSize
    @AppStorage private var hidden: Bool

    init(userID: String) {
        self.userID = userID
        _hidden = AppStorage(wrappedValue: false, "fam_study_pal_hidden:\(userID)")
    }

    private var layout: AnyLayout {
        textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.sm))
            : AnyLayout(HStackLayout(alignment: .center, spacing: Space.md))
    }

    var body: some View {
        Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.sm) {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        title
                        Spacer(minLength: Space.sm)
                        visibilityButton
                    }
                    VStack(alignment: .leading) { title; visibilityButton }
                }
                if !hidden {
                    layout {
                        Image("KokoStudyPal")
                            .resizable().scaledToFit()
                            .frame(width: 104, height: 104)
                            .accessibilityLabel("Koko, a small-clawed otter with round glasses, beside an open book")
                        VStack(alignment: .leading, spacing: Space.xs) {
                            Text("Welcome back. Koko’s here.")
                                .font(Typography.cardTitle)
                                .foregroundStyle(Palette.text)
                            Text("Take things at your own pace. One small step is enough.")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var title: some View {
        Text("Your study pal").font(Typography.cardTitle)
            .foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
    }

    private var visibilityButton: some View {
        Button {
            guard store.me?.role == "kid", store.me?.id == userID else { return }
            hidden.toggle()
        } label: {
            Text(hidden ? "Show Koko" : "Hide Koko")
                .font(Typography.body)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.accent)
            .accessibilityValue(hidden ? "Hidden" : "Shown")
            .accessibilityIdentifier("today.studyPal.toggle")
    }
}
