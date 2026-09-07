package com.fametc.app.ui.features.planning

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.ScannedPantryItem
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.ui.components.AccentButton
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.components.SignalButton
import com.fametc.app.ui.theme.FamTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream

@Composable
fun PantryScannerDialog(
    onDismiss: () -> Unit,
    onImportSuccess: () -> Unit
) {
    val context = LocalContext.current
    val repository = FamEtcApp.instance.repository
    val scope = rememberCoroutineScope()
    var scannedItems by remember { mutableStateOf<List<ScannedPantryItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            isLoading = true
            errorMessage = null
            scope.launch {
                try {
                    val items = parsePantryImage(context, uri)
                    scannedItems = items
                } catch (e: Exception) {
                    errorMessage = e.localizedMessage ?: "Failed to scan image."
                } finally {
                    isLoading = false
                }
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                MicroLabel("AI Vision OCR")
                Text("Pantry Scanner", style = FamTheme.typography.cardTitle)
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 400.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (scannedItems.isEmpty()) {
                    Text(
                        text = "Take or choose a photo of your fridge or pantry shelf. AI will automatically identify items and stock levels.",
                        style = FamTheme.typography.body,
                        color = FamTheme.colors.textSecond
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    AccentButton(
                        text = "Choose Photo",
                        onClick = { photoPickerLauncher.launch("image/*") },
                        icon = Icons.Default.AddPhotoAlternate,
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (isLoading) {
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally), color = FamTheme.colors.accent)
                    }
                } else {
                    Text("Detected ${scannedItems.size} items:", style = FamTheme.typography.label)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(scannedItems) { item ->
                            FamCard(padding = 10.dp) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text(item.name, style = FamTheme.typography.cardTitle)
                                        Text("${item.category} • ${item.levelGuess}", style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                                    }
                                }
                            }
                        }
                    }
                }

                errorMessage?.let {
                    Text(it, color = FamTheme.colors.coral, style = FamTheme.typography.caption)
                }
            }
        },
        confirmButton = {
            if (scannedItems.isNotEmpty()) {
                Button(
                    onClick = {
                        scope.launch {
                            for (item in scannedItems) {
                                repository.addPantryItem(item.name, item.category, item.levelGuess)
                            }
                            onImportSuccess()
                            onDismiss()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent)
                ) {
                    Text("Add All to Pantry", color = FamTheme.colors.onAccent)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

private suspend fun parsePantryImage(context: Context, uri: Uri): List<ScannedPantryItem> = withContext(Dispatchers.IO) {
    val inputStream = context.contentResolver.openInputStream(uri) ?: throw Exception("Cannot open image.")
    val tempFile = File(context.cacheDir, "pantry_scan_${System.currentTimeMillis()}.jpg")
    FileOutputStream(tempFile).use { output -> inputStream.copyTo(output) }

    val requestFile = tempFile.asRequestBody("image/jpeg".toMediaTypeOrNull())
    val filePart = MultipartBody.Part.createFormData("file", tempFile.name, requestFile)
    val kindPart = "pantry".toRequestBody("text/plain".toMediaTypeOrNull())

    val response = ApiClient.api.parsePantryImage(filePart, kindPart)
    tempFile.delete()
    response.items
}
