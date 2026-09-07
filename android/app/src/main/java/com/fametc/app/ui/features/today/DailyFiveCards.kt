package com.fametc.app.ui.features.today

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import com.fametc.app.data.model.*
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.ui.components.FamCard
import com.fametc.app.ui.components.MicroLabel
import com.fametc.app.ui.theme.FamTheme
import com.fametc.app.ui.theme.HorizonColors
import kotlinx.coroutines.launch

@Composable
fun DailyFiveCard(
    onPinQuoteToNotes: (String) -> Unit
) {
    var isExpanded by remember { mutableStateOf(false) }
    var brainTeaser by remember { mutableStateOf<BrainTeaserQ?>(null) }
    var wordQuiz by remember { mutableStateOf<WordQuizQuestion?>(null) }
    var recentNews by remember { mutableStateOf<List<RecentNewsItem>>(emptyList()) }
    var puzzle by remember { mutableStateOf<DailyPuzzleResponse?>(null) }
    var selectedQuizAnswer by remember { mutableStateOf<Int?>(null) }
    var showTeaserAnswer by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        scope.launch {
            try {
                val bt = ApiClient.api.brainTeaserToday()
                brainTeaser = bt.questions.firstOrNull()
            } catch (e: Exception) {}
            try {
                val wq = ApiClient.api.wordQuiz()
                wordQuiz = wq.questions.firstOrNull()
            } catch (e: Exception) {}
            try {
                val news = ApiClient.api.recentNews()
                recentNews = news.items.take(3)
            } catch (e: Exception) {}
            try {
                puzzle = ApiClient.api.dailyPuzzle()
            } catch (e: Exception) {}
        }
    }

    FamCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { isExpanded = !isExpanded }
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(FamTheme.colors.accentSoft),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.School,
                        contentDescription = null,
                        tint = FamTheme.colors.accent,
                        modifier = Modifier.size(18.dp)
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    MicroLabel("Learning Habit")
                    Text(
                        text = "Daily 5",
                        style = FamTheme.typography.cardTitle,
                        color = FamTheme.colors.text
                    )
                }
            }
            Icon(
                imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                contentDescription = null,
                tint = FamTheme.colors.muted
            )
        }

        AnimatedVisibility(visible = isExpanded) {
            Column(
                modifier = Modifier.padding(top = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 1. Word Bank / SAT Quiz
                wordQuiz?.let { q ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(FamTheme.colors.panel2)
                            .padding(12.dp)
                    ) {
                        MicroLabel("Vocabulary • SAT Word")
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(q.word, style = FamTheme.typography.cardTitle, color = FamTheme.colors.text)
                        Text(q.prompt, style = FamTheme.typography.body, color = FamTheme.colors.textSecond)
                        Spacer(modifier = Modifier.height(8.dp))
                        q.options.forEachIndexed { idx, opt ->
                            val isSelected = selectedQuizAnswer == idx
                            val isCorrect = idx == q.answerIndex
                            val bg = when {
                                selectedQuizAnswer == null -> FamTheme.colors.panel
                                isSelected && isCorrect -> HorizonColors.Green.copy(alpha = 0.2f)
                                isSelected && !isCorrect -> HorizonColors.Red.copy(alpha = 0.2f)
                                isCorrect -> HorizonColors.Green.copy(alpha = 0.2f)
                                else -> FamTheme.colors.panel
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(bg)
                                    .border(1.dp, FamTheme.colors.border, RoundedCornerShape(8.dp))
                                    .clickable(enabled = selectedQuizAnswer == null) {
                                        selectedQuizAnswer = idx
                                    }
                                    .padding(horizontal = 12.dp, vertical = 8.dp)
                            ) {
                                Text(opt, style = FamTheme.typography.label, color = FamTheme.colors.text)
                            }
                        }
                    }
                }

                // 2. Brain Teaser
                brainTeaser?.let { bt ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(FamTheme.colors.panel2)
                            .padding(12.dp)
                    ) {
                        MicroLabel("Brain Teaser of the Day")
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(bt.q, style = FamTheme.typography.body, color = FamTheme.colors.text)
                        Spacer(modifier = Modifier.height(8.dp))
                        if (!showTeaserAnswer) {
                            TextButton(onClick = { showTeaserAnswer = true }) {
                                Text("Reveal Answer", style = FamTheme.typography.label, color = FamTheme.colors.accent)
                            }
                        } else {
                            val answerText = bt.options.getOrNull(bt.answerIndex) ?: "Answer revealed"
                            Text(
                                text = "Answer: $answerText",
                                style = FamTheme.typography.cardTitle,
                                color = FamTheme.colors.accent
                            )
                            bt.exp?.let { exp ->
                                Text(exp, style = FamTheme.typography.caption, color = FamTheme.colors.textSecond)
                            }
                        }
                    }
                }

                // 3. Daily News
                if (recentNews.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(FamTheme.colors.panel2)
                            .padding(12.dp)
                    ) {
                        MicroLabel("Current Affairs")
                        Spacer(modifier = Modifier.height(6.dp))
                        recentNews.forEach { item ->
                            Text(item.headline, style = FamTheme.typography.label, color = FamTheme.colors.text)
                            Text(item.summary, style = FamTheme.typography.caption, color = FamTheme.colors.textSecond, maxLines = 2)
                            Spacer(modifier = Modifier.height(6.dp))
                        }
                    }
                }

                // 4. Daily Quote
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(FamTheme.colors.panel2)
                        .padding(12.dp)
                ) {
                    MicroLabel("Reflection")
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "“Consistency is what transforms average into excellence.”",
                        style = FamTheme.typography.body,
                        color = FamTheme.colors.text
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(
                            onClick = { onPinQuoteToNotes("Consistency is what transforms average into excellence.") }
                        ) {
                            Icon(Icons.Default.BookmarkBorder, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Save to Notes", style = FamTheme.typography.caption)
                        }
                    }
                }
            }
        }
    }
}
