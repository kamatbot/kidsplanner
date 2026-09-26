import SwiftUI

/// A device-local, per-account preference. No child activity or private data
/// is persisted. Static artwork respects reduced motion without special cases.
struct StudyPalCard: View {
    @Environment(AppStore.self) private var store
    private let userID: String
    private let onOpenStudy: () -> Void
    @Environment(\.dynamicTypeSize) private var textSize
    @AppStorage private var hidden: Bool

    init(userID: String, onOpenStudy: @escaping () -> Void = {}) {
        self.userID = userID
        self.onOpenStudy = onOpenStudy
        _hidden = AppStorage(wrappedValue: false, "fam_study_pal_hidden:\(userID)")
    }

    private var isCurrentKid: Bool {
        !store.needsAuth && store.me?.role == "kid" && store.me?.id == userID
    }

    private var layout: AnyLayout {
        textSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.sm))
            : AnyLayout(HStackLayout(alignment: .center, spacing: Space.md))
    }

    var body: some View {
        if isCurrentKid {
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
                        Button(action: onOpenStudy) {
                            layout {
                                Image("KokoStudyPal")
                                    .resizable().scaledToFit()
                                    .frame(width: 104, height: 104)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: Space.xs) {
                                    Text("Welcome back. Koko’s here.")
                                        .font(Typography.cardTitle)
                                        .foregroundStyle(Palette.frInk)
                                    Text("Take things at your own pace. One small step is enough.")
                                        .font(Typography.body)
                                        .foregroundStyle(Palette.frInk2)
                                    Label("Open study panel", systemImage: "arrow.right")
                                        .font(Typography.body.weight(.semibold))
                                        .foregroundStyle(Palette.frYouInk)
                                        .frame(minHeight: 44, alignment: .leading)
                                }
                                .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityIdentifier("today.studyPal.open")
                        .accessibilityLabel("Open Koko study panel")
                        .accessibilityHint("Find your next homework task, check in on your energy, or open My Corner")
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
            guard isCurrentKid else { return }
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
