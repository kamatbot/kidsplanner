import SwiftUI

/// Shared chrome for a native surface: themed background, large title, scrollable
/// content column with consistent gutters. Keeps every screen visually aligned.
struct SurfaceScaffold<Content: View, Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Space.lg) {
                    if !title.isEmpty || subtitle != nil {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: Space.xs) {
                                if !title.isEmpty {
                                    Text(title)
                                        .font(Typography.largeTitle)
                                        .foregroundStyle(Palette.text)
                                }
                                if let subtitle {
                                    Text(subtitle)
                                        .font(Typography.body)
                                        .foregroundStyle(Palette.textSecond)
                                }
                            }
                            Spacer(minLength: Space.md)
                            trailing()
                        }
                        .padding(.top, Space.sm)
                    }

                    content()
                }
                .padding(Space.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentMargins(.bottom, Layout.tabBarClearance, for: .scrollContent)
        }
    }
}

/// Convenience: a scaffold with no trailing accessory (the common case).
extension SurfaceScaffold where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, trailing: { EmptyView() }, content: content)
    }
}

/// Phase-0 placeholder body for surfaces whose full native build lands in a later
/// phase. Shows one live figure from the store to prove the data layer is wired.
struct ComingSoonCard: View {
    let phase: String
    let liveLabel: String
    let liveValue: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(spacing: Space.sm) {
                    KPILabel(text: liveLabel)
                    Spacer()
                    Text(phase)
                        .font(Typography.monoSmall)
                        .foregroundStyle(Palette.accent)
                        .padding(.horizontal, Space.sm)
                        .padding(.vertical, 3)
                        .background(Palette.accentSoft, in: Capsule())
                }
                Text(liveValue)
                    .font(Typography.statNumber)
                    .foregroundStyle(Palette.text)
                Text("Full native surface arrives in this phase. Live data above confirms the store is connected.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
        }
    }
}
