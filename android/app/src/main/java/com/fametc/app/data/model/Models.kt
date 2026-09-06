package com.fametc.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// MARK: - Core Domain Models

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String? = null,
    val role: String? = null,       // "parent" | "kid"
    val kidId: String? = null,      // profile id when role == "kid"
    val backupCodesRemaining: Int? = null
)

@Serializable
data class Parent(
    val id: String,
    val name: String? = null
)

@Serializable
data class Kid(
    val id: String,
    val name: String,
    val grade: String,
    val color: String,
    val createdAt: String
)

@Serializable
data class Family(
    val id: String,
    val name: String,
    val inviteCode: String? = null,
    val parentIds: List<String> = emptyList(),
    val parents: List<Parent>? = null,
    val kids: List<Kid> = emptyList(),
    val createdAt: String
)

// MARK: - Chat Models

const val FAMILY_ROOM_ID = "family"

@Serializable
data class ChatRoom(
    val roomId: String,
    val tripId: String? = null,
    val title: String,
    val memberCount: Int? = null
) {
    val id: String get() = roomId
}

@Serializable
data class ChatCard(
    val type: String,   // "homework" | "event" | "trip-flight" | ...
    val id: String,
    val title: String? = null
)

@Serializable
data class ChatMedia(
    val type: String,   // "gif" | "attachment"
    val url: String? = null,
    val previewUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val attachmentId: String? = null,
    val filename: String? = null,
    val mimeType: String? = null,
    val size: Int? = null,
    val kind: String? = null
) {
    val isAttachment: Boolean get() = type == "attachment"
    val isGif: Boolean get() = type == "gif"
    val displayFilename: String get() = filename?.takeIf { it.isNotBlank() } ?: "Attachment"
}

@Serializable
data class ChatMessage(
    val id: String,
    val familyId: String,
    val senderType: String,   // "parent" | "kid"
    val senderId: String,
    val postedByUserId: String? = null,
    val text: String = "",
    val card: ChatCard? = null,
    val media: ChatMedia? = null,
    val createdAt: String,
    val deleted: Boolean = false,
    val deletedBy: String? = null,
    val flagged: Boolean = false,
    val flagReason: String? = null,
    val flaggedBy: String? = null,
    val roomId: String? = null,
    val senderName: String? = null,
    val buzz: Boolean? = null
) {
    val isBuzz: Boolean get() = buzz == true
    val effectiveRoomId: String get() = roomId ?: FAMILY_ROOM_ID
}

@Serializable
data class GifResult(
    val id: String,
    val previewUrl: String,
    val url: String,
    val width: Int? = null,
    val height: Int? = null
)

// MARK: - Kid Access Requests

@Serializable
data class KidAccessRequest(
    val id: String,
    val name: String,
    val deviceLabel: String? = null,
    val createdAt: String
)

// MARK: - Calendar Models

@Serializable
data class CalendarEvent(
    val uid: String? = null,
    val feedId: String? = null,
    val title: String,
    val start: String? = null,     // ISO-8601 or YYYY-MM-DD
    val end: String? = null,
    val allDay: Boolean? = null,
    val location: String? = null,
    val feedLabel: String? = null,
    val kidId: String? = null,
    val isDeadline: Boolean? = null,
    val type: String? = null
) {
    val id: String get() = uid ?: "${feedLabel ?: ""}|$title|${start ?: ""}"
    val isImportedTimetable: Boolean get() = feedId == "sta-child-timetable"
}

@Serializable
data class FamilyEvent(
    val id: String,
    val title: String,
    val date: String,              // YYYY-MM-DD
    val time: String? = null,      // HH:mm
    val endTime: String? = null,
    val endDate: String? = null,   // YYYY-MM-DD
    val notes: String? = null,
    val category: String? = null,
    val kidId: String? = null,
    @SerialName("repeat")
    val repeatRule: String? = null, // "none" | "daily" | "weekly" | "biweekly" | "monthly"
    val repeatUntil: String? = null,
    val seriesId: String? = null,
    val recurring: Boolean? = null,
    val occurrenceDate: String? = null,
    val canEdit: Boolean? = null,
    val sourceType: String? = null,
    val sourceId: String? = null
) {
    val isRecurring: Boolean get() = recurring == true || (repeatRule != null && repeatRule != "none")
    val isImportedTimetable: Boolean get() = kidId != null && category == "school" && notes == "Timetable"
}

// MARK: - Homework Models

@Serializable
data class HomeworkChecklistItem(
    val text: String,
    val done: Boolean = false
)

@Serializable
data class HomeworkItem(
    val id: String,
    val kidId: String? = null,
    val title: String,
    val subject: String? = null,
    val dueDate: String,           // YYYY-MM-DD
    val dueTime: String? = null,   // HH:mm
    val status: String,            // "todo" | "in_progress" | "done"
    val effortMin: Int? = null,
    val notes: String? = null,
    val checklist: List<HomeworkChecklistItem>? = null
) {
    val isDone: Boolean get() = status == "done"
    val items: List<HomeworkChecklistItem> get() = checklist ?: emptyList()
    val completedChecklistCount: Int get() = items.count { it.done }
    val remainingChecklistCount: Int get() = items.count { !it.done }
}

// MARK: - Family Action Queue

@Serializable
data class FamilyAction(
    val id: String,
    val familyId: String,
    val title: String,
    val notes: String? = null,
    val status: String,            // "open" | "done" | "snoozed"
    val dueDate: String? = null,
    val dueTime: String? = null,
    val assigneeType: String,      // "parent" | "kid" | "family"
    val assigneeId: String? = null,
    val kidId: String? = null,
    val sourceType: String,        // "manual" | "homework" | "calendar" | ...
    val sourceId: String? = null,
    val createdBy: String? = null,
    val createdAt: String,
    val updatedAt: String? = null,
    val snoozedUntil: String? = null
) {
    val isDone: Boolean get() = status == "done"
}

// MARK: - Notes

@Serializable
data class NoteRef(
    val kind: String,
    val id: String,
    val context: String? = null
)

@Serializable
data class Note(
    val id: String,
    val authorType: String,        // "kid" | "parent"
    val authorId: String,
    val date: String,              // YYYY-MM-DD
    val body: String,
    val source: String,            // "manual" | "quote" | "sat" | "chat" | "social" | "news"
    val ref: NoteRef? = null
)

// MARK: - Meals & Recipes

@Serializable
data class PantryItem(
    val id: String,
    val name: String,
    val category: String,          // produce, protein, dairy, grain, pantry, frozen, spice, other
    val level: String,             // "plenty" | "some" | "low"
    val unitHint: String? = null,
    val expiresOn: String? = null,
    val updatedAt: String? = null,
    val updatedBy: String? = null
)

@Serializable
data class MenuEntry(
    val id: String,
    val date: String,              // YYYY-MM-DD
    val slot: String? = null,
    val title: String,
    val note: String? = null,
    val recipeId: String? = null,
    val createdAt: String? = null,
    val cookedAt: String? = null
) {
    val isCooked: Boolean get() = cookedAt != null
}

@Serializable
data class ShoppingItem(
    val id: String,
    val text: String,
    val category: String? = null,
    val assigneeUserId: String? = null,
    val done: Boolean = false,
    val doneBy: String? = null,
    val doneAt: String? = null,
    val addedBy: String? = null,
    val createdAt: String? = null,
    val sourceType: String? = null,
    val sourceId: String? = null
)

@Serializable
data class MealsState(
    val pantry: List<PantryItem> = emptyList(),
    val menu: List<MenuEntry> = emptyList(),
    val shopping: List<ShoppingItem> = emptyList()
)

@Serializable
data class RecipeIngredient(
    val name: String,
    val category: String,
    val core: Boolean = true,
    val qtyHint: String? = null
)

@Serializable
data class RecipeCoverage(
    val have: List<String> = emptyList(),
    val missing: List<String> = emptyList(),
    val coreMissing: List<String> = emptyList(),
    val ratio: Double = 0.0
)

@Serializable
data class Recipe(
    val id: String,
    val title: String,
    val cuisine: String,
    val region: String = "",
    val slots: List<String> = emptyList(),
    val veg: Boolean = false,
    val spice: Int = 0,
    val kidFriendly: Boolean = false,
    val timeMins: Int = 30,
    val ingredients: List<RecipeIngredient> = emptyList(),
    val steps: List<String> = emptyList(),
    val proteinGPerPortion: Int = 0,
    val fiberGPerPortion: Int = 0,
    val allergens: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val coverage: RecipeCoverage? = null
)

@Serializable
data class ScannedPantryItem(
    val name: String,
    val category: String,
    val levelGuess: String,
    val unitHint: String? = null
)

// MARK: - Daily 5 Learning

@Serializable
data class BrainTeaserQ(
    val qid: String,
    val q: String,
    val options: List<String>,
    val answerIndex: Int,
    val exp: String? = null
) {
    val id: String get() = qid
}

@Serializable
data class WordBankEntry(
    val word: String,
    val state: String,             // "learning" | "mastered" | "known"
    val seenCount: Int,
    val correctCount: Int
)

@Serializable
data class WordQuizQuestion(
    val word: String,
    val prompt: String,
    val options: List<String>,
    val answerIndex: Int
)

@Serializable
data class CrosswordEntry(
    val number: Int,
    val direction: String,
    val clue: String,
    val answer: String,
    val row: Int,
    val col: Int
) {
    val id: String get() = "$number-$direction"
}

@Serializable
data class CrosswordPuzzle(
    val rows: Int,
    val cols: Int,
    val entries: List<CrosswordEntry>
)

@Serializable
data class SudokuPuzzle(
    val puzzle: String,
    val solution: String,
    val size: Int = 9,
    val difficulty: String = "medium"
)

@Serializable
data class DailyPuzzleResponse(
    val date: String,
    val available: Boolean = false,
    val type: String? = null,
    val title: String? = null,
    val instructions: String? = null,
    val crossword: CrosswordPuzzle? = null,
    val sudoku: SudokuPuzzle? = null
)

@Serializable
data class RecentNewsItem(
    val id: String,
    val cat: String,
    val headline: String,
    val summary: String,
    val url: String,
    val publishedAt: String,
    val source: String,
    val question: String
)

// MARK: - API Response Wrappers

@Serializable data class MeResponse(val user: User? = null)
@Serializable data class FamiliesResponse(val families: List<Family> = emptyList())
@Serializable data class FamilyResponse(val family: Family)
@Serializable data class FamilyKidResponse(val family: Family, val kid: Kid)
@Serializable data class KidAccessRequestsResponse(val requests: List<KidAccessRequest> = emptyList())
@Serializable data class CalendarSyncResponse(val events: List<CalendarEvent>? = null, val throttled: Boolean? = null)
@Serializable data class FamilyEventsResponse(val events: List<FamilyEvent> = emptyList())
@Serializable data class FamilyEventResponse(val event: FamilyEvent, val existing: Boolean? = null)
@Serializable data class HomeworkResponse(val homework: List<HomeworkItem> = emptyList())
@Serializable data class HomeworkItemResponse(val homework: HomeworkItem)
@Serializable data class FamilyActionsResponse(val actions: List<FamilyAction> = emptyList())
@Serializable data class FamilyActionResponse(val action: FamilyAction)
@Serializable data class MessagesResponse(val messages: List<ChatMessage> = emptyList())
@Serializable data class MessageResponse(val message: ChatMessage)
@Serializable data class GifsResponse(val gifs: List<GifResult> = emptyList())
@Serializable data class NotesResponse(val notes: List<Note> = emptyList())
@Serializable data class NoteResponse(val note: Note)
@Serializable data class RecipeListResponse(val recipes: List<Recipe> = emptyList())
@Serializable data class PantryItemResponse(val item: PantryItem)
@Serializable data class PantryItemsResponse(val items: List<PantryItem> = emptyList())
@Serializable data class MenuEntryResponse(val entry: MenuEntry)
@Serializable data class ShoppingItemsResponse(val shopping: List<ShoppingItem> = emptyList())
@Serializable data class ShoppingItemResponse(val item: ShoppingItem, val existing: Boolean? = null)
@Serializable data class AIParsePantryResponse(val items: List<ScannedPantryItem> = emptyList())
@Serializable data class BrainTeaserTodayResponse(val date: String, val count: Int, val questions: List<BrainTeaserQ>)
@Serializable data class WordQuizResponse(val questions: List<WordQuizQuestion> = emptyList(), val needMore: Boolean? = null)
@Serializable data class RecentNewsResponse(val items: List<RecentNewsItem> = emptyList(), val maxAgeDays: Int = 14)
@Serializable data class OKResponse(val ok: Boolean = true)
@Serializable data class AttachmentDescriptor(
    val type: String,
    val attachmentId: String,
    val url: String,
    val filename: String,
    val mimeType: String,
    val size: Int,
    val kind: String
)
@Serializable data class AttachmentUploadResponse(val attachment: AttachmentDescriptor)
