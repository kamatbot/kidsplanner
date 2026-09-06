package com.fametc.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fametc.app.data.model.KidAccessRequest
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

@Composable
fun KidApprovalBanner(
    requests: List<KidAccessRequest>,
    onApprove: suspend (String) -> Unit,
    onDeny: suspend (String) -> Unit
) {
    val scope = rememberCoroutineScope()

    AnimatedVisibility(
        visible = requests.isNotEmpty(),
        enter = expandVertically(),
        exit = shrinkVertically()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(FamTheme.colors.panel)
                .border(1.dp, FamTheme.colors.border)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            requests.forEach { req ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(HorizonColors.CoralLight)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Kid Sign-in Request",
                                style = FamTheme.typography.caption,
                                color = FamTheme.colors.coral
                            )
                        }
                        Text(
                            text = "${req.name} (${req.deviceLabel ?: "a device"})",
                            style = FamTheme.typography.cardTitle,
                            color = FamTheme.colors.text
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconButton(
                            onClick = { scope.launch { onDeny(req.id) } },
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(FamTheme.colors.panel2)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Deny", tint = FamTheme.colors.muted, modifier = Modifier.size(18.dp))
                        }

                        Button(
                            onClick = { scope.launch { onApprove(req.id) } },
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = FamTheme.colors.accent),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                            modifier = Modifier.height(36.dp)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null, tint = FamTheme.colors.onAccent, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Let in", style = FamTheme.typography.label, color = FamTheme.colors.onAccent)
                        }
                    }
                }
            }
        }
    }
}
