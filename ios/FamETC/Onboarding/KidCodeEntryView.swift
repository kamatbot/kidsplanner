import SwiftUI

/// Six large character boxes for the kid's setup code (docs/SCREEN-TIME-ONLY-PLAN.md D6): typed
/// or pasted, uppercase, alphabet `KidSetupCodeFormat.alphabet`, no camera. One real (but
/// invisible) text field sits over the boxes so the system keyboard, paste, and the
/// one-time-code suggestion all work; the boxes only draw what it holds.
struct KidCodeEntryView: View {
    @Binding var code: String
    var onSubmit: () -> Void = {}

    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var characters: [Character] { Array(code) }

    /// "A, B, C" so VoiceOver reads the code letter by letter.
    private var spokenValue: String {
        characters.isEmpty ? "Empty" : characters.map(String.init).joined(separator: ", ")
    }

    var body: some View {
        ZStack {
            HStack(spacing: Space.sm) {
                ForEach(0..<KidSetupCodeFormat.length, id: \.self) { index in
                    box(index)
                }
            }
            .accessibilityHidden(true)
            .allowsHitTesting(false)

            // Invisible input on top: it owns focus, the keyboard and paste.
            TextField("", text: $code)
                .keyboardType(.asciiCapable)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .textContentType(.oneTimeCode)
                .submitLabel(.go)
                .focused($focused)
                .foregroundStyle(Color.clear)
                .tint(Color.clear)
                .frame(maxWidth: .infinity, minHeight: 64)
                .contentShape(Rectangle())
                .onSubmit(onSubmit)
                .onChange(of: code) { _, newValue in
                    let cleaned = KidSetupCodeFormat.normalize(newValue)
                    if cleaned != newValue { code = cleaned }
                }
                .accessibilityLabel("Setup code, \(KidSetupCodeFormat.length) characters")
                .accessibilityValue(spokenValue)
                .accessibilityIdentifier(OnbID.kidCode)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .onAppear { focused = true }
    }

    /// Chunky tiles, each filled one in its own Family Rings hue; the next empty one is outlined violet.
    private func box(_ index: Int) -> some View {
        let filled = index < characters.count
        let isCurrent = focused && index == min(characters.count, KidSetupCodeFormat.length - 1) && !filled
        let hue = OnbHue.allCases[index % OnbHue.allCases.count]
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return Text(filled ? String(characters[index]) : "")
            .font(Theme.font(32, weight: .heavy, relativeTo: .largeTitle))
            .foregroundStyle(filled ? hue.ink : Palette.text)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(filled ? hue.soft : Palette.frCard, in: shape)
            .overlay(
                shape.strokeBorder(filled ? hue.strong : (isCurrent ? Palette.frYou : Palette.frRule),
                                   lineWidth: filled ? 2 : (isCurrent ? 2.5 : 1.5))
            )
            // A tile pops once when its character lands. Keyed to the tile's own filled
            // state, so typing never writes extra view state (fast typing keeps every key).
            .keyframeAnimator(initialValue: 1.0, trigger: filled) { tile, scale in
                tile.scaleEffect(scale)
            } keyframes: { _ in
                if filled && !reduceMotion {
                    CubicKeyframe(1.12, duration: 0.09)
                    SpringKeyframe(1.0, duration: 0.3, spring: .bouncy)
                } else {
                    LinearKeyframe(1.0, duration: 0.01)
                }
            }
    }
}
