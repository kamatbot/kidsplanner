import SwiftUI

// Shared building blocks for the onboarding flow (parent + kid): a size-class adaptive
// page (iPhone: full screen; iPad: a centred ~560 pt card on the app background),
// buttons, a text field and the error wording. Everything uses the design-system tokens
// (Palette / Typography / Space / Radius) and Dynamic Type-relative fonts, so nothing here
// is a fixed-size layout.

/// Accessibility identifiers for the onboarding screens (UI tests + VoiceOver rotor targets).
enum OnbID {
    // The welcome "Set up Fam ETC" button keeps the identifier of the old "I'm a parent"
    // button because existing UI tests (MyCornerUITests) look the welcome screen up by it.
    static let welcomeSetUp = "I'm a parent"
    static let welcomeAccount = "onb.welcome.account"
    static let welcomeKid = "onb.welcome.kid"
    static let welcomeBackup = "onb.welcome.backup"
    static let back = "onb.back"
    static let chooseScreenTime = "onb.choose.screentime"
    static let chooseFull = "onb.choose.full"
    static let chooseInvite = "onb.choose.invite"
    static let chooseContinue = "onb.choose.continue"
    static let accountName = "onb.account.name"
    static let accountPasskey = "onb.account.passkey"
    static let familyName = "onb.family.name"
    static let familyCreate = "onb.family.create"
    static let familyJoinToggle = "onb.family.joinToggle"
    static let familyJoinCode = "onb.family.joinCode"
    static let familyJoin = "onb.family.join"
    static let kidsName = "onb.kids.name"
    static let kidsAdd = "onb.kids.add"
    static let kidsContinue = "onb.kids.continue"
    static let kidsSkip = "onb.kids.skip"
    static let notificationsEnable = "onb.notifications.enable"
    static let notificationsSkip = "onb.notifications.skip"
    static let devicesLater = "onb.devices.later"
    static let kidCode = "onb.kid.code"
    static let kidCodeContinue = "onb.kid.code.continue"
    static let kidConfirm = "onb.kid.confirm"
    static let kidNotYou = "onb.kid.notYou"
    static let kidLegacy = "onb.kid.legacy"
    static let kidPasskey = "onb.kid.passkey"
    static let kidContinueWithout = "onb.kid.continueWithout"
}

// MARK: - Page

struct OnbBrand: View {
    var body: some View {
        HStack(spacing: Space.sm) {
            Text("✨").font(Theme.font(18, relativeTo: .headline)).accessibilityHidden(true)
            Text("Fam ETC")
                .font(Theme.font(18, weight: .bold, relativeTo: .headline))
                .foregroundStyle(Palette.text)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One onboarding screen: brand header (+ optional Back), then the content. On a regular
/// width (iPad) the content sits in a centred card at most 560 pt wide (600 when playful);
/// on a compact width it fills the screen. Always scrolls, so large Dynamic Type never clips.
///
/// The "Sticker adventure" options (OnbPlayKit): `hero` puts a sticker above the content
/// in `hue`; `playful` (kid screens) makes it big, centred and paints the page with that
/// hue; `step`/`steps` show the parent setup progress under the header.
struct OnbPage<Content: View>: View {
    var onBack: (() -> Void)? = nil
    var hero: OnbSticker? = nil
    var hue: OnbHue = .violet
    var playful = false
    /// 1-based position in the parent setup steps; nil hides the progress bar.
    var step: Int? = nil
    var steps: Int = 0
    /// A smaller hero on iPhone for screens that open the keyboard (so the action stays visible).
    var compactHero: CGFloat? = nil
    @ViewBuilder var content: () -> Content

    @Environment(\.horizontalSizeClass) private var sizeClass
    private var regular: Bool { sizeClass == .regular }

    private var heroSize: CGFloat {
        if !regular, let compactHero { return compactHero }
        if playful { return regular ? 250 : 176 }
        return regular ? 128 : 108
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: Space.xl) {
                    VStack(alignment: .leading, spacing: Space.md) {
                        HStack(alignment: .center) {
                            OnbBrand()
                            Spacer(minLength: Space.md)
                            if let onBack {
                                Button(action: onBack) {
                                    Label("Back", systemImage: "chevron.left")
                                        .font(Typography.body.weight(.semibold))
                                        .foregroundStyle(Palette.textSecond)
                                        .frame(minHeight: 44)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier(OnbID.back)
                            }
                        }
                        if let step, steps > 0 {
                            OnbStepProgress(current: step, total: steps)
                        }
                    }
                    if let hero {
                        // New identity per sticker, so each kid stage's sticker lands afresh.
                        OnbStickerHero(sticker: hero, hue: hue, size: heroSize, tilt: playful ? -6 : -4)
                            .id(hero)
                            .padding(.vertical, playful ? Space.sm : 0)
                    }
                    content()
                }
                .padding(regular ? 40 : Space.xl)
                .frame(maxWidth: regular ? (playful ? 680 : 560) : .infinity, alignment: .topLeading)
                .background {
                    if regular {
                        RoundedRectangle(cornerRadius: Radius.cardLarge, style: .continuous)
                            .fill(Palette.frCard)
                            .shadow(color: Color.black.opacity(0.06), radius: 14, x: 0, y: 10)
                    }
                }
                .padding(.vertical, regular ? 32 : 0)
                .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: regular ? .center : .top)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .background {
            if playful { OnbWash(hue: hue) }
        }
    }
}

struct OnbTitle: View {
    let title: String
    var subtitle: String? = nil
    /// Kid screens: centred under the sticker.
    var centered = false
    /// Kid screens use 34 so the heading reads first.
    var size: CGFloat = 30

    @Environment(\.horizontalSizeClass) private var sizeClass
    /// Kid (centred) headings step up on iPad, where kids mostly use the app.
    private var titleSize: CGFloat { centered && sizeClass == .regular ? size * 1.2 : size }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: Space.sm) {
            Text(title)
                .font(Theme.font(titleSize, weight: .bold, relativeTo: .largeTitle))
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(centered ? .center : .leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .font(centered ? Theme.font(17, relativeTo: .body) : Typography.body)
                    .foregroundStyle(Palette.textSecond)
                    .multilineTextAlignment(centered ? .center : .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }
}

// MARK: - Buttons

struct OnbPrimaryButton: View {
    let title: String
    var busy = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Space.sm) {
                if busy { ProgressView().tint(Palette.onAccent) }
                Text(title)
                    .font(Theme.font(17, weight: .bold, relativeTo: .headline))
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(Palette.onAccent)
            .frame(maxWidth: .infinity, minHeight: 56)
            .padding(.horizontal, Space.lg)
            .background(Palette.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .opacity(enabled && !busy ? 1 : 0.55)
        .disabled(!enabled || busy)
    }
}

struct OnbSecondaryButton: View {
    let title: String
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.font(17, weight: .bold, relativeTo: .headline))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.accent)
                .frame(maxWidth: .infinity, minHeight: 56)
                .padding(.horizontal, Space.lg)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.accent, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.55)
        .disabled(!enabled)
    }
}

/// A quiet text button (footers, "Skip", "Not you?").
struct OnbLinkButton: View {
    let title: String
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typography.body.weight(.semibold))
                .foregroundStyle(Palette.textSecond)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

// MARK: - Fields

struct OnbTextField: View {
    let title: String
    let prompt: String
    @Binding var text: String
    var contentType: UITextContentType? = nil
    var capitalization: TextInputAutocapitalization = .sentences
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}
    var identifier: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(title)
                .font(Typography.label.weight(.medium))
                .foregroundStyle(Palette.textSecond)
            TextField(prompt, text: $text)
                .textContentType(contentType)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled()
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 52)
                .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
                .accessibilityLabel(title)
                .onbIdentifier(identifier)
        }
    }
}

struct OnbErrorText: View {
    let message: String

    var body: some View {
        Text(message)
            .font(Typography.label)
            .foregroundStyle(Palette.red)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isStaticText)
    }
}

extension View {
    /// The bordered surface used for grouped fields and the plan cards.
    func onbPanel(selected: Bool = false) -> some View {
        self
            .padding(Space.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(selected ? Palette.accent : Palette.border, lineWidth: selected ? 2 : 1)
            )
    }
}

// MARK: - Errors

enum OnbErrors {
    static func isCancellation(_ error: Error) -> Bool {
        (error as? AuthError)?.isCancellation == true
    }

    /// Plain-language wording for anything the onboarding calls can throw.
    static func friendly(_ error: Error) -> String {
        if let e = error as? AuthError {
            switch e {
            case .verify(let m): return m
            case .options: return "Couldn't start. Check your connection and try again."
            case .registration: return "The passkey didn't come through. Please try again."
            case .unsupported: return "Passkeys aren't available on this device."
            case .cancelled: return "Cancelled."
            }
        }
        if let e = error as? AuthServerError { return e.message }
        let msg = error.localizedDescription
        if msg.localizedCaseInsensitiveContains("webcredentials") || msg.localizedCaseInsensitiveContains("associated domain") {
            return "Passkey sign-in isn't available on this build. Use a backup code instead."
        }
        if msg.localizedCaseInsensitiveContains("AuthorizationError") {
            return "This device couldn't make a passkey. Check that iCloud Keychain is on, then try again."
        }
        return msg
    }
}
