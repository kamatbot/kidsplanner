import SwiftUI

struct MyCornerScreen: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var model: MyCornerModel
    @FocusState private var noteFocused: Bool
    @State private var showDrawer = false
    @State private var confirmDiscard = false
    let ownerID: String
    let familyID: String?
    let role: String?

    init(ownerID: String, familyID: String? = nil, role: String? = nil) {
        self.ownerID = ownerID
        self.familyID = familyID
        self.role = role
        let service = CornerService(ownerID: ownerID, familyID: familyID, role: role)
        _model = State(initialValue: MyCornerModel(request: { try await service.request($0) }))
    }
    private var adjacent: Bool { sizeClass == .regular && !textSize.isAccessibilitySize }
    private var isAuthorized: Bool {
        guard !store.needsAuth, let user = store.me, user.id == ownerID, user.role == role,
              let family = store.family, family.id == familyID else { return false }
        if user.role == "kid" {
            guard let kidID = user.kidId else { return false }
            return family.kids.contains { $0.id == kidID }
        }
        return family.parentIds.contains(user.id)
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                if isAuthorized {
                    VStack(alignment: .leading, spacing: Space.md) {
                        Text("Only you can open this corner. Nothing here is shared with family.")
                            .foregroundStyle(Palette.textSecond)
                        if let draft = model.draft {
                            if adjacent {
                                HStack(alignment: .top, spacing: Space.lg) {
                                    editor(draft).frame(maxWidth: .infinity)
                                    ScrollView(.vertical, showsIndicators: true) { collection }.frame(width: 250, height: 520).accessibilityIdentifier("corner.collection")
                                }
                            } else { editor(draft) }
                            if let latest = model.latest {
                                VStack(alignment: .leading, spacing: Space.md) {
                                    Text("Latest saved corner").font(Typography.cardTitle)
                                    Text("Your unsaved draft remains above. Compare both before choosing.")
                                    board(latest, editable: false)
                                    Button("Use latest (discard my draft)") { model.useLatest() }
                                    Button("Keep my draft for next save") { model.keepDraft() }
                                }.padding().background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: 16))
                            }
                            Text(model.message).accessibilityIdentifier("corner-status")
                            Button("Save changes") { Task { await model.save() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(model.busy || model.latest != nil)
                                .accessibilityIdentifier("corner-save")
                        } else {
                            Text(model.message).accessibilityIdentifier("corner-status")
                            if model.busy { ProgressView() }
                            else { Button("Retry loading") { Task { await model.load() } } }
                        }
                    }.padding(Space.lg)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Palette.bg)
            .navigationTitle("My Corner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Close") { if model.dirty { confirmDiscard = true } else { dismiss() } }.disabled(model.busy)
            } }
            .toolbar { ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done editing") { noteFocused = false }
            } }
            .confirmationDialog("Discard your unsaved corner changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
            }
            .sheet(isPresented: $showDrawer) {
                NavigationStack {
                    ScrollView { collection.padding() }.accessibilityIdentifier("corner.collection")
                        .navigationTitle("Stickers")
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showDrawer = false } } }
                }.presentationDetents([.medium, .large])
            }
        }
        .presentationSizing(.page)
        .font(Typography.body)
        .controlSize(.large)
        .tint(Palette.accent)
        .interactiveDismissDisabled(model.dirty || model.busy)
        .task {
            guard isAuthorized else { return }
            await model.load()
        }
        .onChange(of: store.me?.id) { _, _ in model.clear(); showDrawer = false; dismiss() }
        .onChange(of: store.me?.role) { _, _ in model.clear(); showDrawer = false; dismiss() }
        .onChange(of: store.family?.id) { _, _ in model.clear(); showDrawer = false; dismiss() }
        .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { model.clear(); showDrawer = false; dismiss() } }
        .onDisappear { model.clear() }
    }
    private func editor(_ draft: CornerDocument) -> some View {
        VStack(alignment: .leading, spacing: Space.md) {
            board(draft, editable: true)
            if !adjacent { Button("Add sticker") { showDrawer = true }.disabled(draft.stickers.count >= 18) }
            if let item = draft.stickers.first(where: { $0.id == model.selected }) {
                Text("Selected: \(CornerDocument.label(item.stickerId))").font(Typography.cardTitle)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 105))], spacing: 8) {
                    Button("Left") { model.move(dx: -0.05) }
                    Button("Right") { model.move(dx: 0.05) }
                    Button("Up") { model.move(dy: -0.05) }
                    Button("Down") { model.move(dy: 0.05) }
                    Button("Rotate 15°") { model.move(rotate: true) }
                    Button("Remove sticker") { model.remove() }
                }.buttonStyle(.bordered)
            }
            Text("Sticky note (240 characters maximum)")
            TextField("A small space for your ideas", text: Binding(get: { model.draft?.note ?? "" }, set: { text in
                model.edit { $0.note = text }
            }), axis: .vertical)
                .focused($noteFocused)
                .lineLimit(3...6).textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("corner-note")
        }.disabled(model.busy)
    }
    private var collection: some View {
        VStack(alignment: .leading, spacing: Space.sm) {
            Picker("Sticker category", selection: $category) {
                Text("All").tag("All")
                Text("Moods").tag("Moods")
                Text("Activities").tag("Activities")
                Text("Little things").tag("Little things")
            }
            .pickerStyle(.menu)
            Group {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: textSize.isAccessibilitySize ? 180 : 110))], spacing: 12) {
                    ForEach(filteredChoices, id: \.self) { id in
                        Button { model.add(id); showDrawer = false } label: {
                            VStack { Image("Corner-" + id).resizable().scaledToFit().frame(width: 64, height: 64)
                                Text(CornerDocument.label(id)).font(Typography.body)
                            }.frame(maxWidth: .infinity, minHeight: 110)
                                .padding(8)
                                .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: 16))
                        }.buttonStyle(.plain)
                            .accessibilityLabel("Add \(CornerDocument.label(id))")
                            .disabled(model.busy || (model.draft?.stickers.count ?? 0) >= 18)
                    }
                }
            }
        }
    }
    @State private var category = "All"
    private var filteredChoices: [String] {
        switch category {
        case "Moods": CornerDocument.moods
        case "Activities": CornerDocument.activities
        case "Little things": CornerDocument.littleThings
        default: CornerDocument.choices
        }
    }
    private func board(_ value: CornerDocument, editable: Bool) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 16).fill(Palette.panel2)
                ScrollView {
                    Text(value.note.isEmpty ? "A small space for your ideas." : value.note)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                }.frame(width: min(210, geometry.size.width - 32), height: 170)
                    .background(Color(hex: 0xFFF1CE)).foregroundStyle(Color(hex: 0x44394D))
                    .padding(16)
                ForEach(value.stickers) { item in
                    Button { if editable { model.selected = item.id } } label: {
                        Image("Corner-" + item.stickerId).resizable().scaledToFit().frame(width: 64, height: 64)
                            .background(editable && model.selected == item.id ? Palette.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 12))
                    }.buttonStyle(.plain)
                        .rotationEffect(.degrees(item.rotation))
                        .position(x: 48 + (geometry.size.width - 96) * item.x, y: 48 + (geometry.size.height - 96) * item.y)
                        .accessibilityLabel("\(editable ? "Select" : "") \(CornerDocument.label(item.stickerId))")
                        .accessibilityValue("Horizontal \(Int(item.x * 100)) percent, vertical \(Int(item.y * 100)) percent, rotation \(Int(item.rotation)) degrees")
                        .accessibilityAddTraits(editable && model.selected == item.id ? .isSelected : [])
                        .disabled(!editable)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { point in
                guard editable, model.selected != nil else { return }
                model.move(x: (point.x - 48) / max(1, geometry.size.width - 96), y: (point.y - 48) / max(1, geometry.size.height - 96))
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }.frame(height: 360).accessibilityIdentifier(editable ? "corner-canvas" : "corner-latest")
    }
}
