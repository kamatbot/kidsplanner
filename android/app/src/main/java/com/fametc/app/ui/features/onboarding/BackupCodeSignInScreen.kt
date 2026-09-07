package com.fametc.app.ui.features.onboarding

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.fametc.app.auth.AuthService
import com.fametc.app.ui.components.AccentButton
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import kotlinx.coroutines.launch

@Composable
fun BackupCodeSignInScreen(
    onDone: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val authService = remember { AuthService(context) }
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Scaffold(containerColor = FamTheme.colors.bg) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            FamCard {
                MicroLabel("Account Recovery")
                Spacer(modifier = Modifier.height(8.dp))
                Text("Enter Recovery Backup Code", style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "If you lost access to your device, passkey, or are signing in on a new device, you can redeem one of your 10 one-time recovery codes.",
                    style = FamTheme.typography.caption,
                    color = FamTheme.colors.textSecond
                )
                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.uppercase() },
                    placeholder = { Text("e.g. ABCDE-FGHJK") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Spacer(modifier = Modifier.height(20.dp))

                AccentButton(
                    text = "Sign In with Backup Code",
                    onClick = {
                        if (code.isBlank()) {
                            errorMessage = "Please enter your backup code."
                            return@AccentButton
                        }
                        isLoading = true
                        errorMessage = null
                        scope.launch {
                            val res = authService.signInWithBackupCode(code)
                            isLoading = false
                            res.fold(
                                onSuccess = { onDone() },
                                onFailure = { errorMessage = it.localizedMessage ?: "Invalid backup code." }
                            )
                        }
                    },
                    isLoading = isLoading,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            errorMessage?.let {
                Spacer(modifier = Modifier.height(12.dp))
                Text(text = it, color = FamTheme.colors.coral, style = FamTheme.typography.caption)
            }

            Spacer(modifier = Modifier.height(16.dp))

            TextButton(onClick = onBack) {
                Text("Back", color = FamTheme.colors.textSecond)
            }
        }
    }
}
