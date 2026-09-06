package com.fametc.app.ui.features.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fametc.app.FamEtcApp
import com.fametc.app.auth.AuthService
import com.fametc.app.ui.components.AccentButton
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.components.SignalButton
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

private enum class OnboardingMode {
    WELCOME, CREATE, JOIN
}

@Composable
fun OnboardingScreen(
    onFinished: () -> Unit,
    onOpenKidSignIn: () -> Unit,
    onOpenBackupCodeSignIn: () -> Unit
) {
    val context = LocalContext.current
    val authService = remember { AuthService(context) }
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(OnboardingMode.WELCOME) }
    var familyName by remember { mutableStateOf("") }
    var inviteCode by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var backupCodesToShow by remember { mutableStateOf<List<String>?>(null) }

    if (backupCodesToShow != null) {
        RecoveryCodesScreen(
            codes = backupCodesToShow!!,
            onDone = onFinished
        )
        return
    }

    Scaffold(
        containerColor = FamTheme.colors.bg
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Brand Logo / Header
            Box(
                modifier = Modifier
                    .size(68.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(HorizonColors.signalGradient(FamTheme.colors.isDark)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "ETC",
                    style = FamTheme.typography.title,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Fam ETC",
                style = FamTheme.typography.largeTitle,
                color = FamTheme.colors.text
            )

            Text(
                text = "The etcetera hub for your family",
                style = FamTheme.typography.body,
                color = FamTheme.colors.textSecond,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(32.dp))

            errorMessage?.let { msg ->
                FamCard(
                    borderColor = FamTheme.colors.coral,
                    backgroundColor = FamTheme.colors.panel2,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    Text(
                        text = msg,
                        style = FamTheme.typography.caption,
                        color = FamTheme.colors.coral
                    )
                }
            }

            when (mode) {
                OnboardingMode.WELCOME -> {
                    SignalButton(
                        text = "Create a Family",
                        onClick = { mode = OnboardingMode.CREATE },
                        icon = Icons.Default.Add,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    AccentButton(
                        text = "Join with Invite Code",
                        onClick = { mode = OnboardingMode.JOIN },
                        icon = Icons.Default.Group,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Text(
                        text = "Already have an account? Sign in",
                        style = FamTheme.typography.label,
                        color = FamTheme.colors.accent,
                        modifier = Modifier
                            .clickable(enabled = !isLoading) {
                                isLoading = true
                                errorMessage = null
                                scope.launch {
                                    val res = authService.signInWithPasskey()
                                    isLoading = false
                                    res.fold(
                                        onSuccess = { onFinished() },
                                        onFailure = { errorMessage = it.localizedMessage ?: "Sign in failed." }
                                    )
                                }
                            }
                            .padding(8.dp)
                    )

                    Text(
                        text = "Use a recovery backup code",
                        style = FamTheme.typography.caption,
                        color = FamTheme.colors.textSecond,
                        modifier = Modifier
                            .clickable { onOpenBackupCodeSignIn() }
                            .padding(6.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    HorizontalDivider(color = FamTheme.colors.border)

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "I'm a kid joining on my device",
                        style = FamTheme.typography.label,
                        color = FamTheme.colors.muted,
                        modifier = Modifier
                            .clickable { onOpenKidSignIn() }
                            .padding(8.dp)
                    )
                }

                OnboardingMode.CREATE -> {
                    FamCard {
                        MicroLabel("Family Setup")
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("What is your family name?", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = familyName,
                            onValueChange = { familyName = it },
                            label = { Text("Family Name") },
                            placeholder = { Text("e.g. The Kamats") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words)
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = inviteCode,
                            onValueChange = { inviteCode = it },
                            label = { Text("Beta Invite Code") },
                            placeholder = { Text("e.g. fitodds") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Fam ETC is currently invite-only for school parents.",
                            style = FamTheme.typography.caption,
                            color = FamTheme.colors.textSecond
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        SignalButton(
                            text = "Create Passkey & Continue",
                            onClick = {
                                if (familyName.isBlank()) {
                                    errorMessage = "Please enter a family name."
                                    return@SignalButton
                                }
                                if (inviteCode.isBlank()) {
                                    errorMessage = "Please enter your invite code."
                                    return@SignalButton
                                }
                                isLoading = true
                                errorMessage = null
                                scope.launch {
                                    val res = authService.signUpWithPasskey(
                                        name = familyName.trim(),
                                        inviteCode = inviteCode.trim()
                                    )
                                    if (res.isSuccess) {
                                        try {
                                            FamEtcApp.instance.repository.refresh()
                                            com.fametc.app.data.remote.ApiClient.api.createFamily(mapOf("name" to familyName.trim()))
                                            val codes = authService.issueBackupCodes()
                                            isLoading = false
                                            if (!codes.isNullOrEmpty()) {
                                                backupCodesToShow = codes
                                            } else {
                                                onFinished()
                                            }
                                        } catch (e: Exception) {
                                            isLoading = false
                                            errorMessage = authService.extractErrorMessage(e)
                                        }
                                    } else {
                                        isLoading = false
                                        errorMessage = res.exceptionOrNull()?.localizedMessage ?: "Registration failed."
                                    }
                                }
                            },
                            enabled = !isLoading,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    TextButton(onClick = { mode = OnboardingMode.WELCOME }) {
                        Text("Back", color = FamTheme.colors.textSecond)
                    }
                }

                OnboardingMode.JOIN -> {
                    FamCard {
                        MicroLabel("Join Family")
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Enter 6-character Invite Code", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = inviteCode,
                            onValueChange = { inviteCode = it.uppercase() },
                            placeholder = { Text("ABC123") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        AccentButton(
                            text = "Join & Create Passkey",
                            onClick = {
                                if (inviteCode.isBlank()) {
                                    errorMessage = "Please enter the invite code."
                                    return@AccentButton
                                }
                                isLoading = true
                                errorMessage = null
                                scope.launch {
                                    val res = authService.signUpWithPasskey()
                                    if (res.isSuccess) {
                                        try {
                                            FamEtcApp.instance.repository.refresh()
                                            com.fametc.app.data.remote.ApiClient.api.joinFamily(mapOf("code" to inviteCode.trim()))
                                            val codes = authService.issueBackupCodes()
                                            isLoading = false
                                            if (!codes.isNullOrEmpty()) {
                                                backupCodesToShow = codes
                                            } else {
                                                onFinished()
                                            }
                                        } catch (e: Exception) {
                                            isLoading = false
                                            errorMessage = e.localizedMessage ?: "Failed to join family."
                                        }
                                    } else {
                                        isLoading = false
                                        errorMessage = res.exceptionOrNull()?.localizedMessage ?: "Registration failed."
                                    }
                                }
                            },
                            isLoading = isLoading,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    TextButton(onClick = { mode = OnboardingMode.WELCOME }) {
                        Text("Back", color = FamTheme.colors.textSecond)
                    }
                }
            }
        }
    }
}
