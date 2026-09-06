package com.fametc.app.ui.features.planning

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.*
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

private enum class MealsTab(val label: String) {
    PANTRY("Pantry"), MENU("Menu"), SHOPPING("Shopping"), RECIPES("Recipes")
}

@Composable
fun MealsScreen() {
    val repository = FamEtcApp.instance.repository
    val mealsState by repository.meals.collectAsState()
    val isParent = repository.isParent
    val scope = rememberCoroutineScope()

    var activeTab by remember { mutableStateOf(if (isParent) MealsTab.PANTRY else MealsTab.SHOPPING) }
    var showPantryScanner by remember { mutableStateOf(false) }
    var showAddPantryDialog by remember { mutableStateOf(false) }
    var showAddShoppingDialog by remember { mutableStateOf(false) }
    var showAddMenuDialog by remember { mutableStateOf(false) }
    var recipes by remember { mutableStateOf<List<Recipe>>(emptyList()) }
    var recipeQuery by remember { mutableStateOf("") }
    var selectedRecipe by remember { mutableStateOf<Recipe?>(null) }

    LaunchedEffect(activeTab) {
        if (activeTab == MealsTab.RECIPES && recipes.isEmpty()) {
            try {
                recipes = ApiClient.api.recipes().recipes
            } catch (e: Exception) {}
        }
    }

    Scaffold(
        containerColor = FamTheme.colors.bg
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(bottom = 64.dp)
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    MicroLabel("Kitchen Hub")
                    Text("Meals & Grocery", style = FamTheme.typography.title, color = FamTheme.colors.text)
                }

                if (activeTab == MealsTab.PANTRY && isParent) {
                    IconButton(
                        onClick = { showPantryScanner = true },
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(FamTheme.colors.accentSoft)
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = "Scan Pantry", tint = FamTheme.colors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }

            // Tabs Picker
            if (isParent) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(FamTheme.colors.panel)
                        .border(1.dp, FamTheme.colors.border, RoundedCornerShape(12.dp))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    MealsTab.values().forEach { tab ->
                        val isSel = activeTab == tab
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (isSel) FamTheme.colors.accentSoft else Color.Transparent)
                                .clickable { activeTab = tab }
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = tab.label,
                                style = FamTheme.typography.caption,
                                color = if (isSel) FamTheme.colors.accent else FamTheme.colors.textSecond
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            when (activeTab) {
                MealsTab.PANTRY -> {
                    PantryContent(
                        items = mealsState?.pantry ?: emptyList(),
                        onAddItem = { showAddPantryDialog = true },
                        onDeleteItem = { id -> scope.launch { repository.deletePantryItem(id) } }
                    )
                }
                MealsTab.MENU -> {
                    MenuContent(
                        entries = mealsState?.menu ?: emptyList(),
                        onAddEntry = { showAddMenuDialog = true },
                        onCookEntry = { id -> scope.launch { ApiClient.api.cookMenuEntry(id); repository.refresh() } }
                    )
                }
                MealsTab.SHOPPING -> {
                    ShoppingContent(
                        items = mealsState?.shopping ?: emptyList(),
                        onAddItem = { showAddShoppingDialog = true },
                        onToggle = { id, done -> scope.launch { repository.toggleShoppingItem(id, done) } },
                        onDelete = { id -> scope.launch { repository.deleteShoppingItem(id) } }
                    )
                }
                MealsTab.RECIPES -> {
                    RecipesContent(
                        recipes = recipes,
                        query = recipeQuery,
                        onQueryChange = { recipeQuery = it },
                        onSelectRecipe = { selectedRecipe = it }
                    )
                }
            }
        }
    }

    if (showPantryScanner) {
        PantryScannerDialog(
            onDismiss = { showPantryScanner = false },
            onImportSuccess = { scope.launch { repository.refresh() } }
        )
    }

    if (showAddPantryDialog) {
        AddPantryItemDialog(
            onDismiss = { showAddPantryDialog = false },
            onConfirm = { name, cat, lvl ->
                scope.launch {
                    repository.addPantryItem(name, cat, lvl)
                    showAddPantryDialog = false
                }
            }
        )
    }

    if (showAddShoppingDialog) {
        AddShoppingItemDialog(
            onDismiss = { showAddShoppingDialog = false },
            onConfirm = { text, cat ->
                scope.launch {
                    repository.addShoppingItem(text, cat)
                    showAddShoppingDialog = false
                }
            }
        )
    }

    selectedRecipe?.let { r ->
        RecipeDetailSheet(recipe = r, onDismiss = { selectedRecipe = null })
    }
}

@Composable
private fun PantryContent(
    items: List<PantryItem>,
    onAddItem: () -> Unit,
    onDeleteItem: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("${items.size} items in stock", style = FamTheme.typography.label, color = FamTheme.colors.textSecond)
            TextButton(onClick = onAddItem) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Add Item", style = FamTheme.typography.caption)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (items.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Pantry is empty. Tap 'Add Item' or scan a shelf photo!", style = FamTheme.typography.body, color = FamTheme.colors.textSecond)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.id }) { item ->
                    FamCard(padding = 12.dp) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(item.name, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                                Text("${item.category} • ${item.level.replaceFirstChar { it.uppercase() }}", style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                            }
                            IconButton(onClick = { onDeleteItem(item.id) }, modifier = Modifier.size(28.dp)) {
                                Icon(Icons.Default.DeleteOutline, contentDescription = "Delete", tint = FamTheme.colors.muted, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuContent(
    entries: List<MenuEntry>,
    onAddEntry: () -> Unit,
    onCookEntry: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Weekly Dinner Plan", style = FamTheme.typography.label, color = FamTheme.colors.textSecond)
            TextButton(onClick = onAddEntry) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Add Meal", style = FamTheme.typography.caption)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (entries.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No meals planned this week.", style = FamTheme.typography.body, color = FamTheme.colors.textSecond)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(entries, key = { it.id }) { entry ->
                    FamCard(padding = 12.dp) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                MicroLabel(entry.date)
                                Text(entry.title, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                            }
                            if (entry.isCooked) {
                                Text("Cooked", style = FamTheme.typography.caption, color = HorizonColors.Green)
                            } else {
                                OutlinedButton(
                                    onClick = { onCookEntry(entry.id) },
                                    shape = RoundedCornerShape(8.dp),
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                                ) {
                                    Text("Mark Cooked", style = FamTheme.typography.caption)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ShoppingContent(
    items: List<ShoppingItem>,
    onAddItem: () -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("${items.count { !it.done }} items to buy", style = FamTheme.typography.label, color = FamTheme.colors.textSecond)
            TextButton(onClick = onAddItem) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("Add Item", style = FamTheme.typography.caption)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (items.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Shopping list is clear!", style = FamTheme.typography.body, color = FamTheme.colors.textSecond)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.id }) { item ->
                    FamCard(padding = 8.dp) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = item.done,
                                    onCheckedChange = { onToggle(item.id, it) },
                                    colors = CheckboxDefaults.colors(checkedColor = HorizonColors.Green)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = item.text,
                                    style = FamTheme.typography.body,
                                    color = if (item.done) FamTheme.colors.muted else FamTheme.colors.text
                                )
                            }
                            IconButton(onClick = { onDelete(item.id) }, modifier = Modifier.size(28.dp)) {
                                Icon(Icons.Default.Close, contentDescription = "Remove", tint = FamTheme.colors.muted, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecipesContent(
    recipes: List<Recipe>,
    query: String,
    onQueryChange: (String) -> Unit,
    onSelectRecipe: (Recipe) -> Unit
) {
    val filtered = remember(recipes, query) {
        if (query.isBlank()) recipes
        else recipes.filter { it.title.contains(query, ignoreCase = true) || it.cuisine.contains(query, ignoreCase = true) }
    }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            placeholder = { Text("Search recipes by title or cuisine...") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) }
        )

        Spacer(modifier = Modifier.height(12.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(filtered, key = { it.id }) { recipe ->
                FamCard(
                    modifier = Modifier.clickable { onSelectRecipe(recipe) }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            MicroLabel(recipe.cuisine)
                            Text(recipe.title, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                            Text("${recipe.timeMins} mins • ${recipe.ingredients.size} ingredients", style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                        }
                        recipe.coverage?.let { cov ->
                            val badgeColor = if (cov.coreMissing.isEmpty()) HorizonColors.Green else FamTheme.colors.coral
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(badgeColor.copy(alpha = 0.15f))
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text(
                                    text = if (cov.coreMissing.isEmpty()) "Have all" else "Missing ${cov.coreMissing.size}",
                                    style = FamTheme.typography.caption,
                                    color = badgeColor
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RecipeDetailSheet(recipe: Recipe, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = FamTheme.colors.panel) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            MicroLabel(recipe.cuisine)
            Text(recipe.title, style = FamTheme.typography.largeTitle, color = FamTheme.colors.text)
            Text("Prep & Cook Time: ${recipe.timeMins} mins", style = FamTheme.typography.body, color = FamTheme.colors.textSecond)

            Spacer(modifier = Modifier.height(8.dp))
            Text("Ingredients", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
            recipe.ingredients.forEach { ing ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(FamTheme.colors.accent))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("${ing.name} ${ing.qtyHint ?: ""}", style = FamTheme.typography.body)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
            Text("Steps", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
            recipe.steps.forEachIndexed { idx, step ->
                Text("${idx + 1}. $step", style = FamTheme.typography.body, color = FamTheme.colors.text)
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
fun AddPantryItemDialog(onDismiss: () -> Unit, onConfirm: (String, String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("pantry") }
    var level by remember { mutableStateOf("plenty") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Pantry Item", style = FamTheme.typography.cardTitle) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Item Name") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = category, onValueChange = { category = it }, label = { Text("Category (e.g. dairy, produce)") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            Button(
                onClick = { if (name.isNotBlank()) onConfirm(name.trim(), category.trim(), level) },
                colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
            ) { Text("Add", color = FamTheme.colors.onAccent) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
fun AddShoppingItemDialog(onDismiss: () -> Unit, onConfirm: (String, String?) -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add Shopping Item", style = FamTheme.typography.cardTitle) },
        text = {
            OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("Item to buy") }, modifier = Modifier.fillMaxWidth())
        },
        confirmButton = {
            Button(
                onClick = { if (text.isNotBlank()) onConfirm(text.trim(), null) },
                colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
            ) { Text("Add", color = FamTheme.colors.onAccent) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
