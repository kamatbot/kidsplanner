import SwiftUI

/// Six large character boxes for the kid's setup code (docs/SCREEN-TIME-ONLY-PLAN.md D6): typed
/// or pasted, uppercase, alphabet `KidSetupCodeFormat.alphabet`, no camera. One real (but
/// invisible) text field sits over the boxes so the system keyboard, paste, and the
/// one-time-code suggestion all work; the boxes only draw what it holds.
struct KidCodeEntryView: View {
    @Binding var code: String
    var onSubmit: () -> Void = {}

    @FocusState private var focused: Bool

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

    private func box(_ index: Int) -> some View {
        let filled = index < characters.count
        let isCurrent = focused && index == min(characters.count, KidSetupCodeFormat.length - 1)
        return Text(filled ? String(characters[index]) : "")
            .font(Theme.font(30, weight: .bold, relativeTo: .largeTitle))
            .foregroundStyle(Palette.text)
            .minimumScaleFactor(0.6)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                    .strokeBorder(isCurrent ? Palette.accent : Palette.border, lineWidth: isCurrent ? 2 : 1)
            )
    }
}
