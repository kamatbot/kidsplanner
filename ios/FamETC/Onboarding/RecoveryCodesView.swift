import SwiftUI

/// Reusable screen that displays a set of one-time recovery codes and lets the
/// user copy or share them before moving on. Shown twice in the app:
///   • right after passkey sign-up (the codes the server mints once), and
///   • after regenerating codes from Profile → Recovery codes.
///
/// Built on the shared design system (Palette / Typography / Card) so it reads
/// correctly in both the light onboarding flow and the themed settings sheet.
/// The codes are never persisted by the app — the user is the only copy.
struct RecoveryCodesView: View {
    /// The plaintext recovery codes to display (typically 10).
    let codes: [String]
    /// Optional override for the primary button label.
    var primaryTitle: String = "I’ve saved them — Continue"
    /// Called when the user taps the primary button (dismiss / continue).
    let onDone: () -> Void

    @State private var copied = false

    /// All codes on their own line — the payload for copy and share.
    private var joined: String { codes.joined(separator: "\n") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.xl) {
                header
                warning
                codeGrid
                actions
            }
            .padding(.horizontal, Space.xl)
            .padding(.top, Space.xxl)
            .padding(.bottom, Space.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.bg.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            doneButton
                .padding(.horizontal, Space.xl)
                .padding(.top, Space.md)
                .padding(.bottom, Space.lg)
                .background(.ultraThinMaterial)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Image(systemName: "key.horizontal.fill")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Palette.accent)
                .frame(width: 52, height: 52)
                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))

            Text("Your recovery codes")
                .font(Typography.title)
                .foregroundStyle(Palette.text)

            Text("Save your recovery codes. If you lose access to your passkey, one of these is the only way back into your account.")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Warning

    private var warning: some View {
        HStack(alignment: .top, spacing: Space.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Palette.warn)
            Text("These won’t be shown again. Store them somewhere safe — each code works once.")
                .font(Typography.label)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.lg)
        .background(Palette.warn.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                .strokeBorder(Palette.warn.opacity(0.30), lineWidth: 1)
        )
    }

    // MARK: Codes

    private var codeGrid: some View {
        Card(padding: Space.lg) {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: Space.md), GridItem(.flexible(), spacing: Space.md)],
                alignment: .leading,
                spacing: Space.sm
            ) {
                ForEach(Array(codes.enumerated()), id: \.offset) { _, code in
                    Text(code)
                        .font(Typography.mono(15, .medium))
                        .foregroundStyle(Palette.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, Space.sm)
                        .padding(.horizontal, Space.md)
                        .background(Palette.bg, in: RoundedRectangle(cornerRadius: Radius.chip, style: .continuous))
                }
            }
        }
    }

    // MARK: Copy / Share

    private var actions: some View {
        HStack(spacing: Space.md) {
            Button(action: copy) {
                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .font(Typography.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .foregroundStyle(Palette.accent)
                    .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
            .buttonStyle(.plain)

            ShareLink(item: joined) {
                Label("Share", systemImage: "square.and.arrow.up")
                    .font(Typography.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .foregroundStyle(Palette.accent)
                    .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Done

    private var doneButton: some View {
        Button(action: { Haptics.notify(.success); onDone() }) {
            Text(primaryTitle)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Palette.onAccent)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(Palette.accent, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func copy() {
        UIPasteboard.general.string = joined
        Haptics.selection()
        withAnimation(.easeInOut(duration: 0.2)) { copied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation(.easeInOut(duration: 0.2)) { copied = false }
        }
    }
}
