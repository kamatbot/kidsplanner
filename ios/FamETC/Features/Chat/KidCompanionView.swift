import SwiftUI
import Observation

// This is a separate child profile on the existing private `hermes` room.
// Policy fields never enter the child's customization request.
struct KidCompanionProfile: Codable, Equatable {
    var name: String
    var avatar: CompanionAvatar
    var color: CompanionColor
    var personality: CompanionPersonality
    var reminders: Bool
    var enabled: Bool
    var ageBand: CompanionAgeBand
}

enum CompanionAvatar: String, Codable, CaseIterable {
    case comet, robot, fox, owl, axolotl
    var label: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .comet: return "☄️"
        case .robot: return "🤖"
        case .fox: return "🦊"
        case .owl: return "🦉"
        case .axolotl: return ""
        }
    }
}

enum CompanionColor: String, Codable, CaseIterable {
    case violet, mint, orange, blue
    var label: String { rawValue.capitalized }
    var tint: Color {
        switch self {
        case .violet: return Palette.accent
        case .mint: return Palette.frD3
        case .orange: return Palette.frHw
        case .blue: return Palette.blue
        }
    }
}

enum CompanionPersonality: String, Codable, CaseIterable {
    case playful, calm, curious
    var label: String { rawValue.capitalized }
    var detail: String {
        switch self {
        case .playful: return "A little fun with every small step."
        case .calm: return "Gentle encouragement, one thing at a time."
        case .curious: return "Questions and ideas to explore together."
        }
    }
}

enum CompanionAgeBand: String, Codable, CaseIterable {
    case sixToEight = "6-8", nineToTwelve = "9-12", thirteenToSeventeen = "13-17"
    var label: String { "Ages " + rawValue.replacingOccurrences(of: "-", with: "–") }
}

struct KidCompanionCustomization: Equatable {
    var name: String
    var avatar: CompanionAvatar
    var color: CompanionColor
    var personality: CompanionPersonality
    var reminders: Bool

    init(_ profile: KidCompanionProfile) {
        name = profile.name; avatar = profile.avatar; color = profile.color
        personality = profile.personality; reminders = profile.reminders
    }
    var trimmedName: String { name.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines) }
    var validName: Bool {
        let scalars = trimmedName.unicodeScalars
        return !scalars.isEmpty && scalars.count <= 24 && scalars.contains(where: { CharacterSet.letters.contains($0) })
            && scalars.allSatisfy { CharacterSet.letters.contains($0) || CharacterSet.nonBaseCharacters.contains($0) || " '’-".unicodeScalars.contains($0) }
    }
    var body: [String: Any] {
        ["name": trimmedName, "avatar": avatar.rawValue, "color": color.rawValue,
         "personality": personality.rawValue, "reminders": reminders]
    }
}

struct KidCompanionEntry: Decodable, Identifiable, Equatable {
    let kidId: String
    let kidName: String
    var profile: KidCompanionProfile
    var id: String { kidId }
}
struct KidCompanionResponse: Decodable { let profile: KidCompanionProfile }
struct KidCompanionsResponse: Decodable { let companions: [KidCompanionEntry] }

protocol KidCompanionService {
    func kidCompanion() async throws -> KidCompanionProfile
    func updateKidCompanion(_ customization: KidCompanionCustomization) async throws -> KidCompanionProfile
    func kidCompanions() async throws -> [KidCompanionEntry]
    func updateKidCompanionPolicy(kidID: String, enabled: Bool, ageBand: CompanionAgeBand) async throws -> KidCompanionProfile
}

struct KidCompanionScope: Hashable {
    let userID: String
    let familyID: String
    let kidID: String?
    var isParent: Bool { kidID == nil }

    @MainActor static func current(in app: AppStore) -> Self? {
        guard !app.needsAuth, let user = app.me, let family = app.family, family.productPlan == .full else { return nil }
        if user.role == "kid" {
            guard let kidID = user.kidId, family.kids.contains(where: { $0.id == kidID }) else { return nil }
            return Self(userID: user.id, familyID: family.id, kidID: kidID)
        }
        guard family.parentIds.contains(user.id) else { return nil }
        return Self(userID: user.id, familyID: family.id, kidID: nil)
    }
}

@MainActor @Observable final class KidCompanionStore {
    private(set) var scope: KidCompanionScope?
    private(set) var profile: KidCompanionProfile?
    private(set) var companions: [KidCompanionEntry] = []
    private(set) var loading = false
    private(set) var loaded = false
    private(set) var saving = false
    private(set) var error: String?
    private var generation = 0
    private let service: any KidCompanionService

    init(service: any KidCompanionService = APIClient.shared) { self.service = service }

    func clear() {
        generation &+= 1; scope = nil; profile = nil; companions = []
        loading = false; loaded = false; saving = false; error = nil
    }

    func load(for owner: KidCompanionScope, isCurrent: () -> Bool) async {
        guard isCurrent(), !Task.isCancelled, !saving else { return }
        if scope != owner { clear(); scope = owner }
        generation &+= 1
        let version = generation
        loading = true; error = nil
        defer { if generation == version { loading = false } }
        do {
            if owner.isParent {
                let result = try await service.kidCompanions()
                guard accepts(owner, version, isCurrent) else { return }
                companions = result
            } else {
                let result = try await service.kidCompanion()
                guard accepts(owner, version, isCurrent) else { return }
                profile = result
            }
            loaded = true
        } catch {
            if accepts(owner, version, isCurrent), !error.isCancellation { self.error = error.localizedDescription }
        }
    }

    func save(_ draft: KidCompanionCustomization, for owner: KidCompanionScope, isCurrent: () -> Bool) async -> KidCompanionProfile? {
        guard !owner.isParent, draft.validName, profile != nil, scope == owner, isCurrent(), !saving, !loading else { return nil }
        let version = generation
        saving = true; error = nil
        defer { if generation == version { saving = false } }
        do {
            let result = try await service.updateKidCompanion(draft)
            guard accepts(owner, version, isCurrent) else { return nil }
            profile = result
            return result
        } catch {
            if accepts(owner, version, isCurrent), !error.isCancellation { self.error = error.localizedDescription }
            return nil
        }
    }

    func savePolicy(kidID: String, enabled: Bool, ageBand: CompanionAgeBand, for owner: KidCompanionScope, isCurrent: () -> Bool) async -> KidCompanionProfile? {
        guard owner.isParent, scope == owner, isCurrent(), !saving, !loading,
              let index = companions.firstIndex(where: { $0.kidId == kidID }) else { return nil }
        let version = generation
        saving = true; error = nil
        defer { if generation == version { saving = false } }
        do {
            let result = try await service.updateKidCompanionPolicy(kidID: kidID, enabled: enabled, ageBand: ageBand)
            guard accepts(owner, version, isCurrent) else { return nil }
            companions[index].profile = result
            return result
        } catch {
            if accepts(owner, version, isCurrent), !error.isCancellation { self.error = error.localizedDescription }
            return nil
        }
    }

    private func accepts(_ owner: KidCompanionScope, _ version: Int, _ isCurrent: () -> Bool) -> Bool {
        scope == owner && generation == version && isCurrent() && !Task.isCancelled
    }
}

struct KidCompanionAvatarView: View {
    let avatar: CompanionAvatar
    let color: CompanionColor
    var size: CGFloat = 64

    var body: some View {
        ZStack {
            Circle().fill(color.tint.opacity(0.14))
            if avatar == .axolotl {
                Canvas { context, bounds in
                    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * bounds.width, y: y * bounds.height) }
                    var gills = Path()
                    for y in [CGFloat(0.3), 0.46, 0.62] {
                        gills.move(to: point(0.3, 0.5)); gills.addLine(to: point(0.12, y))
                        gills.move(to: point(0.7, 0.5)); gills.addLine(to: point(0.88, y))
                    }
                    context.stroke(gills, with: .color(.pink), style: StrokeStyle(lineWidth: bounds.width * 0.065, lineCap: .round))
                    context.fill(Path(ellipseIn: CGRect(x: bounds.width * 0.25, y: bounds.height * 0.28, width: bounds.width * 0.5, height: bounds.height * 0.5)), with: .color(Color(red: 1, green: 0.78, blue: 0.83)))
                    for x in [CGFloat(0.37), 0.6] {
                        context.fill(Path(ellipseIn: CGRect(x: bounds.width * x, y: bounds.height * 0.48, width: bounds.width * 0.055, height: bounds.height * 0.075)), with: .color(.black))
                    }
                    var smile = Path()
                    smile.move(to: point(0.44, 0.62)); smile.addQuadCurve(to: point(0.58, 0.62), control: point(0.51, 0.72))
                    context.stroke(smile, with: .color(.black), style: StrokeStyle(lineWidth: bounds.width * 0.022, lineCap: .round))
                }
            } else { Text(avatar.emoji).font(.system(size: size * 0.58)) }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct KidCompanionView: View {
    let model: KidCompanionStore
    let scope: KidCompanionScope
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    private var isCurrent: Bool { KidCompanionScope.current(in: app) == scope }

    var body: some View {
        NavigationStack {
            Group {
                if !isCurrent { Color.clear }
                else if model.loading || !model.loaded && model.error == nil {
                    ProgressView("Loading companion settings…").accessibilityIdentifier("companion.loading")
                } else if scope.isParent && model.loaded {
                    parentList
                } else if let profile = model.profile {
                    KidCompanionEditor(model: model, scope: scope, profile: profile, isCurrent: { isCurrent })
                } else {
                    ContentUnavailableView {
                        Label("Settings unavailable", systemImage: "wifi.exclamationmark")
                    } description: { Text(model.error ?? "Please try again.") } actions: {
                        Button("Try again") { Task { await model.load(for: scope, isCurrent: { isCurrent }) } }
                            .accessibilityIdentifier("companion.retry")
                    }
                }
            }
            .navigationTitle(scope.isParent ? "Kids’ AI companions" : "Make it yours")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .tint(Palette.accent)
        }
        .task { if isCurrent && (scope.isParent || !model.loaded) && !model.loading { await model.load(for: scope, isCurrent: { isCurrent }) } }
        .onChange(of: isCurrent) { _, current in if !current { model.clear(); dismiss() } }
        .presentationDetents([.large])
    }

    private var parentList: some View {
        Form {
            Section {
                Text("Each child can choose a name, mascot and style. You choose their age group and whether AI chat is enabled.")
                Text("When enabled, their messages are processed by an external AI service (Anthropic). AI can make mistakes, and age-based filtering is not perfect.")
                    .foregroundStyle(Palette.textSecond)
            }
            Section("Children") {
                if model.companions.isEmpty { Text("Add a child in Family settings to get started.").foregroundStyle(Palette.textSecond) }
                ForEach(model.companions) { entry in
                    NavigationLink {
                        KidCompanionPolicyEditor(model: model, scope: scope, entry: entry, isCurrent: { isCurrent })
                    } label: {
                        HStack(spacing: 12) {
                            KidCompanionAvatarView(avatar: entry.profile.avatar, color: entry.profile.color, size: 44)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.kidName).font(.headline)
                                Text("\(entry.profile.name) · \(entry.profile.enabled ? "Enabled" : "Paused") · \(entry.profile.ageBand.label)")
                                    .font(.subheadline).foregroundStyle(Palette.textSecond)
                            }
                        }.padding(.vertical, 4)
                    }.accessibilityIdentifier("companion.child.\(entry.kidId)")
                }
            }
            Section {
                Text("Children’s private chats are not shown here. Homework guidance and reminders about using hints stay with the child; parents do not receive cheating alerts.")
            }
        }
    }
}

private struct KidCompanionEditor: View {
    let model: KidCompanionStore
    let scope: KidCompanionScope
    let isCurrent: () -> Bool
    @State private var draft: KidCompanionCustomization
    @State private var saved = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @FocusState private var editingName: Bool

    init(model: KidCompanionStore, scope: KidCompanionScope, profile: KidCompanionProfile, isCurrent: @escaping () -> Bool) {
        self.model = model; self.scope = scope; self.isCurrent = isCurrent
        _draft = State(initialValue: KidCompanionCustomization(profile))
    }
    private var changed: Bool { model.profile.map { draft != KidCompanionCustomization($0) } ?? false }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    KidCompanionAvatarView(avatar: draft.avatar, color: draft.color, size: 92)
                    Text(draft.trimmedName.isEmpty ? "Your AI helper" : draft.trimmedName).font(.title2.bold())
                        .lineLimit(2).multilineTextAlignment(.center)
                    Text(draft.personality.detail).font(.subheadline).foregroundStyle(Palette.textSecond)
                        .multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(.vertical, 12)
                if model.profile?.enabled != true {
                    Label("Chat is paused. A parent can enable it in their companion settings. You can still make your helper your own.", systemImage: "pause.circle")
                        .font(.subheadline).foregroundStyle(Palette.textSecond)
                        .accessibilityIdentifier("companion.paused")
                }
            }
            Section {
                TextField("Companion name", text: $draft.name).textInputAutocapitalization(.words)
                    .autocorrectionDisabled().focused($editingName).submitLabel(.done)
                    .onSubmit { editingName = false }.accessibilityIdentifier("companion.name")
            } header: { Text("A name you like") } footer: {
                Text("1–24 letters, spaces, hyphens or apostrophes.")
                    .foregroundStyle(draft.validName ? Palette.textSecond : Palette.red)
            }
            Section("Choose a mascot") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 145 : 84))], spacing: 12) {
                    ForEach(CompanionAvatar.allCases, id: \.self) { avatar in
                        Button { draft.avatar = avatar } label: {
                            VStack(spacing: 6) {
                                KidCompanionAvatarView(avatar: avatar, color: draft.color, size: 54)
                                Text(avatar.label).font(.subheadline)
                                Image(systemName: draft.avatar == avatar ? "checkmark.circle.fill" : "circle").font(.caption)
                            }.frame(maxWidth: .infinity).padding(.vertical, 8)
                                .foregroundStyle(Palette.text)
                                .background(draft.avatar == avatar ? draft.color.tint.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 14))
                        }.buttonStyle(.plain).accessibilityLabel(avatar.label)
                            .accessibilityAddTraits(draft.avatar == avatar ? .isSelected : [])
                            .accessibilityIdentifier("companion.avatar.\(avatar.rawValue)")
                    }
                }
            }
            Section("Color & style") {
                Picker("Color", selection: $draft.color) {
                    ForEach(CompanionColor.allCases, id: \.self) { color in Text(color.label).tag(color) }
                }.accessibilityIdentifier("companion.color")
                Picker("Personality", selection: $draft.personality) {
                    ForEach(CompanionPersonality.allCases, id: \.self) { personality in Text(personality.label).tag(personality) }
                }.accessibilityIdentifier("companion.personality")
                Toggle("Gentle reminders", isOn: $draft.reminders).accessibilityIdentifier("companion.reminders")
            }
            Section {
                Text("Your companion is an AI helper, not a person. It can make mistakes. It helps with homework through hints and your own ideas. Tell a trusted adult if a reply worries you.")
                    .font(.subheadline).foregroundStyle(Palette.textSecond)
                if let error = model.error { Text(error).foregroundStyle(Palette.red).accessibilityIdentifier("companion.error") }
                if saved && !changed { Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(Palette.green).accessibilityIdentifier("companion.saved") }
                Button {
                    editingName = false
                    Task {
                        if let profile = await model.save(draft, for: scope, isCurrent: isCurrent) {
                            draft = KidCompanionCustomization(profile); saved = true
                        }
                    }
                } label: {
                    HStack { if model.saving { ProgressView() }; Text(model.saving ? "Saving…" : "Save companion") }
                        .frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.borderedProminent).accessibilityIdentifier("companion.save")
                    .disabled(!changed || !draft.validName || model.saving || model.loading || !isCurrent())
            }
        }
        .disabled(model.saving)
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct KidCompanionPolicyEditor: View {
    let model: KidCompanionStore
    let scope: KidCompanionScope
    let entry: KidCompanionEntry
    let isCurrent: () -> Bool
    @State private var enabled: Bool
    @State private var ageBand: CompanionAgeBand
    @State private var saved = false

    init(model: KidCompanionStore, scope: KidCompanionScope, entry: KidCompanionEntry, isCurrent: @escaping () -> Bool) {
        self.model = model; self.scope = scope; self.entry = entry; self.isCurrent = isCurrent
        _enabled = State(initialValue: entry.profile.enabled); _ageBand = State(initialValue: entry.profile.ageBand)
    }
    private var changed: Bool {
        guard let latest = model.companions.first(where: { $0.id == entry.id })?.profile else { return false }
        return latest.enabled != enabled || latest.ageBand != ageBand
    }
    var body: some View {
        Form {
            Section {
                Toggle("Enable AI chat", isOn: $enabled).accessibilityIdentifier("companion.enable")
                Picker("Age group", selection: $ageBand) {
                    ForEach(CompanionAgeBand.allCases, id: \.self) { age in Text(age.label).tag(age) }
                }.accessibilityIdentifier("companion.ageBand")
            } footer: {
                Text("By enabling and saving, you allow \(entry.kidName)’s messages to be processed by an external AI service (Anthropic). Choose their current age group. You can pause access here at any time.")
            }
            Section {
                Text("AI can make mistakes. Age-based filtering is not perfect. Children get homework hints and gentle guidance in their private chat; no cheating alerts are sent to parents.")
                if let error = model.error { Text(error).foregroundStyle(Palette.red).accessibilityIdentifier("companion.error") }
                if saved && !changed { Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(Palette.green).accessibilityIdentifier("companion.saved") }
                Button {
                    Task {
                        if let profile = await model.savePolicy(kidID: entry.id, enabled: enabled, ageBand: ageBand, for: scope, isCurrent: isCurrent) {
                            enabled = profile.enabled; ageBand = profile.ageBand; saved = true
                        }
                    }
                } label: {
                    HStack { if model.saving { ProgressView() }; Text(model.saving ? "Saving…" : "Save settings") }
                        .frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.borderedProminent).accessibilityIdentifier("companion.policySave")
                    .disabled(!changed || model.saving || model.loading || !isCurrent())
            }
        }
        .disabled(model.saving)
        .navigationTitle(entry.kidName)
    }
}
