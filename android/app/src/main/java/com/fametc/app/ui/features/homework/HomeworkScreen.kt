package com.fametc.app.ui.features.homework

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
import com.fametc.app.data.model.HomeworkChecklistItem
import com.fametc.app.data.model.HomeworkItem
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

@Composable
fun HomeworkScreen() {
    val repository = FamEtcApp.instance.repository
    val homework by repository.homework.collectAsState()
    val isParent = repository.isParent
    val kids = repository.kids
    val mutationIDs by repository.homeworkMutationIDs.collectAsState()
    val scope = rememberCoroutineScope()

    var selectedKidId by remember { mutableStateOf<String?>(null) }
    var selectedHomeworkForDetail by remember { mutableStateOf<HomeworkItem?>(null) }

    val filteredHomework = remember(homework, selectedKidId) {
        val list = if (selectedKidId == null) homework
        else homework.filter { it.kidId == null || it.kidId == selectedKidId }
        list.sortedWith(
            compareBy<HomeworkItem> { it.isDone }
                .thenBy { it.dueDate }
                .thenBy { it.dueTime ?: "23:59" }
        )
    }

    Scaffold(containerColor = FamTheme.colors.bg) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    MicroLabel("Academics")
                    Text("Homework Hub", style = FamTheme.typography.title, color = FamTheme.colors.text)
                }
            }

            // Kid Filter Bar for Parents
            if (isParent && kids.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = selectedKidId == null,
                        onClick = { selectedKidId = null },
                        label = { Text("All Children", style = FamTheme.typography.caption) }
                    )
                    kids.forEach { kid ->
                        FilterChip(
                            selected = selectedKidId == kid.id,
                            onClick = { selectedKidId = kid.id },
                            label = { Text(kid.name, style = FamTheme.typography.caption) }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            if (filteredHomework.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No homework assigned right now!",
                        style = FamTheme.typography.body,
                        color = FamTheme.colors.textSecond
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(filteredHomework, key = { it.id }) { item ->
                        val isMutating = mutationIDs.contains(item.id)
                        HomeworkRowCard(
                            item = item,
                            isMutating = isMutating,
                            canMutate = !isParent,
                            onToggleDone = {
                                scope.launch {
                                    val newStatus = if (item.isDone) "todo" else "done"
                                    repository.setHomeworkStatus(item.id, newStatus)
                                }
                            },
                            onClick = { selectedHomeworkForDetail = item }
                        )
                    }
                }
            }
        }
    }

    selectedHomeworkForDetail?.let { item ->
        HomeworkDetailSheet(
            item = item,
            canEditChecklist = !isParent,
            onDismiss = { selectedHomeworkForDetail = null },
            onToggleStep = { index, done ->
                scope.launch {
                    repository.setHomeworkChecklistStep(item.id, index, done)
                }
            },
            onStatusChange = { newStatus ->
                scope.launch {
                    repository.setHomeworkStatus(item.id, newStatus)
                }
            }
        )
    }
}

@Composable
private fun HomeworkRowCard(
    item: HomeworkItem,
    isMutating: Boolean,
    canMutate: Boolean,
    onToggleDone: () -> Unit,
    onClick: () -> Unit
) {
    FamCard(
        modifier = Modifier.clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                // Checkbox / Done toggle
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (item.isDone) HorizonColors.Green else Color.Transparent)
                        .border(
                            1.5.dp,
                            if (item.isDone) HorizonColors.Green else FamTheme.colors.border,
                            RoundedCornerShape(6.dp)
                        )
                        .clickable(enabled = canMutate && !isMutating, onClick = onToggleDone),
                    contentAlignment = Alignment.Center
                ) {
                    if (isMutating) {
                        CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp, color = FamTheme.colors.accent)
                    } else if (item.isDone) {
                        Icon(Icons.Default.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    item.subject?.let {
                        Text(it.uppercase(), style = FamTheme.typography.caption, color = FamTheme.colors.accent)
                    }
                    Text(
                        text = item.title,
                        style = FamTheme.typography.cardTitle,
                        color = if (item.isDone) FamTheme.colors.muted else FamTheme.colors.text
                    )
                    Text(
                        text = "Due ${item.dueDate} ${item.dueTime ?: ""}",
                        style = FamTheme.typography.caption,
                        color = if (item.isDone) FamTheme.colors.muted else FamTheme.colors.coral
                    )
                }
            }

            // Checklist counter badge
            if (item.items.isNotEmpty()) {
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(FamTheme.colors.panel2)
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                ) {
                    Text(
                        text = "${item.completedChecklistCount}/${item.items.size}",
                        style = FamTheme.typography.mono,
                        color = FamTheme.colors.textSecond
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeworkDetailSheet(
    item: HomeworkItem,
    canEditChecklist: Boolean,
    onDismiss: () -> Unit,
    onToggleStep: (Int, Boolean) -> Unit,
    onStatusChange: (String) -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = FamTheme.colors.panel
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    item.subject?.let { MicroLabel(it) }
                    Text(item.title, style = FamTheme.typography.title, color = FamTheme.colors.text)
                }
            }

            Text("Due Date: ${item.dueDate} ${item.dueTime ?: ""}", style = FamTheme.typography.body, color = FamTheme.colors.coral)

            item.notes?.let {
                Text(it, style = FamTheme.typography.body, color = FamTheme.colors.textSecond)
            }

            // Checklist Steps
            if (item.items.isNotEmpty()) {
                Text("Checklist Steps", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item.items.forEachIndexed { index, step ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(FamTheme.colors.panel2)
                                .clickable(enabled = canEditChecklist) {
                                    onToggleStep(index, !step.done)
                                }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = step.done,
                                onCheckedChange = { if (canEditChecklist) onToggleStep(index, it) },
                                colors = CheckboxDefaults.colors(checkedColor = HorizonColors.Green)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(step.text, style = FamTheme.typography.body, color = FamTheme.colors.text)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
