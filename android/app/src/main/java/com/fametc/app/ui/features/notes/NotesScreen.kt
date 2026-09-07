package com.fametc.app.ui.features.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.Note
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun NotesScreen(
    onBack: () -> Unit
) {
    val repository = FamEtcApp.instance.repository
    val notes by repository.notes.collectAsState()
    val scope = rememberCoroutineScope()
    var showAddNoteDialog by remember { mutableStateOf(false) }

    val groupedByDate = remember(notes) {
        notes.groupBy { it.date }.toSortedMap(compareByDescending { it })
    }

    Scaffold(
        containerColor = FamTheme.colors.bg,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = FamTheme.colors.text)
                }
                Spacer(modifier = Modifier.width(4.dp))
                Column {
                    MicroLabel("${notes.size} Reflections")
                    Text("Family Notes", style = FamTheme.typography.title, color = FamTheme.colors.text)
                }
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddNoteDialog = true },
                containerColor = FamTheme.colors.accent,
                contentColor = FamTheme.colors.onAccent,
                shape = CircleShape
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add Note")
            }
        }
    ) { padding ->
        if (groupedByDate.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "No notes saved yet. Pinned quotes, reflections, and thoughts show up here.",
                    style = FamTheme.typography.body,
                    color = FamTheme.colors.textSecond
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                groupedByDate.forEach { (dateStr, dateNotes) ->
                    item {
                        MicroLabel(dateStr)
                        Spacer(modifier = Modifier.height(6.dp))
                        FamCard {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                dateNotes.forEach { note ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = note.body,
                                                style = FamTheme.typography.body,
                                                color = FamTheme.colors.text
                                            )
                                            Text(
                                                text = "Source: ${note.source}",
                                                style = FamTheme.typography.caption,
                                                color = FamTheme.colors.textSecond
                                            )
                                        }

                                        IconButton(
                                            onClick = { scope.launch { repository.deleteNote(note.id) } },
                                            modifier = Modifier.size(28.dp)
                                        ) {
                                            Icon(
                                                Icons.Default.Delete,
                                                contentDescription = "Delete",
                                                tint = FamTheme.colors.muted,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddNoteDialog) {
        AddNoteDialog(
            onDismiss = { showAddNoteDialog = false },
            onConfirm = { body ->
                scope.launch {
                    repository.createNote(body)
                    showAddNoteDialog = false
                }
            }
        )
    }
}

@Composable
private fun AddNoteDialog(
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var body by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Write a Note", style = FamTheme.typography.cardTitle) },
        text = {
            OutlinedTextField(
                value = body,
                onValueChange = { body = it },
                placeholder = { Text("Share a reflection or thought...") },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp)
            )
        },
        confirmButton = {
            Button(
                onClick = { if (body.isNotBlank()) onConfirm(body.trim()) },
                colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
            ) { Text("Save Note", color = FamTheme.colors.onAccent) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
