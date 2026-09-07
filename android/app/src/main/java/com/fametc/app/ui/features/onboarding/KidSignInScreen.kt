package com.fametc.app.ui.features.onboarding

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fametc.app.auth.AuthService
import com.fametc.app.ui.components.AccentButton
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.components.SignalButton
import com.fametc.app.ui.theme.FamTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun KidSignInScreen(
    onDone: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val authService = remember { AuthService(context) }
    val scope = rememberCoroutineScope()

    var inviteCode by remember { mutableStateOf("") }
    var kidName by remember { mutableStateOf("") }
    var requestId by remember { mutableStateOf<String?>(null) }
    var pollToken by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Start polling when request is submitted
    LaunchedEffect(requestId, pollToken) {
        val reqId = requestId ?: return@LaunchedEffect
        val token = pollToken ?: return@LaunchedEffect
        while (status != "approved" && status != "denied") {
            delay(2000)
            val currStatus = authService.pollKidAccessStatus(reqId, token)
            status = currStatus
            if (currStatus == "approved") {
                // Register kid's passkey directly on device
                val regRes = authService.registerKidPasskey(reqId, token)
                if (regRes.isSuccess) {
                    onDone()
                } else {
                    errorMessage = regRes.exceptionOrNull()?.localizedMessage ?: "Passkey registration failed."
                }
                break
            } else if (currStatus == "denied") {
                errorMessage = "Your request was declined by a parent."
                break
            }
        }
    }

    Scaffold(containerColor = FamTheme.colors.bg) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            if (requestId == null) {
                FamCard {
                    MicroLabel("Kid Sign-in")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Ask your parent for the Invite Code", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = inviteCode,
                        onValueChange = { inviteCode = it.uppercase() },
                        label = { Text("Family Invite Code") },
                        placeholder = { Text("ABC123") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = kidName,
                        onValueChange = { kidName = it },
                        label = { Text("Your First Name") },
                        placeholder = { Text("e.g. Leo") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )

                    Spacer(modifier = Modifier.height(20.dp))

                    SignalButton(
                        text = "Ask Parent to Let Me In",
                        onClick = {
                            if (inviteCode.isBlank() || kidName.isBlank()) {
                                errorMessage = "Please enter both the invite code and your name."
                                return@SignalButton
                            }
                            isLoading = true
                            errorMessage = null
                            scope.launch {
                                val res = authService.requestKidAccess(inviteCode, kidName)
                                isLoading = false
                                res.fold(
                                    onSuccess = {
                                        requestId = it.requestId
                                        pollToken = it.pollToken
                                        status = "pending"
                                    },
                                    onFailure = { errorMessage = it.localizedMessage ?: "Request failed." }
                                )
                            }
                        },
                        enabled = !isLoading,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            } else {
                FamCard(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth().padding(16.dp)
                    ) {
                        CircularProgressIndicator(color = FamTheme.colors.accent)
                        Spacer(modifier = Modifier.height(20.dp))
                        Text(
                            text = "Waiting for parent approval…",
                            style = FamTheme.typography.title,
                            color = FamTheme.colors.text,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "A parent will see a notification on their device to let $kidName in.",
                            style = FamTheme.typography.body,
                            color = FamTheme.colors.textSecond,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }

            errorMessage?.let {
                Spacer(modifier = Modifier.height(16.dp))
                Text(text = it, color = FamTheme.colors.coral, style = FamTheme.typography.caption)
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(onClick = onBack) {
                Text("Back to Sign In", color = FamTheme.colors.textSecond)
            }
        }
    }
}
