import SwiftUI

// Parent Screen Time promo + full-screen welcome (docs/SCREEN-TIME-PLAN.md
// "Parent promo + welcome"). The promo sits at the very top of parent Today
// while no kid has ever set Screen Time up (docs/SCREEN-TIME-UX.md §1) — turning
// it off never brings it back; "Not now" hides it for 7 days on this device.
// Plain words for non-technical parents — no Apple jargon anywhere.

// MARK: - Promo card (parent Today, top)

struct ScreenTimePromoCard: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("fam_st_promo_snoozed_until") private var snoozedUntil: Double = 0
    @State private var showWelcome = false
    @State private var pendingKid: String?
    @State private var sheetKid: SheetKid?
    private var service: ScreenTimeService { .shared }

    private struct SheetKid: Identifiable { let id: String }

    /// Only once the overview has loaded (no flicker), and only while no kid has ever had
    /// Screen Time saved (`policy.version == 0`). Off, waiting etc. never bring it back.
    private var eligible: Bool {
        guard store.isParent, !store.needsAuth, !store.kids.isEmpty, service.overview != nil else { return false }
        return !store.kids.contains { kid in
            guard let policy = service.state(for: kid.id)?.policy else { return false }
            return policy.version > 0 || policy.enabled
        }
    }

    private var snoozed: Bool { snoozedUntil > Date().timeIntervalSince1970 }

    var body: some View {
        // Stay mounted while the welcome or the sheet it opened is up: saving the first
        // rule makes the promo ineligible, and removing it would yank the sheet away.
        if (eligible && !snoozed) || showWelcome || pendingKid != nil || sheetKid != nil {
            card
                .fullScreenCover(isPresented: $showWelcome, onDismiss: {
                    if let id = pendingKid { sheetKid = SheetKid(id: id) }
                    pendingKid = nil
                }) {
                    ScreenTimeWelcomeView(onSetup: { pendingKid = $0 })
                }
                .screenTimeControlsCover(item: $sheetKid) { ScreenTimeParentSheet(initialKidId: $0.id) }
                .onChange(of: store.me?.id) { _, _ in showWelcome = false; pendingKid = nil; sheetKid = nil }
                .onChange(of: store.needsAuth) { _, needsAuth in
                    if needsAuth { showWelcome = false; pendingKid = nil; sheetKid = nil }
                }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack(alignment: .top, spacing: Space.md) {
                ScreenTimeBadge(size: 52)
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("New: Screen Time that kids agree to")
                        .font(sizeClass == .regular ? Typography.title : Typography.cardTitle)
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Choose bedtime and daily time, then set it up together on your child's device.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.md) { openButton; notNowButton }
                VStack(alignment: .leading, spacing: Space.xs) { openButton; notNowButton }
            }
        }
        .padding(Space.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: sizeClass == .regular ? Radius.cardLarge : Radius.card, style: .continuous)
                .fill(Palette.frYouSoft)
                .overlay(RoundedRectangle(cornerRadius: sizeClass == .regular ? Radius.cardLarge : Radius.card, style: .continuous)
                    .strokeBorder(Palette.frYou.opacity(0.3), lineWidth: 1))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screentime.promo")
    }

    private var openButton: some View {
        Button {
            Haptics.impact(.light)
            showWelcome = true
        } label: {
            Label("Set up Screen Time", systemImage: "arrow.right")
                .labelStyle(TrailingIconLabel())
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frOnYou)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 44)
                .background(Palette.frYou, in: Capsule())
        }
        .buttonStyle(PressableStyle())
        .accessibilityHint("Choose a child to set up Screen Time together")
        .accessibilityIdentifier("screentime.promo.open")
    }

    private var notNowButton: some View {
        Button("Not now") {
            Haptics.selection()
            snoozedUntil = Date().addingTimeInterval(7 * 24 * 3600).timeIntervalSince1970
        }
        .font(Typography.body.weight(.medium))
        .foregroundStyle(Palette.frYouInk)
        .padding(.horizontal, Space.sm)
        .frame(minHeight: 44)
        .buttonStyle(.plain)
        .accessibilityHint("Hides this for a week")
        .accessibilityIdentifier("screentime.promo.notNow")
    }
}

/// Violet hourglass with a small moon — the Screen Time motif.
private struct ScreenTimeBadge: View {
    let size: CGFloat

    var body: some View {
        Image(systemName: "hourglass")
            .font(.system(size: size * 0.42, weight: .medium))
            .foregroundStyle(Palette.frOnYou)
            .frame(width: size, height: size)
            .background(Palette.frYou, in: Circle())
            .overlay(alignment: .topTrailing) {
                Image(systemName: "moon.stars.fill")
                    .font(.system(size: size * 0.22, weight: .medium))
                    .foregroundStyle(Palette.frYouInk)
                    .frame(width: size * 0.44, height: size * 0.44)
                    .background(Palette.frCard, in: Circle())
                    .offset(x: size * 0.1, y: -size * 0.1)
            }
            .accessibilityHidden(true)
    }
}

private struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Space.sm) { configuration.title; configuration.icon }
    }
}

// MARK: - Full-screen welcome

struct ScreenTimeWelcomeView: View {
    let onSetup: (String) -> Void
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Space.lg) {
                    ScreenTimeBadge(size: 64)
                    Text("Set up Screen Time together")
                        .font(Theme.font(sizeClass == .regular ? 36 : 30, weight: .bold, relativeTo: .largeTitle))
                        .foregroundStyle(Palette.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("Choose bedtime and daily time here. Then use your child's device together to approve access and sign your family deal.")
                        .font(Typography.body)
                        .foregroundStyle(Palette.textSecond)
                    Text("Rules are ready only when the child's device confirms them.")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    if store.kids.isEmpty {
                        Text("Add a child in Settings, then return here to set up Screen Time.")
                            .font(Typography.body)
                            .foregroundStyle(Palette.textSecond)
                    } else {
                        ForEach(store.kids) { kid in
                            WelcomeButton(title: "Set up for \(kid.name)", systemImage: "arrow.right") {
                                onSetup(kid.id)
                                dismiss()
                            }
                            .accessibilityIdentifier("screentime.welcome.setup.\(kid.id)")
                        }
                    }
                    Button("Maybe later") { dismiss() }
                        .font(Typography.body)
                        .frame(minHeight: 44)
                        .foregroundStyle(Palette.textSecond)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(Space.xl)
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(ScreenBackground())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.frame(minHeight: 44)
                }
            }
        }
        .accessibilityIdentifier("screentime.welcome")
    }
}

/// Tall violet capsule — the welcome's primary action.
private struct WelcomeButton: View {
    let title: String
    var systemImage: String? = nil
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.impact(.medium)
            action()
        } label: {
            HStack(spacing: Space.sm) {
                Text(title)
                if let systemImage { Image(systemName: systemImage) }
            }
            .font(Typography.cardTitle)
            .foregroundStyle(Palette.frOnYou)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Palette.frYou, in: Capsule())
        }
        .buttonStyle(PressableStyle())
    }
}
