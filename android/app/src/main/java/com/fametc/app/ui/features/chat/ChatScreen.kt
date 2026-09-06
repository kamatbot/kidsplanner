package com.fametc.app.ui.features.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import java.text.SimpleDateFormat
import com.fametc.app.FamEtcApp
import com.fametc.app.data.model.ChatMessage
import com.fametc.app.data.model.ChatRoom
import com.fametc.app.data.model.FAMILY_ROOM_ID
import com.fametc.app.data.model.GifResult
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatScreen() {
    val repository = FamEtcApp.instance.repository
    val rooms by repository.chatRooms.collectAsState()
    val messagesByRoom by repository.messagesByRoom.collectAsState()
    val isParent = repository.isParent
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var currentRoomId by remember { mutableStateOf(FAMILY_ROOM_ID) }
    var draftText by remember { mutableStateOf("") }
    var showRoomPicker by remember { mutableStateOf(false) }
    var showGifPicker by remember { mutableStateOf(false) }
    var showBuzzConfirmation by remember { mutableStateOf(false) }
    var selectedMessageForAction by remember { mutableStateOf<ChatMessage?>(null) }

    val currentMessages = messagesByRoom[currentRoomId] ?: emptyList()
    val listState = rememberLazyListState()

    // Attach to active room loop
    LaunchedEffect(currentRoomId) {
        repository.setActiveRoom(currentRoomId)
    }

    // Scroll to bottom on new messages
    LaunchedEffect(currentMessages.size) {
        if (currentMessages.isNotEmpty()) {
            listState.animateScrollToItem(currentMessages.size - 1)
        }
    }

    // File / Photo picker launcher
    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val uploadRes = ChatAttachmentHelper.uploadAttachment(context, uri, currentRoomId)
                if (uploadRes.isSuccess) {
                    repository.refresh()
                }
            }
        }
    }

    Scaffold(
        containerColor = FamTheme.colors.bg,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(FamTheme.colors.panel)
                    .border(1.dp, FamTheme.colors.border)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    MicroLabel(if (currentRoomId == FAMILY_ROOM_ID) "Family Chat" else "Trip Chat")
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.clickable { showRoomPicker = true }
                    ) {
                        val currentRoomTitle = rooms.firstOrNull { it.roomId == currentRoomId }?.title ?: "Chat"
                        Text(currentRoomTitle, style = FamTheme.typography.title, color = FamTheme.colors.text)
                        if (rooms.size > 1) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = FamTheme.colors.textSecond)
                        }
                    }
                }

                // Buzz button
                IconButton(
                    onClick = { showBuzzConfirmation = true },
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(HorizonColors.CoralLight.copy(alpha = 0.15f))
                ) {
                    Icon(Icons.Default.NotificationsActive, contentDescription = "Buzz", tint = HorizonColors.CoralLight, modifier = Modifier.size(20.dp))
                }

                DropdownMenu(
                    expanded = showRoomPicker,
                    onDismissRequest = { showRoomPicker = false },
                    modifier = Modifier.background(FamTheme.colors.panel)
                ) {
                    rooms.forEach { r ->
                        DropdownMenuItem(
                            text = { Text(r.title, style = FamTheme.typography.body) },
                            onClick = {
                                currentRoomId = r.roomId
                                showRoomPicker = false
                            }
                        )
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Messages List
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(currentMessages, key = { it.id }) { msg ->
                    val isMine = repository.isMine(msg)
                    val senderDisplayName = repository.senderName(msg)
                    MessageBubble(
                        message = msg,
                        isMine = isMine,
                        senderName = senderDisplayName,
                        onLongClick = { selectedMessageForAction = msg }
                    )
                }
            }

            // Chat Composer
            Surface(
                color = FamTheme.colors.panel,
                shadowElevation = 8.dp,
                modifier = Modifier.fillMaxWidth().padding(bottom = 64.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { photoPickerLauncher.launch("image/*") }) {
                        Icon(Icons.Default.AddPhotoAlternate, contentDescription = "Add Media", tint = FamTheme.colors.muted)
                    }

                    IconButton(onClick = { showGifPicker = true }) {
                        Icon(Icons.Default.Gif, contentDescription = "GIF", tint = FamTheme.colors.muted)
                    }

                    OutlinedTextField(
                        value = draftText,
                        onValueChange = { draftText = it },
                        placeholder = { Text("Message...", style = FamTheme.typography.body) },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 42.dp),
                        shape = RoundedCornerShape(24.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = FamTheme.colors.accent,
                            unfocusedBorderColor = FamTheme.colors.border,
                            focusedContainerColor = FamTheme.colors.panel2,
                            unfocusedContainerColor = FamTheme.colors.panel2
                        )
                    )

                    Spacer(modifier = Modifier.width(6.dp))

                    IconButton(
                        onClick = {
                            if (draftText.isNotBlank()) {
                                val textToSend = draftText.trim()
                                draftText = ""
                                scope.launch {
                                    repository.postChatMessage(textToSend, currentRoomId)
                                }
                            }
                        },
                        enabled = draftText.isNotBlank(),
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(if (draftText.isNotBlank()) FamTheme.colors.accent else FamTheme.colors.panel2)
                    ) {
                        Icon(
                            Icons.Default.ArrowUpward,
                            contentDescription = "Send",
                            tint = if (draftText.isNotBlank()) Color.White else FamTheme.colors.muted,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }

    // Buzz Dialog
    if (showBuzzConfirmation) {
        AlertDialog(
            onDismissRequest = { showBuzzConfirmation = false },
            title = { Text("Send a Buzz?", style = FamTheme.typography.cardTitle) },
            text = { Text("This sends an urgent Time Sensitive alert to everyone in this chat.") },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch { repository.sendBuzz(currentRoomId) }
                        showBuzzConfirmation = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = HorizonColors.CoralLight)
                ) { Text("Send Buzz", color = Color.White) }
            },
            dismissButton = {
                TextButton(onClick = { showBuzzConfirmation = false }) { Text("Cancel") }
            }
        )
    }

    // GIF Picker Modal
    if (showGifPicker) {
        GifPickerModal(
            onDismiss = { showGifPicker = false },
            onGifSelected = { gifUrl ->
                scope.launch {
                    repository.postChatMessage(gifUrl, currentRoomId)
                    showGifPicker = false
                }
            }
        )
    }

    // Long Press Message Action Menu
    selectedMessageForAction?.let { msg ->
        AlertDialog(
            onDismissRequest = { selectedMessageForAction = null },
            title = { Text("Message Actions", style = FamTheme.typography.cardTitle) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                val todayIso = SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
                                repository.addFamilyEvent(title = msg.text.take(40), date = todayIso)
                                selectedMessageForAction = null
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.CalendarToday, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Add to Calendar", modifier = Modifier.weight(1f))
                    }

                    TextButton(
                        onClick = {
                            scope.launch {
                                repository.addShoppingItem(msg.text.take(50))
                                selectedMessageForAction = null
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.ShoppingCart, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Add to Shopping List", modifier = Modifier.weight(1f))
                    }

                    if (isParent || repository.isMine(msg)) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    repository.deleteChatMessage(msg.id, currentRoomId)
                                    selectedMessageForAction = null
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = null, tint = FamTheme.colors.coral)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Delete Message", color = FamTheme.colors.coral, modifier = Modifier.weight(1f))
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { selectedMessageForAction = null }) { Text("Cancel") }
            }
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageBubble(
    message: ChatMessage,
    isMine: Boolean,
    senderName: String,
    onLongClick: () -> Unit
) {
    val align = if (isMine) Alignment.End else Alignment.Start

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp),
        horizontalAlignment = align
    ) {
        if (!isMine) {
            Text(
                text = senderName,
                style = FamTheme.typography.caption,
                color = FamTheme.colors.textSecond,
                modifier = Modifier.padding(start = 12.dp, bottom = 2.dp)
            )
        }

        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomStart = if (isMine) 18.dp else 4.dp,
                        bottomEnd = if (isMine) 4.dp else 18.dp
                    )
                )
                .then(
                    if (isMine) Modifier.background(HorizonColors.signalGradient(FamTheme.colors.isDark))
                    else Modifier.background(FamTheme.colors.panel)
                )
                .border(
                    width = if (isMine) 0.dp else 1.dp,
                    color = if (isMine) Color.Transparent else FamTheme.colors.border,
                    shape = RoundedCornerShape(18.dp)
                )
                .combinedClickable(
                    onLongClick = onLongClick,
                    onClick = {}
                )
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Column {
                if (message.isBuzz) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.NotificationsActive, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("BUZZ", style = FamTheme.typography.cardTitle, color = Color.White)
                    }
                }

                if (message.media?.isGif == true || message.text.startsWith("http") && message.text.contains("giphy")) {
                    val gifUrl = message.media?.url ?: message.text
                    AsyncImage(
                        model = gifUrl,
                        contentDescription = "GIF",
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp)
                            .clip(RoundedCornerShape(8.dp))
                    )
                } else if (message.text.isNotBlank()) {
                    Text(
                        text = message.text,
                        style = FamTheme.typography.body,
                        color = if (isMine) Color.White else FamTheme.colors.text
                    )
                }
            }
        }
    }
}

@Composable
fun GifPickerModal(
    onDismiss: () -> Unit,
    onGifSelected: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var gifs by remember { mutableStateOf<List<GifResult>>(emptyList()) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            gifs = ApiClient.api.trendingGifs().gifs
        } catch (e: Exception) {}
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a GIF", style = FamTheme.typography.cardTitle) },
        text = {
            Column(modifier = Modifier.fillMaxWidth().height(350.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = {
                        query = it
                        scope.launch {
                            try {
                                gifs = if (it.isBlank()) ApiClient.api.trendingGifs().gifs
                                else ApiClient.api.searchGifs(it).gifs
                            } catch (e: Exception) {}
                        }
                    },
                    placeholder = { Text("Search Giphy...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(10.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(gifs) { gif ->
                        AsyncImage(
                            model = gif.previewUrl,
                            contentDescription = null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(120.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .clickable { onGifSelected(gif.url) }
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}
