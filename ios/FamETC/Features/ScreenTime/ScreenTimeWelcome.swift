import SwiftUI

// Parent Screen Time promo + full-screen welcome (docs/SCREEN-TIME-PLAN.md
// "Parent promo + welcome"). The promo sits at the very top of parent Today
// while no kid has Screen Time on; "Not now" hides it for 7 days on this device.
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

    /// Only once the overview has loaded (no flicker), and only while no kid has Screen Time on.
    private var eligible: Bool {
        guard store.isParent, !store.needsAuth, !store.kids.isEmpty, service.overview != nil else { return false }
        return !store.kids.contains { service.state(for: $0.id)?.policy.enabled == true }
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
                .sheet(item: $sheetKid) { ScreenTimeParentSheet(initialKidId: $0.id) }
                .onChange(of: store.me?.id) { _, _ in showWelcome = false; pendingKid = nil; sheetKid = nil }
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
                    Text("Set bedtime and daily time in two taps — then make a deal together.")
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
            Label("See how it works", systemImage: "arrow.right")
                .labelStyle(TrailingIconLabel())
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.frOnYou)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 44)
                .background(Palette.frYou, in: Capsule())
        }
        .buttonStyle(PressableStyle())
        .accessibilityHint("Explains Screen Time and how to set it up")
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
    /// Called with a kid id right before the cover closes; the host opens that kid's sheet.
    let onSetup: (String) -> Void
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var page = 0
    private let pageCount = 4

    private var bodyFont: Font { Theme.font(17, relativeTo: .body) }
    private var titleFont: Font { Theme.font(sizeClass == .regular ? 36 : 30, weight: .bold, relativeTo: .largeTitle) }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            TabView(selection: $page) {
                pageView(whatItDoes).tag(0)
                pageView(madeTogether).tag(1)
                pageView(anyPhone).tag(2)
                pageView(howToSetUp).tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            footer
        }
        .background(ScreenBackground())
        .accessibilityIdentifier("screentime.welcome")
    }

    // MARK: Chrome

    private var topBar: some View {
        HStack(spacing: Space.md) {
            HStack(spacing: 6) {
                ForEach(0..<pageCount, id: \.self) { i in
                    Capsule()
                        .fill(i == page ? Palette.frYou : Palette.frRule)
                        .frame(width: i == page ? 22 : 8, height: 8)
                }
            }
            .animation(Motion.maybe(Motion.snappy, reduceMotion: reduceMotion), value: page)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Page \(page + 1) of \(pageCount)")
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.text)
                    .frame(width: 44, height: 44)
                    .background(Palette.frCard, in: Circle())
                    .overlay(Circle().strokeBorder(Palette.frRule, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, Space.xl)
        .padding(.top, Space.sm)
        .frame(maxWidth: 600)
    }

    private var footer: some View {
        HStack(spacing: Space.md) {
            if page > 0 {
                Button { go(page - 1) } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.text)
                        .frame(width: 54, height: 54)
                        .background(Palette.frCard, in: Circle())
                        .overlay(Circle().strokeBorder(Palette.frRule, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back")
            }
            if page < pageCount - 1 {
                WelcomeButton(title: "Next", systemImage: "arrow.right") { go(page + 1) }
            } else {
                Button("Maybe later") { dismiss() }
                    .font(bodyFont.weight(.medium))
                    .foregroundStyle(Palette.textSecond)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Space.xl)
        .padding(.vertical, Space.md)
        .frame(maxWidth: 600)
    }

    private func go(_ target: Int) {
        Haptics.selection()
        withAnimation(Motion.maybe(Motion.gentle, reduceMotion: reduceMotion)) { page = target }
    }

    private func pageView(_ content: some View) -> some View {
        ScrollView {
            content
                .padding(.horizontal, Space.xl)
                .padding(.vertical, Space.lg)
                .frame(maxWidth: 600, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func header(_ eyebrow: String, _ title: String, _ lead: String) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text(eyebrow.uppercased())
                .font(Typography.sectionLabel)
                .tracking(0.8)
                .foregroundStyle(Palette.frYouInk)
            Text(title)
                .font(titleFont)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(lead)
                .font(bodyFont)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ icon: String, _ tint: Color, _ soft: Color, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: Space.md) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 46, height: 46)
                .background(soft, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typography.itemTitle).foregroundStyle(Palette.text)
                Text(detail).font(bodyFont).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func panel(@ViewBuilder _ content: () -> some View) -> some View {
        let rows = content()
        return Card(padding: Space.lg) {
            VStack(alignment: .leading, spacing: Space.lg) { rows }
        }
    }

    // MARK: 1 · What it does

    private var whatItDoes: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            ScreenTimeBadge(size: 72).padding(.top, Space.sm)
            header("Screen Time", "Two simple rules", "Turn on one or both. You can change them any time.")
            panel {
                row("moon.stars.fill", Palette.frYouInk, Palette.frYouSoft,
                    "Bedtime", "No phone from 9 PM to 7 AM. Calls still work.")
                row("hourglass", Palette.frYouInk, Palette.frYouSoft,
                    "Daily screen time", "2 h on school days, 3 h on weekends.")
            }
            Text("When time is up, apps pause until tomorrow.")
                .font(bodyFont)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 2 · Made together

    private var madeTogether: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            header("Made together", "A deal, not a lock",
                   "You and your kid sit down and make a Screen Time deal on their phone. Rules they helped make are easier to keep.")
            panel {
                row("hand.raised.fill", Palette.frHwInk, Palette.frHwSoft,
                    "Your kid makes promises", "Like \u{201C}My phone charges outside my room at night.\u{201D}")
                row("heart.fill", Palette.frD3Ink, Palette.frD3Soft,
                    "You make promises too", "Like \u{201C}We\u{2019}ll give a 10-minute heads-up before bedtime.\u{201D}")
                row("checkmark.seal.fill", Palette.frHabInk, Palette.frHabSoft,
                    "You both sign", "Your kid picks a stamp and you add your name. It feels fair — because it is.")
            }
        }
    }

    // MARK: 3 · Any phone

    private var anyPhone: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            header("Works on any kid\u{2019}s phone", "Family Sharing or not",
                   "Family Sharing is Apple\u{2019}s way to link family phones. Screen Time works either way.")
            panel {
                row("lock.fill", Palette.frD3Ink, Palette.frD3Soft,
                    "With Family Sharing", "It\u{2019}s locked in. Your kid can\u{2019}t switch it off.")
                row("bell.badge.fill", Palette.frFamsInk, Palette.frFamsSoft,
                    "Without Family Sharing", "It still works. Your kid could switch it off — and Fam ETC tells you right away.")
            }
            Text("Not sure which you have? That\u{2019}s fine. Fam ETC works it out on your kid\u{2019}s phone.")
                .font(bodyFont)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 4 · How to set it up

    private var howToSetUp: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            header("How to set it up", "Three easy steps", "About two minutes, together with your kid.")
            panel {
                step(1, "Pick the rules here", "Turn on Bedtime, Daily screen time, or both.")
                step(2, "On your kid\u{2019}s phone, open Fam ETC", "Tap \u{201C}Make our Screen Time deal.\u{201D}")
                step(3, "Make the deal together", "Add your promises, approve it when the phone asks, and sign.")
            }
            if store.kids.isEmpty {
                Text("Add a kid in Settings first, then come back here to set up Screen Time.")
                    .font(bodyFont)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: Space.md) {
                    ForEach(store.kids) { kid in
                        WelcomeButton(title: "Set up for \(kid.name)", systemImage: "arrow.right") {
                            onSetup(kid.id)
                            dismiss()
                        }
                        .accessibilityIdentifier("screentime.welcome.setup.\(kid.id)")
                    }
                }
            }
        }
    }

    private func step(_ n: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: Space.md) {
            Text("\(n)")
                .font(Theme.font(20, weight: .bold, relativeTo: .title3))
                .foregroundStyle(Palette.frOnYou)
                .frame(width: 40, height: 40)
                .background(Palette.frYou, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(Typography.itemTitle).foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail).font(bodyFont).foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(n): \(title). \(detail)")
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
