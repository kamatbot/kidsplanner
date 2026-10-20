@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.fametc.portal

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Locale

@Composable
fun PortalSettings(
    preferences: PortalPreferences,
    device: DisplayDevice?,
    paired: Boolean,
    onChange: (PortalPreferences) -> Unit,
    onClose: () -> Unit,
    onUnpair: () -> Unit,
) {
    var confirmingUnpair by rememberSaveable { mutableStateOf(false) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth(.94f).fillMaxHeight(.92f),
            shape = RoundedCornerShape(24.dp), color = PortalColors.Panel,
        ) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Display settings", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
                    ActionIcon(Icons.Outlined.Close, "Close display settings", onClose)
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    SettingsSection("Screen") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            SettingChip("Always on", preferences.screenMode == ScreenMode.ALWAYS) { onChange(preferences.copy(screenMode = ScreenMode.ALWAYS)) }
                            SettingChip("Night schedule", preferences.screenMode == ScreenMode.SCHEDULED) { onChange(preferences.copy(screenMode = ScreenMode.SCHEDULED)) }
                            SettingChip("Normal sleep", preferences.screenMode == ScreenMode.NORMAL) { onChange(preferences.copy(screenMode = ScreenMode.NORMAL)) }
                        }
                        Text(
                            when (preferences.screenMode) {
                                ScreenMode.ALWAYS -> "Keeps your family board visible while Fam ETC is open."
                                ScreenMode.SCHEDULED -> "Dims during quiet hours and lets the Portal sleep. A touch brightens the screen for two minutes."
                                ScreenMode.NORMAL -> "Uses the Portal’s usual screen timeout."
                            },
                            style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary,
                        )
                        if (preferences.screenMode == ScreenMode.SCHEDULED) {
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                HourPicker("Dim from", preferences.nightStartHour, Modifier.weight(1f)) { onChange(preferences.copy(nightStartHour = it)) }
                                HourPicker("Until", preferences.nightEndHour, Modifier.weight(1f)) { onChange(preferences.copy(nightEndHour = it)) }
                            }
                            Text(
                                if (preferences.nightStartHour == preferences.nightEndHour) "Choose different start and end times to enable night dimming."
                                else "Times use ${device?.timeZone ?: "Asia/Bangkok"}.",
                                style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary,
                            )
                            Notice("If the Portal goes to sleep, wake it using the device’s controls. Fam ETC cannot automatically wake a sleeping Portal.", Icons.Outlined.Info, PortalColors.Secondary)
                        }
                    }
                    HorizontalDivider(color = PortalColors.Stroke)
                    SettingsSection("Orientation") {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SettingChip("Auto", preferences.orientation == ScreenOrientation.AUTO) { onChange(preferences.copy(orientation = ScreenOrientation.AUTO)) }
                            SettingChip("Landscape", preferences.orientation == ScreenOrientation.LANDSCAPE) { onChange(preferences.copy(orientation = ScreenOrientation.LANDSCAPE)) }
                            SettingChip("Portrait", preferences.orientation == ScreenOrientation.PORTRAIT) { onChange(preferences.copy(orientation = ScreenOrientation.PORTRAIT)) }
                        }
                        Text("Landscape gives the calendar more room on Portal+.", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
                    }
                    HorizontalDivider(color = PortalColors.Stroke)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Bigger text", style = MaterialTheme.typography.titleMedium)
                            Text("A little easier to read across the room.", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
                        }
                        Switch(checked = preferences.biggerText, onCheckedChange = { onChange(preferences.copy(biggerText = it)) }, modifier = Modifier.sizeIn(minWidth = 56.dp, minHeight = 56.dp).semantics { contentDescription = "Bigger text" })
                    }
                    HorizontalDivider(color = PortalColors.Stroke)
                    SettingsSection(if (paired) device?.label?.ifBlank { "This display" } ?: "This display" else "Connect from your phone") {
                        Text("Choose which family information appears, change the time zone or remove this display from:", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
                        Text(PortalApi.SETUP_ADDRESS, style = MaterialTheme.typography.labelLarge, color = PortalColors.Violet)
                        if (paired) OutlinedButton(onClick = { confirmingUnpair = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = PortalColors.Error)) {
                            Text("Disconnect this display")
                        }
                    }
                    Text("Open Fam ETC from the Portal’s app list after a restart.", style = MaterialTheme.typography.bodyMedium, color = PortalColors.Secondary)
                }
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Done") }
            }
        }
    }
    if (confirmingUnpair) AlertDialog(
        onDismissRequest = { confirmingUnpair = false },
        title = { Text("Disconnect this Portal?") },
        text = { Text("Your saved family view will be removed from this device. You can connect it again with a new code from your phone.") },
        confirmButton = { TextButton(onClick = { confirmingUnpair = false; onUnpair() }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Disconnect", color = PortalColors.Error) } },
        dismissButton = { TextButton(onClick = { confirmingUnpair = false }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Keep connected") } },
    )
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
private fun SettingChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) }, modifier = Modifier.heightIn(min = 52.dp))
}

@Composable
private fun HourPicker(label: String, hour: Int, modifier: Modifier, onSelect: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = PortalColors.Secondary)
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(12.dp)) {
                Text(String.format(Locale.ROOT, "%02d:00", hour), Modifier.weight(1f))
                Icon(Icons.Outlined.ArrowDropDown, "Choose $label time")
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, modifier = Modifier.heightIn(max = 340.dp)) {
                (0..23).forEach { value ->
                    DropdownMenuItem(text = { Text(String.format(Locale.ROOT, "%02d:00", value)) }, onClick = { expanded = false; onSelect(value) }, modifier = Modifier.heightIn(min = 52.dp))
                }
            }
        }
    }
}
