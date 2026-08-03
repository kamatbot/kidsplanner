import SwiftUI

// MARK: - Meals (parent-only tab — replaces Notes for a parent session)
//
// Pantry / Menu (this week's dinners) / Shopping, backed by the parent-gated
// /api/meals/* endpoints (see AppStore.loadMeals + APIClient's Meals section).
// Kids never reach this screen — RootView swaps it for NotesScreen based on
// `store.isParent` and hides the Meals tab entirely for a kid session.

private enum MealsSection: String, CaseIterable, Identifiable {
    case pantry = "Pantry", menu = "Menu", shopping = "Shopping"
    var id: String { rawValue }
}

struct MealsScreen: View {
    @Environment(AppStore.self) private var store
    @State private var section: MealsSection = .pantry
    @State private var showScanner = false
    @State private var showAddPantry = false
    @State private var showAddMenu = false

    private var pantryItems: [PantryItem] {
        (store.meals?.pantry ?? []).sorted { $0.category != $1.category ? $0.category < $1.category : $0.name < $1.name }
    }
    private var menuEntries: [MenuEntry] {
        (store.meals?.menu ?? []).sorted { $0.date < $1.date }
    }
    private var shoppingItems: [ShoppingItem] {
        (store.meals?.shopping ?? []).sorted { $0.checked != $1.checked ? !$0.checked : $0.name < $1.name }
    }

    var body: some View {
        SurfaceScaffold(title: "Meals") {
            Picker("Section", selection: $section) {
                ForEach(MealsSection.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            switch section {
            case .pantry: pantryContent
            case .menu: menuContent
            case .shopping: shoppingContent
            }
        }
        .task { await store.loadMeals() }
        .refreshable { await store.loadMeals() }
        .sheet(isPresented: $showScanner) { PantryScannerView() }
        .sheet(isPresented: $showAddPantry) { AddPantryItemSheet() }
        .sheet(isPresented: $showAddMenu) { AddMenuEntrySheet() }
    }

    // MARK: Pantry

    private var pantryContent: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            AccentButton(title: "Scan pantry \u{1F4F7}", systemImage: "camera.fill") {
                Haptics.selection(); showScanner = true
            }
            Button { showAddPantry = true } label: {
                Label("Add item manually", systemImage: "plus")
            }
            .font(Typography.body.weight(.semibold))
            .foregroundStyle(Palette.accent)

            if pantryItems.isEmpty {
                emptyCard(
                    icon: "basket",
                    title: "Your pantry is empty",
                    body: "Add items or scan a photo of your pantry or fridge to get started.",
                    secondaryTitle: "Seed common staples"
                ) { Task { await store.seedPantryStaples() } }
            } else {
                Card {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(pantryItems) { item in
                            PantryRow(item: item)
                            if item.id != pantryItems.last?.id {
                                Divider().overlay(Palette.border).padding(.vertical, Space.sm)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Menu

    private var menuContent: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            AccentButton(title: "Add a dinner", systemImage: "plus.circle.fill") { showAddMenu = true }

            if menuEntries.isEmpty {
                emptyCard(
                    icon: "fork.knife",
                    title: "No dinners planned",
                    body: "Add this week's dinners so everyone knows what's cooking."
                )
            } else {
                Card {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(menuEntries) { entry in
                            MenuRow(entry: entry)
                            if entry.id != menuEntries.last?.id {
                                Divider().overlay(Palette.border).padding(.vertical, Space.sm)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Shopping

    private var shoppingContent: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            QuickAddShoppingRow()
            AccentButton(title: "Add low pantry items", systemImage: "cart.badge.plus") {
                Task { await store.addShoppingFromLowPantry() }
            }

            if shoppingItems.isEmpty {
                emptyCard(
                    icon: "cart",
                    title: "Shopping list is empty",
                    body: "Add an item above, or pull in anything running low from the pantry."
                )
            } else {
                Card {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(shoppingItems) { item in
                            ShoppingRow(item: item)
                            if item.id != shoppingItems.last?.id {
                                Divider().overlay(Palette.border).padding(.vertical, Space.xs)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Shared empty state

    @ViewBuilder
    private func emptyCard(icon: String, title: String, body: String, secondaryTitle: String? = nil, secondaryAction: (() -> Void)? = nil) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                Image(systemName: icon)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text(title).font(Typography.cardTitle).foregroundStyle(Palette.text)
                Text(body).font(Typography.body).foregroundStyle(Palette.textSecond)
                if let secondaryTitle, let secondaryAction {
                    Button(secondaryTitle, action: secondaryAction)
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                }
            }
        }
    }
}

// MARK: - Pantry row

private struct PantryRow: View {
    let item: PantryItem
    @Environment(AppStore.self) private var store
    @State private var confirmingDelete = false

    private static let levelOrder = ["plenty", "some", "low"]

    private var levelColor: Color {
        switch item.level {
        case "plenty": return Palette.green
        case "some": return Palette.amber
        default: return Palette.coral
        }
    }
    private var nextLevel: String {
        let i = Self.levelOrder.firstIndex(of: item.level) ?? 0
        return Self.levelOrder[(i + 1) % Self.levelOrder.count]
    }

    var body: some View {
        HStack(spacing: Space.sm) {
            Circle().fill(levelColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).font(Typography.body).foregroundStyle(Palette.text)
                Text(item.category.capitalized).font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
            Spacer()
            Text(item.level.capitalized)
                .font(Typography.monoSmall)
                .foregroundStyle(Palette.textSecond)
            Button(role: .destructive) { confirmingDelete = true } label: {
                Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textSecond)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(item.name)")
        }
        .padding(.vertical, Space.sm)
        .contentShape(Rectangle())
        .onTapGesture {
            Haptics.selection()
            Task { await store.updatePantryItem(item.id, ["level": nextLevel]) }
        }
        .confirmationDialog("Remove \(item.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await store.deletePantryItem(item.id) } }
            Button("Cancel", role: .cancel) {}
        }
    }
}

// MARK: - Menu row

private struct MenuRow: View {
    let entry: MenuEntry
    @Environment(AppStore.self) private var store
    @State private var confirmingDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack(spacing: Space.sm) {
                MicroLabel(text: Agenda.dayLabel(entry.date))
                Spacer()
                if entry.isCooked {
                    Label("Cooked", systemImage: "checkmark.circle.fill")
                        .font(Typography.caption.weight(.semibold))
                        .foregroundStyle(Palette.green)
                } else {
                    Button { Task { await store.markMenuCooked(entry.id) } } label: {
                        Label("Mark cooked", systemImage: "checkmark.circle")
                    }
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                }
                Button(role: .destructive) { confirmingDelete = true } label: {
                    Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textSecond)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(entry.title)")
            }
            Text(entry.title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
            if let note = entry.note, !note.isEmpty {
                Text(note).font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
        }
        .padding(.vertical, Space.sm)
        .confirmationDialog("Remove this dinner?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { await store.deleteMenuEntry(entry.id) } }
            Button("Cancel", role: .cancel) {}
        }
    }
}

// MARK: - Shopping row

private struct ShoppingRow: View {
    let item: ShoppingItem
    @Environment(AppStore.self) private var store

    var body: some View {
        HStack(spacing: Space.sm) {
            Button {
                Haptics.selection()
                Task { await store.toggleShoppingChecked(item) }
            } label: {
                Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.checked ? Palette.accent : Palette.textSecond)
            }
            .buttonStyle(.plain)
            Text(item.name)
                .font(Typography.body)
                .foregroundStyle(item.checked ? Palette.textSecond : Palette.text)
                .strikethrough(item.checked)
            Spacer()
            Button(role: .destructive) { Task { await store.deleteShoppingItem(item.id) } } label: {
                Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textSecond)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(item.name)")
        }
        .padding(.vertical, Space.xs)
    }
}

// MARK: - Shopping quick-add

private struct QuickAddShoppingRow: View {
    @Environment(AppStore.self) private var store
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: Space.sm) {
            TextField("Add an item…", text: $text)
                .font(Typography.body)
                .foregroundStyle(Palette.text)
                .focused($focused)
                .onSubmit(add)
            Button(action: add) {
                Image(systemName: "plus.circle.fill").foregroundStyle(Palette.accent)
            }
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(Space.sm)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))
    }

    private func add() {
        let clean = text.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return }
        text = ""
        Task { await store.addShoppingItem(name: clean) }
    }
}

// MARK: - Add pantry item

private struct AddPantryItemSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var category = "produce"
    @State private var level = "plenty"
    @State private var unitHint = ""
    @State private var saving = false

    private let categories = ["produce", "protein", "dairy", "grain", "pantry", "frozen", "spice", "other"]
    private let levels = ["plenty", "some", "low"]
    private var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !saving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Item name — e.g. Milk", text: $name)
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    Picker("Level", selection: $level) {
                        ForEach(levels, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                    TextField("Unit (optional) — e.g. 1 gallon", text: $unitHint)
                }
            }
            .navigationTitle("Add Pantry Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        saving = true
        let clean = name.trimmingCharacters(in: .whitespaces)
        let unit = unitHint.trimmingCharacters(in: .whitespaces)
        Task {
            await store.addPantryItem(name: clean, category: category, level: level, unitHint: unit.isEmpty ? nil : unit)
            dismiss()
        }
    }
}

// MARK: - Add menu entry

private struct AddMenuEntrySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var title = ""
    @State private var note = ""
    @State private var saving = false

    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty && !saving }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("Dinner — e.g. Tacos", text: $title)
                    TextField("Notes (optional)", text: $note, axis: .vertical).lineLimit(2...4)
                }
            }
            .navigationTitle("Add Dinner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Add") { save() }.fontWeight(.bold).disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        saving = true
        let clean = title.trimmingCharacters(in: .whitespaces)
        let n = note.trimmingCharacters(in: .whitespaces)
        Task {
            await store.addMenuEntry(date: EventFmt.ymd.string(from: date), title: clean, note: n.isEmpty ? nil : n)
            dismiss()
        }
    }
}
