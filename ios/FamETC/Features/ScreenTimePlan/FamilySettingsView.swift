import SwiftUI
import UIKit
import UserNotifications

// Family settings on the Screen Time plan (docs/SCREEN-TIME-ONLY-PLAN.md §4.1). Native, because
// the plan has no web Settings (fametc.com shows these families an "it lives in the app" page).
// Family name · parents (invite a co-parent) · kids (add, rename, remove, set up a device) ·
// sign-in and recovery codes · notifications · Get the whole Fam ETC · sign out · delete account.

struct FamilySettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.famSignOut) private var signOut

    @State private var setupKid: KidRoute?
    @State private var showAddKid = false
    @State private var renaming: Kid?
    @State private var renameText = ""
    @State private var removing: Kid?
    @State private var showUpgrade = false
    @State private var copiedCode = false
    @State private var notificationStatus: UNAuthorizationStatus?
    @State private var recoveryRemaining: Int?
    @State private var confirmNewCodes = false
    @State private var regenerating = false
    @State private var recoveryError: String?
    @State private var codesPayload: CodesPayload?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var deleteError: String?
    @State private var kidError: String?
    private var service: ScreenTimeService { .shared }

    private struct KidRoute: Identifiable { let id: String }
    private struct CodesPayload: Identifiable { let id = UUID(); let codes: [String] }

    private var familyCode: String? {
        guard let code = store.family?.inviteCode, !code.isEmpty else { return nil }
        return code
    }

    var body: some View {
        List {
            familySection
            parentsSection
            kidsSection
            securitySection
            notificationsSection
            if store.productPlan == .screenTime { upgradeSection }
            accountSection
        }
        .font(Typography.body)
        .scrollContentBackground(.hidden)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .background(ScreenBackground())
        .navigationTitle("Family")
        .navigationBarTitleDisplayMode(.large)
        .task {
            await loadNotificationStatus()
            recoveryRemaining = await AuthService.shared.backupCodesRemaining()
            if service.overview == nil { await service.loadOverview() }
        }
        .sheet(item: $setupKid) { route in
            NavigationStack {
                DeviceSetupChecklistView(kidIds: [route.id])
                    .navigationTitle("Set up a device")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { setupKid = nil } }
                    }
            }
            .tint(Palette.frYou)
        }
        .sheet(isPresented: $showAddKid) {
            AddKidSheet { added in
                // Offer the device setup once the add sheet has finished closing.
                Task {
                    await service.loadOverview()
                    try? await Task.sleep(for: .milliseconds(450))
                    setupKid = KidRoute(id: added.id)
                }
            }
            .tint(Palette.frYou)
        }
        .sheet(isPresented: $showUpgrade) { UpgradeView().tint(Palette.frYou) }
        .sheet(item: $codesPayload) { payload in
            RecoveryCodesView(codes: payload.codes, primaryTitle: "I've saved them") {
                codesPayload = nil
                Task { recoveryRemaining = await AuthService.shared.backupCodesRemaining() }
            }
        }
        .alert("Rename \(renaming?.name ?? "kid")", isPresented: Binding(
            get: { renaming != nil }, set: { if !$0 { renaming = nil } }
        )) {
            TextField("Name", text: $renameText)
            Button("Save") { saveRename() }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Remove \(removing?.name ?? "this kid")?", isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } }
        ), titleVisibility: .visible, presenting: removing) { kid in
            Button("Remove \(kid.name)", role: .destructive) { remove(kid) }
            Button("Cancel", role: .cancel) {}
        } message: { kid in
            Text("This removes \(kid.name)'s profile, sign-in, devices and Screen Time rules from Fam ETC. It can't be undone.")
        }
        .confirmationDialog("Make new recovery codes?", isPresented: $confirmNewCodes, titleVisibility: .visible) {
            Button("Make new codes") { regenerateCodes() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your old codes stop working. You'll see the new ones once, so save them somewhere safe.")
        }
        .confirmationDialog("Sign out of Fam ETC?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { signOut() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll sign back in with your passkey or a recovery code.")
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete my account", role: .destructive) { deleteAccount() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your account and passkeys. You can't undo it.")
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await loadNotificationStatus() }
        }
        .accessibilityIdentifier("screentimeplan.family")
    }

    // MARK: Family + parents

    private var familySection: some View {
        Section {
            LabeledContent("Family name") {
                Text(store.family?.name ?? "—")
                    .foregroundStyle(Palette.textSecond)
                    .multilineTextAlignment(.trailing)
            }
            .accessibilityElement(children: .combine)
        } header: { Text("Family") }
    }

    private var parentsSection: some View {
        Section {
            ForEach(store.family?.parents ?? []) { parent in
                HStack {
                    Image(systemName: "person.crop.circle")
                        .foregroundStyle(Palette.frInk2)
                        .accessibilityHidden(true)
                    Text(parentName(parent))
                        .foregroundStyle(Palette.text)
                    Spacer()
                    if parent.id == store.me?.id {
                        Text("You").font(Typography.label).foregroundStyle(Palette.textSecond)
                    }
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .combine)
            }
            if let code = familyCode { coParentRow(code) }
        } header: {
            Text("Parents")
        } footer: {
            if familyCode != nil {
                Text("Your co-parent installs Fam ETC, creates their own passkey, and enters this family code when asked. Only share it with them.")
            }
        }
    }

    private func parentName(_ parent: Parent) -> String {
        let name = parent.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Parent" : name
    }

    private func coParentRow(_ code: String) -> some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Text("Invite a co-parent").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
            Text(code)
                .font(Typography.mono(20, .semibold))
                .foregroundStyle(Palette.text)
                .textSelection(.enabled)
                .accessibilityLabel("Family code")
                .accessibilityValue(code.map(String.init).joined(separator: " "))
                .accessibilityIdentifier("screentimeplan.familyCode")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.sm) { coParentButtons(code) }
                VStack(alignment: .leading, spacing: Space.sm) { coParentButtons(code) }
            }
        }
        .padding(.vertical, Space.xs)
    }

    /// Two buttons in one List row: both use the borderless style so each taps on its own.
    @ViewBuilder
    private func coParentButtons(_ code: String) -> some View {
        ShareLink(item: "Join our family on Fam ETC. Install the app from \(ScreenTimePlanLinks.appStore.absoluteString), create your account, then choose “Joining your partner's family?” and enter our family code: \(code)",
                  subject: Text("Join our family on Fam ETC")) {
            PlanButtonLabel(title: "Share the family code", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("screentimeplan.shareFamilyCode")
        Button {
            Haptics.selection()
            UIPasteboard.general.string = code
            copiedCode = true
            Task {
                try? await Task.sleep(for: .seconds(2))
                copiedCode = false
            }
        } label: {
            PlanButtonLabel(title: copiedCode ? "Copied" : "Copy", systemImage: copiedCode ? "checkmark" : "doc.on.doc",
                            style: .quiet)
        }
        .buttonStyle(.borderless)
    }

    // MARK: Kids

    private var kidsSection: some View {
        Section {
            ForEach(store.kids) { kid in kidRow(kid) }
            if let kidError { PlanErrorLine(message: kidError) }
            Button {
                Haptics.selection()
                showAddKid = true
            } label: {
                Label("Add a kid", systemImage: "plus.circle.fill")
                    .frame(minHeight: 44, alignment: .leading)
            }
            .accessibilityIdentifier("screentimeplan.addKid")
        } header: {
            Text("Kids")
        } footer: {
            Text("Each kid gets their own sign-in on their own iPhone or iPad.")
        }
    }

    private func deviceSummary(_ kid: Kid) -> String {
        guard let state = service.state(for: kid.id) else { return "Screen Time" }
        let count = max(state.setup?.devices ?? 0, state.devices.count)
        return count == 0 ? "No device yet" : "\(count) device\(count == 1 ? "" : "s")"
    }

    private func kidRow(_ kid: Kid) -> some View {
        Menu {
            Button { setupKid = KidRoute(id: kid.id) } label: { Label("Set up a device", systemImage: "iphone") }
            Button {
                renameText = kid.name
                renaming = kid
            } label: { Label("Rename", systemImage: "pencil") }
            Button(role: .destructive) { removing = kid } label: { Label("Remove", systemImage: "trash") }
        } label: {
            HStack(spacing: Space.md) {
                KidProfileAvatar(kid: kid, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(kid.name).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text).lineLimit(1)
                    Text(deviceSummary(kid)).font(Typography.label).foregroundStyle(Palette.textSecond)
                }
                Spacer(minLength: Space.sm)
                Image(systemName: "ellipsis.circle")
                    .foregroundStyle(Palette.frInk2)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(kid.name)
        .accessibilityValue(deviceSummary(kid))
        .accessibilityHint("Opens options: set up a device, rename or remove")
        .accessibilityIdentifier("screentimeplan.kidRow.\(kid.id)")
    }

    private func saveRename() {
        guard let kid = renaming else { return }
        let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        guard !trimmed.isEmpty, trimmed != kid.name else { return }
        kidError = nil
        Task {
            await store.updateKid(kid.id, ["name": trimmed])
            if store.kids.first(where: { $0.id == kid.id })?.name != trimmed {
                kidError = "Couldn't rename \(kid.name). Try again."
            }
        }
    }

    private func remove(_ kid: Kid) {
        removing = nil
        kidError = nil
        Task {
            await store.deleteKid(kid.id)
            if store.kids.contains(where: { $0.id == kid.id }) {
                kidError = "Couldn't remove \(kid.name). Try again."
            } else {
                await service.loadOverview()
            }
        }
    }

    // MARK: Sign-in and recovery

    private var securitySection: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your passkey").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    Text("Your face, fingerprint or passcode signs you in. It's saved in your iCloud Keychain.")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } icon: {
                Image(systemName: "person.badge.key.fill").foregroundStyle(Palette.frYouInk)
            }
            .padding(.vertical, Space.xs)
            .accessibilityElement(children: .combine)
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack {
                    Text("Recovery codes").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    Spacer()
                    if let recoveryRemaining {
                        Text("\(recoveryRemaining) unused")
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                            .monospacedDigit()
                    }
                }
                Text("If you lose your passkey, one of these gets you back in. Each works once.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                if let recoveryError { PlanErrorLine(message: recoveryError) }
                PlanButton(title: "Make new recovery codes", systemImage: "key.horizontal", busy: regenerating) {
                    confirmNewCodes = true
                }
                .accessibilityIdentifier("screentimeplan.newRecoveryCodes")
            }
            .padding(.vertical, Space.xs)
        } header: { Text("Sign-in and recovery") }
    }

    private func regenerateCodes() {
        guard !regenerating else { return }
        regenerating = true
        recoveryError = nil
        Task {
            do {
                let codes = try await AuthService.shared.regenerateBackupCodes()
                if codes.isEmpty {
                    recoveryError = "Recovery codes aren't available right now. Try again later."
                } else {
                    codesPayload = CodesPayload(codes: codes)
                }
            } catch {
                recoveryError = error.localizedDescription
            }
            regenerating = false
        }
    }

    // MARK: Notifications

    private var notificationsSection: some View {
        Section {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text(notificationHeadline).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                Text("Get a nudge when a kid asks for more time or a device needs a look.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .fixedSize(horizontal: false, vertical: true)
                switch notificationStatus {
                case .notDetermined:
                    PlanButton(title: "Turn on notifications", systemImage: "bell.badge", style: .prominent) {
                        enableNotifications()
                    }
                case .denied, .authorized, .provisional, .ephemeral:
                    PlanButton(title: "Notification settings", systemImage: "gearshape") { openNotificationSettings() }
                default:
                    EmptyView()
                }
            }
            .padding(.vertical, Space.xs)
        } header: { Text("Notifications") }
    }

    private var notificationHeadline: String {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral: return "Notifications are on"
        case .denied: return "Notifications are off"
        default: return "Notifications"
        }
    }

    private func loadNotificationStatus() async {
        notificationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func enableNotifications() {
        Task {
            let granted = (try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted { PushRegistrationService.shared.requestAuthorizationAndRegister() }
            await loadNotificationStatus()
        }
    }

    private func openNotificationSettings() {
        let target = URL(string: UIApplication.openNotificationSettingsURLString)
            ?? URL(string: UIApplication.openSettingsURLString)
        if let target { UIApplication.shared.open(target) }
    }

    // MARK: Upgrade

    private var upgradeSection: some View {
        Section {
            Button {
                Haptics.selection()
                showUpgrade = true
            } label: {
                HStack(spacing: Space.md) {
                    Image(systemName: "sparkles")
                        .foregroundStyle(Palette.frYouInk)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Get the whole Fam ETC").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                        Text("Add the school calendar, homework and family chat.")
                            .font(Typography.label)
                            .foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: Space.sm)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.frInk3)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("screentimeplan.upgrade")
        }
    }

    // MARK: Account

    private var accountSection: some View {
        Section {
            Button("Sign out") { confirmSignOut = true }
                .frame(minHeight: 44)
                .accessibilityIdentifier("screentimeplan.signOut")
            if deleting {
                HStack(spacing: Space.sm) { ProgressView(); Text("Deleting your account…") }
                    .frame(minHeight: 44)
                    .foregroundStyle(Palette.textSecond)
            } else {
                Button("Delete my account", role: .destructive) { confirmDelete = true }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("screentimeplan.deleteAccount")
            }
            if let deleteError { PlanErrorLine(message: deleteError) }
        } header: {
            Text("Account")
        } footer: {
            Text("Deleting your account removes your sign-in and passkeys. Your family's kids and Screen Time rules stay with any other parent.")
        }
    }

    private func deleteAccount() {
        guard !deleting else { return }
        deleting = true
        deleteError = nil
        Task {
            do {
                try await APIClient.shared.deleteAccount()
                // The server has ended the session; sign out locally the same way as a normal sign-out.
                signOut()
            } catch {
                deleteError = error.localizedDescription
            }
            deleting = false
        }
    }
}

// MARK: - Add a kid

private struct AddKidSheet: View {
    let onAdded: (Kid) -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("First name", text: $name)
                        .textContentType(.givenName)
                        .submitLabel(.done)
                        .focused($focused)
                        .onSubmit { add() }
                        .onChange(of: name) { _, value in if value.count > 40 { name = String(value.prefix(40)) } }
                        .accessibilityIdentifier("addKid.name")
                } footer: {
                    Text("Adding a profile is your OK for this child to use Fam ETC. We keep only what's needed: a first name and their Screen Time.")
                }
                if let error {
                    Section { PlanErrorLine(message: error) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(ScreenBackground())
            .navigationTitle("Add a kid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(working) }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView() } else {
                        Button("Add") { add() }
                            .disabled(trimmed.isEmpty)
                            .accessibilityIdentifier("addKid.add")
                    }
                }
            }
            .onAppear { focused = true }
        }
        .interactiveDismissDisabled(working)
        .presentationDetents([.medium])
    }

    private func add() {
        guard !trimmed.isEmpty, !working else { return }
        working = true
        error = nil
        let kidName = trimmed
        let before = Set(store.kids.map(\.id))
        Task {
            await store.addKid(name: kidName, grade: "", color: "")
            if let added = store.kids.first(where: { !before.contains($0.id) }) {
                Haptics.notify(.success)
                dismiss()
                onAdded(added)
            } else {
                error = "Couldn't add \(kidName). Try again."
            }
            working = false
        }
    }
}
