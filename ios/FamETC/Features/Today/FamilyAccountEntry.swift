import SwiftUI

/// App Store 5.1.1(v): every signed-in user can reach sign out, and parents can delete their
/// account, from the full-plan Today screen. Parents open Family & account (the same native
/// settings the Screen Time plan uses); kids only get a confirmed sign-out.
enum FamilyAccountEntryKind: Equatable {
    case familyAndAccount, signOut

    init(isParent: Bool) { self = isParent ? .familyAndAccount : .signOut }

    var title: String { self == .familyAndAccount ? "Family & account" : "Sign out" }
    var systemImage: String { self == .familyAndAccount ? "person.2" : "rectangle.portrait.and.arrow.right" }
}

struct FamilyAccountEntry: View {
    @Environment(AppStore.self) private var store
    @Environment(\.famSignOut) private var signOut
    @State private var showSettings = false
    @State private var confirmSignOut = false

    private var kind: FamilyAccountEntryKind { FamilyAccountEntryKind(isParent: store.isParent) }

    var body: some View {
        if store.productPlan == .full, store.me != nil, !store.needsAuth {
            Button {
                Haptics.selection()
                if kind == .familyAndAccount { showSettings = true } else { confirmSignOut = true }
            } label: {
                Label(kind.title, systemImage: kind.systemImage)
                    .font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier(kind == .familyAndAccount ? "today.familyAccount" : "today.signOut")
            .sheet(isPresented: $showSettings) { FamilyAccountSheet() }
            .confirmationDialog("Sign out of Fam ETC?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { signOut() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("A grown-up will need to show you a new code to sign back in.")
            }
            .onChange(of: store.me?.id) { _, _ in showSettings = false }
            .onChange(of: store.needsAuth) { _, value in if value { showSettings = false } }
        }
    }
}

/// Family settings in a large sheet. Sign out and delete live inside, behind their own confirmations.
struct FamilyAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            FamilySettingsView()
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        .presentationDetents([.large])
        .tint(Palette.frYou)
    }
}
