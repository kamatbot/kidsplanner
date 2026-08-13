import SwiftUI

// MARK: - Meals
//
// Parents get Pantry / Menu / Shopping / Recipes. Every family member gets the
// shopping list, backed by the narrow `/api/meals/shopping` projection for kids.

private enum MealsSection: String, CaseIterable, Identifiable {
    case pantry = "Pantry", menu = "Menu", shopping = "Shopping", recipes = "Recipes"
    var id: String { rawValue }
}

private enum RecipeFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case indian = "Indian"
    case thai = "Thai"
    case vegetarian = "Vegetarian"
    case quick = "Under 30 min"
    case kidFriendly = "Kid-friendly"

    var id: String { rawValue }

    func includes(_ recipe: Recipe) -> Bool {
        switch self {
        case .all: return true
        case .indian: return recipe.cuisine == "indian"
        case .thai: return recipe.cuisine == "thai"
        case .vegetarian: return recipe.veg
        case .quick: return recipe.timeMins <= 30
        case .kidFriendly: return recipe.kidFriendly
        }
    }
}

struct MealsScreen: View {
    @Environment(AppStore.self) private var store
    @State private var section: MealsSection = .shopping
    @State private var showScanner = false
    @State private var showAddPantry = false
    @State private var showAddMenu = false
    @State private var recipes: [Recipe] = []
    @State private var recipeFilter: RecipeFilter = .all
    @State private var recipeQuery = ""
    @State private var canCookNow = false
    @State private var isLoadingRecipes = false
    @State private var recipeError: String?
    @State private var selectedRecipe: Recipe?

    private var pantryItems: [PantryItem] {
        (store.meals?.pantry ?? []).sorted { $0.category != $1.category ? $0.category < $1.category : $0.name < $1.name }
    }
    private var menuEntries: [MenuEntry] {
        (store.meals?.menu ?? []).sorted { $0.date < $1.date }
    }
    private var shoppingItems: [ShoppingItem] {
        (store.meals?.shopping ?? []).sorted { $0.done != $1.done ? !$0.done : $0.text < $1.text }
    }
    private var filteredRecipes: [Recipe] {
        let query = recipeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        return recipes.filter { recipe in
            guard recipeFilter.includes(recipe) else { return false }
            if canCookNow, !(recipe.coverage?.coreMissing.isEmpty ?? false) { return false }
            guard !query.isEmpty else { return true }
            let haystack = ([recipe.title, recipe.cuisine, recipe.region] + recipe.tags + recipe.ingredients.map(\.name))
                .joined(separator: " ")
                .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            return haystack.contains(query)
        }
    }

    var body: some View {
        SurfaceScaffold(title: "Meals") {
            Picker("Section", selection: $section) {
                ForEach(store.isParent ? MealsSection.allCases : [.shopping]) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            switch store.isParent ? section : .shopping {
            case .pantry: pantryContent
            case .menu: menuContent
            case .shopping: shoppingContent
            case .recipes: recipesContent
            }
        }
        .task {
            if store.isParent { section = .pantry }
            await store.loadMeals()
        }
        .refreshable {
            await store.loadMeals()
            if section == .recipes { await loadRecipes(force: true) }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .recipes { loadRecipesIfNeeded(force: true) }
        }
        .sheet(isPresented: $showScanner) { PantryScannerView() }
        .sheet(isPresented: $showAddPantry) { AddPantryItemSheet() }
        .sheet(isPresented: $showAddMenu) { AddMenuEntrySheet() }
        .sheet(item: $selectedRecipe) { recipe in
            RecipeDetailSheet(recipe: recipe) {
                section = .menu
                selectedRecipe = nil
            }
            .presentationDetents([.large])
        }
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
            if store.isParent {
                AccentButton(title: "Add low pantry items", systemImage: "cart.badge.plus") {
                    Task { await store.addShoppingFromLowPantry() }
                }
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

    // MARK: Recipes

    private var recipesContent: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack(spacing: Space.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Palette.textSecond)
                TextField("Search recipes or ingredients", text: $recipeQuery)
                    .font(Typography.body)
                    .foregroundStyle(Palette.text)
                    .textInputAutocapitalization(.never)
                if !recipeQuery.isEmpty {
                    Button { recipeQuery = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Palette.textSecond)
                    }
                    .buttonStyle(.plain)
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Clear recipe search")
                }
            }
            .padding(.horizontal, Space.md)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).strokeBorder(Palette.border, lineWidth: 1))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.sm) {
                    ForEach(RecipeFilter.allCases) { filter in
                        Button {
                            Haptics.selection()
                            recipeFilter = filter
                        } label: {
                            Text(filter.rawValue)
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(recipeFilter == filter ? Palette.onAccent : Palette.textSecond)
                                .padding(.horizontal, Space.md)
                                .frame(minHeight: 44)
                                .background(recipeFilter == filter ? Palette.accent : Palette.panel, in: Capsule())
                                .overlay(Capsule().strokeBorder(recipeFilter == filter ? Color.clear : Palette.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(recipeFilter == filter ? .isSelected : [])
                    }
                }
            }

            Toggle(isOn: $canCookNow) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Can cook now")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    Text("Only recipes with every essential ingredient in your pantry")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            .tint(Palette.accent)

            if isLoadingRecipes {
                recipeSkeleton
            } else if let recipeError {
                Card {
                    VStack(alignment: .leading, spacing: Space.md) {
                        Label("Recipes couldn’t load", systemImage: "wifi.exclamationmark")
                            .font(Typography.cardTitle)
                            .foregroundStyle(Palette.text)
                        Text(recipeError)
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                        Button("Try again") { loadRecipesIfNeeded(force: true) }
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.accent)
                            .frame(minHeight: 44)
                    }
                }
            } else if filteredRecipes.isEmpty {
                emptyCard(
                    icon: "book.closed",
                    title: recipes.isEmpty ? "No recipes available" : "No recipes match",
                    body: recipes.isEmpty
                        ? "Pull to refresh and try loading the family recipe library again."
                        : "Try a different filter, clear the search, or turn off Can cook now."
                )
            } else {
                Text("\(filteredRecipes.count) recipe\(filteredRecipes.count == 1 ? "" : "s")")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
                    .accessibilityLabel("\(filteredRecipes.count) recipes found")
                Card(padding: Space.md) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(filteredRecipes) { recipe in
                            RecipeRow(recipe: recipe) { selectedRecipe = recipe }
                            if recipe.id != filteredRecipes.last?.id {
                                Divider().overlay(Palette.border)
                            }
                        }
                    }
                }
            }
        }
        .onAppear { loadRecipesIfNeeded() }
    }

    private var recipeSkeleton: some View {
        Card(padding: Space.md) {
            VStack(spacing: 0) {
                ForEach(0..<4, id: \.self) { index in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text("Loading recipe title")
                            .font(Typography.body.weight(.semibold))
                        Text("30 min · pantry coverage")
                            .font(Typography.caption)
                    }
                    .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
                    .redacted(reason: .placeholder)
                    if index < 3 { Divider().overlay(Palette.border) }
                }
            }
        }
        .accessibilityLabel("Loading recipes")
    }

    private func loadRecipesIfNeeded(force: Bool = false) {
        Task { await loadRecipes(force: force) }
    }

    @MainActor
    private func loadRecipes(force: Bool) async {
        guard store.isParent, !isLoadingRecipes, force || recipes.isEmpty else { return }
        isLoadingRecipes = true
        recipeError = nil
        do {
            recipes = try await store.loadRecipes()
        } catch {
            recipeError = error.localizedDescription
        }
        isLoadingRecipes = false
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

// MARK: - Recipe library

private struct RecipeRow: View {
    let recipe: Recipe
    let onOpen: () -> Void

    private var coverageText: String {
        guard let coverage = recipe.coverage else { return "Pantry coverage unavailable" }
        return "You have \(coverage.have.count) of \(recipe.ingredients.count) ingredients"
    }

    var body: some View {
        Button {
            Haptics.selection()
            onOpen()
        } label: {
            VStack(alignment: .leading, spacing: Space.sm) {
                HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                    Text(recipe.title)
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: Space.sm)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.textSecond)
                }
                HStack(spacing: Space.sm) {
                    Label("\(recipe.timeMins) min", systemImage: "clock")
                    Text(recipe.cuisine.capitalized)
                    if recipe.veg { Text("Vegetarian") }
                    if recipe.kidFriendly { Image(systemName: "face.smiling").accessibilityLabel("Kid-friendly") }
                }
                .font(Typography.caption)
                .foregroundStyle(Palette.textSecond)
                .lineLimit(1)

                if let coverage = recipe.coverage {
                    ProgressView(value: max(0, min(1, coverage.ratio)))
                        .tint(coverage.coreMissing.isEmpty ? Palette.green : Palette.accent)
                    Text(coverageText)
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .padding(.vertical, Space.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(recipe.title), \(recipe.timeMins) minutes, \(coverageText)")
        .accessibilityHint("Opens ingredients and cooking steps")
    }
}

private struct RecipeDetailSheet: View {
    let recipe: Recipe
    let onAddedToMenu: () -> Void

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var planDate = Date()
    @State private var isAddingToMenu = false
    @State private var isAddingShopping = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    private var have: Set<String> { Set(recipe.coverage?.have ?? []) }
    private var missing: Set<String> { Set(recipe.coverage?.missing ?? []) }
    private var missingIngredients: [RecipeIngredient] {
        recipe.ingredients.filter { missing.contains($0.name) }
    }
    private var earliestPlanDate: Date { Calendar.current.startOfDay(for: Date()) }

    var body: some View {
        NavigationStack {
            ZStack {
                ScreenBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.xl) {
                        header
                        pantrySection
                        stepsSection
                        planSection
                    }
                    .padding(Space.lg)
                    .padding(.bottom, Space.xl)
                }
            }
            .navigationTitle("Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text(recipe.title)
                .font(Typography.title)
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Space.md) {
                Label("\(recipe.timeMins) min", systemImage: "clock")
                Label("\(recipe.proteinGPerPortion)g protein", systemImage: "bolt.heart")
                Label("\(recipe.fiberGPerPortion)g fibre", systemImage: "leaf")
            }
            .font(Typography.caption)
            .foregroundStyle(Palette.textSecond)
            .lineLimit(1)
            .minimumScaleFactor(0.75)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.sm) {
                    recipeTag(recipe.cuisine.capitalized)
                    if recipe.veg { recipeTag("Vegetarian") }
                    if recipe.kidFriendly { recipeTag("Kid-friendly") }
                    recipeTag(spiceLabel)
                }
            }

            if !recipe.allergens.isEmpty {
                Label("Contains: \(recipe.allergens.joined(separator: ", "))", systemImage: "exclamationmark.triangle")
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.warn)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Always check ingredient labels for your household’s allergies.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }

            if !recipe.prep.isEmpty {
                VStack(alignment: .leading, spacing: Space.xs) {
                    MicroLabel(text: "Prep ahead")
                    ForEach(recipe.prep) { prep in
                        Label("\(prep.label) · \(prep.leadHours)h ahead", systemImage: "clock.arrow.circlepath")
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                }
            }
        }
    }

    private var pantrySection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack(alignment: .firstTextBaseline) {
                Text("Ingredients")
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.text)
                Spacer()
                if let coverage = recipe.coverage {
                    Text("\(coverage.have.count)/\(recipe.ingredients.count) in pantry")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                }
            }
            VStack(spacing: 0) {
                ForEach(recipe.ingredients) { ingredient in
                    HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                        Image(systemName: have.contains(ingredient.name) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(have.contains(ingredient.name) ? Palette.green : Palette.textSecond)
                            .accessibilityHidden(true)
                        Text(ingredient.name)
                            .font(Typography.body)
                            .foregroundStyle(Palette.text)
                        if let hint = ingredient.qtyHint, !hint.isEmpty {
                            Text(hint)
                                .font(Typography.caption)
                                .foregroundStyle(Palette.textSecond)
                        }
                        Spacer(minLength: Space.xs)
                        if ingredient.core, !have.contains(ingredient.name) {
                            Text("Essential")
                                .font(Typography.caption.weight(.semibold))
                                .foregroundStyle(Palette.warn)
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(ingredient.name)\(ingredient.qtyHint.map { ", \($0)" } ?? ""), \(have.contains(ingredient.name) ? "in pantry" : "missing")")
                    if ingredient.id != recipe.ingredients.last?.id { Divider().overlay(Palette.border) }
                }
            }

            if missingIngredients.isEmpty {
                Label("You have every ingredient", systemImage: "checkmark.circle.fill")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.green)
            } else {
                Button {
                    addMissingToShopping()
                } label: {
                    Label(isAddingShopping ? "Adding…" : "Add \(missingIngredients.count) missing to Shopping", systemImage: "cart.badge.plus")
                        .font(Typography.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(Palette.accent)
                .disabled(isAddingShopping)
            }

            if let statusMessage {
                Text(statusMessage)
                    .font(Typography.caption.weight(.semibold))
                    .foregroundStyle(Palette.green)
                    .accessibilityLabel(statusMessage)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(Typography.caption)
                    .foregroundStyle(Palette.warn)
                    .accessibilityLabel("Error: \(errorMessage)")
            }
        }
    }

    private var stepsSection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text("Method")
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
            ForEach(Array(recipe.steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: Space.md) {
                    Text("\(index + 1)")
                        .font(Typography.monoSmall.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: 28, height: 28)
                        .background(Palette.accent, in: Circle())
                        .accessibilityHidden(true)
                    Text(step)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Step \(index + 1). \(step)")
            }
        }
    }

    private var planSection: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            Text("Plan this meal")
                .font(Typography.cardTitle)
                .foregroundStyle(Palette.text)
            DatePicker("Dinner date", selection: $planDate, in: earliestPlanDate..., displayedComponents: .date)
                .font(Typography.body)
                .tint(Palette.accent)
            AccentButton(title: isAddingToMenu ? "Adding…" : "Add to Menu", systemImage: "calendar.badge.plus") {
                addToMenu()
            }
            .disabled(isAddingToMenu)
        }
    }

    private var spiceLabel: String {
        switch recipe.spice {
        case 0: return "No heat"
        case 1: return "Mild"
        case 2: return "Medium"
        default: return "Hot"
        }
    }

    private func recipeTag(_ text: String) -> some View {
        Text(text)
            .font(Typography.caption.weight(.semibold))
            .foregroundStyle(Palette.textSecond)
            .padding(.horizontal, Space.sm)
            .padding(.vertical, 6)
            .background(Palette.panel2, in: Capsule())
    }

    private func addMissingToShopping() {
        guard !isAddingShopping else { return }
        isAddingShopping = true
        statusMessage = nil
        errorMessage = nil
        Task {
            do {
                let added = try await store.addRecipeIngredientsToShopping(missingIngredients)
                statusMessage = added == 0
                    ? "Those ingredients are already on Shopping."
                    : "Added \(added) item\(added == 1 ? "" : "s") to Shopping."
                Haptics.notify(.success)
            } catch {
                errorMessage = error.localizedDescription
                Haptics.notify(.error)
            }
            isAddingShopping = false
        }
    }

    private func addToMenu() {
        guard !isAddingToMenu else { return }
        isAddingToMenu = true
        errorMessage = nil
        Task {
            do {
                _ = try await store.addRecipeToMenu(recipeId: recipe.id, date: EventFmt.ymd.string(from: planDate))
                Haptics.notify(.success)
                onAddedToMenu()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                Haptics.notify(.error)
                isAddingToMenu = false
            }
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
                Task { await store.toggleShoppingDone(item) }
            } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.done ? Palette.accent : Palette.textSecond)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.done ? "Uncheck \(item.text)" : "Check off \(item.text)")
            Text(item.text)
                .font(Typography.body)
                .foregroundStyle(item.done ? Palette.textSecond : Palette.text)
                .strikethrough(item.done)
            Spacer()
            if store.isParent {
                Button(role: .destructive) { Task { await store.deleteShoppingItem(item.id) } } label: {
                    Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textSecond)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(item.text)")
            }
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
        Task { await store.addShoppingItem(text: clean) }
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
