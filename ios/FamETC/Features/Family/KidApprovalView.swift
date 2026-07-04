import SwiftUI

/// Top banner shown to a PARENT when kids are waiting to be let in — the native
/// counterpart to the web approval banner. A kid entered the family invite code
/// + name on their own device; approving here creates the kid profile and lets
/// them register a passkey. Driven by `AppStore.kidRequests` (polled app-wide),
/// and surfaced immediately when a `kid_access_request` push arrives.
struct KidApprovalBanner: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        if store.isParent && !store.kidRequests.isEmpty {
            VStack(spacing: Space.sm) {
                ForEach(store.kidRequests) { req in
                    KidApprovalRow(request: req)
                }
            }
            .padding(.horizontal, Space.md)
            .padding(.top, Space.sm)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

private struct KidApprovalRow: View {
    @Environment(AppStore.self) private var store
    let request: KidAccessRequest
    @State private var working = false

    var body: some View {
        HStack(spacing: Space.md) {
            Text("🙋").font(.system(size: 26))
            VStack(alignment: .leading, spacing: 2) {
                Text("\(request.name) wants to sign in")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Text("on \(request.deviceLabel ?? "a device")")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer(minLength: Space.sm)
            if working {
                ProgressView().tint(Palette.accent)
            } else {
                HStack(spacing: Space.xs) {
                    Button("Deny") { act { await store.denyKid(request.id) } }
                        .font(Typography.caption.weight(.bold))
                        .foregroundStyle(Palette.textSecond)
                        .padding(.horizontal, Space.sm).padding(.vertical, 6)
                        .background(Palette.bg, in: Capsule())
                    Button("Approve") { act { await store.approveKid(request.id) } }
                        .font(Typography.caption.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                        .padding(.horizontal, Space.md).padding(.vertical, 6)
                        .background(Palette.accent, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(Space.md)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Palette.accent, lineWidth: 2)
        )
        .cardShadow()
    }

    private func act(_ op: @escaping () async -> Void) {
        working = true
        Haptics.selection()
        Task { await op(); working = false }
    }
}
