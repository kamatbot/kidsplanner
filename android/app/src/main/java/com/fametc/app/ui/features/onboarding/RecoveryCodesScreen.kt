package com.fametc.app.ui.features.onboarding

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fametc.app.ui.components.AccentButton
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.components.SignalButton
import com.fametc.app.ui.theme.FamTheme

@Composable
fun RecoveryCodesScreen(
    codes: List<String>,
    onDone: () -> Unit
) {
    val context = LocalContext.current
    var hasCopied by remember { mutableStateOf(false) }

    Scaffold(containerColor = FamTheme.colors.bg) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(24.dp))
            MicroLabel("Security First")
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Save Your Recovery Codes",
                style = FamTheme.typography.largeTitle,
                color = FamTheme.colors.text,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Each code can only be used once if you ever lose your phone or passkey. Store them somewhere safe offline.",
                style = FamTheme.typography.body,
                color = FamTheme.colors.textSecond,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(24.dp))

            FamCard {
                // 2 columns of 5 codes
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    codes.chunked(2).forEach { rowCodes ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceEvenly
                        ) {
                            rowCodes.forEach { code ->
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(horizontal = 4.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(FamTheme.colors.panel2)
                                        .border(1.dp, FamTheme.colors.border, RoundedCornerShape(8.dp))
                                        .padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = code,
                                        style = FamTheme.typography.mono,
                                        color = FamTheme.colors.text
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedButton(
                    onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        val clip = ClipData.newPlainText("Fam ETC Recovery Codes", codes.joinToString("\n"))
                        clipboard.setPrimaryClip(clip)
                        hasCopied = true
                        Toast.makeText(context, "Recovery codes copied to clipboard", Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(if (hasCopied) "Copied to Clipboard!" else "Copy All Codes", style = FamTheme.typography.cardTitle)
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            SignalButton(
                text = "I've Saved These Codes",
                onClick = onDone,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
