package com.fametc.app.data.remote

import com.fametc.app.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

@JvmSuppressWildcards
interface FamEtcApi {

    // MARK: - User & Auth
    @GET("/api/me")
    suspend fun me(): MeResponse

    @POST("/api/auth/logout")
    suspend fun logout(): OKResponse

    @POST("/api/auth/backup/verify")
    suspend fun verifyBackupCode(@Body body: Map<String, String>): OKResponse

    @POST("/api/auth/backup/issue")
    suspend fun issueBackupCodes(): Map<String, kotlinx.serialization.json.JsonElement>

    @POST("/api/auth/backup/regenerate")
    suspend fun regenerateBackupCodes(): Map<String, kotlinx.serialization.json.JsonElement>

    @POST("/api/webauthn/signup/options")
    suspend fun webauthnSignupOptions(@Body body: Map<String, String> = emptyMap()): Map<String, kotlinx.serialization.json.JsonElement>

    @POST("/api/webauthn/signup/verify")
    suspend fun webauthnSignupVerify(@Body body: Map<String, kotlinx.serialization.json.JsonElement>): MeResponse

    @POST("/api/webauthn/auth/options")
    suspend fun webauthnAuthOptions(@Body body: Map<String, String> = emptyMap()): Map<String, kotlinx.serialization.json.JsonElement>

    @POST("/api/webauthn/auth/verify")
    suspend fun webauthnAuthVerify(@Body body: Map<String, kotlinx.serialization.json.JsonElement>): MeResponse

    // MARK: - Kid Access Request (device flow)
    @POST("/api/kid/access-request")
    suspend fun requestKidAccess(@Body body: Map<String, String>): Map<String, String>

    @GET("/api/kid/access-request/{id}")
    suspend fun checkKidAccessStatus(
        @Path("id") id: String,
        @Query("token") token: String
    ): Map<String, String>

    @POST("/api/kid/access-request/{id}/register/options")
    suspend fun kidRegisterOptions(
        @Path("id") id: String,
        @Query("token") token: String
    ): Map<String, kotlinx.serialization.json.JsonElement>

    @POST("/api/kid/access-request/{id}/register/verify")
    suspend fun kidRegisterVerify(
        @Path("id") id: String,
        @Query("token") token: String,
        @Body body: Map<String, kotlinx.serialization.json.JsonElement>
    ): MeResponse

    // MARK: - Family & Kids
    @GET("/api/family")
    suspend fun families(): FamiliesResponse

    @POST("/api/family")
    suspend fun createFamily(@Body body: Map<String, String>): FamilyResponse

    @POST("/api/family/join")
    suspend fun joinFamily(@Body body: Map<String, String>): FamilyResponse

    @POST("/api/family/kids")
    suspend fun addKid(@Body body: Map<String, String>): FamilyKidResponse

    @PATCH("/api/family/kids/{id}")
    suspend fun updateKid(@Path("id") id: String, @Body body: Map<String, String>): FamilyKidResponse

    @DELETE("/api/family/kids/{id}")
    suspend fun deleteKid(@Path("id") id: String): FamilyResponse

    @GET("/api/family/access-requests")
    suspend fun kidAccessRequests(): KidAccessRequestsResponse

    @POST("/api/family/access-requests/{id}/approve")
    suspend fun approveKidAccess(@Path("id") id: String): FamilyKidResponse

    @POST("/api/family/access-requests/{id}/deny")
    suspend fun denyKidAccess(@Path("id") id: String): OKResponse

    // MARK: - Calendar & Homework
    @POST("/api/calendar/sync")
    suspend fun syncCalendar(@Body body: Map<String, Boolean> = mapOf("force" to false)): CalendarSyncResponse

    @GET("/api/calendar/events")
    suspend fun familyEvents(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): FamilyEventsResponse

    @POST("/api/calendar/events")
    suspend fun addFamilyEvent(@Body body: Map<String, String?>): FamilyEventResponse

    @PATCH("/api/calendar/events/{id}")
    suspend fun updateFamilyEvent(@Path("id") id: String, @Body body: Map<String, String?>): FamilyEventResponse

    @DELETE("/api/calendar/events/{id}")
    suspend fun deleteFamilyEvent(@Path("id") id: String): OKResponse

    @GET("/api/homework")
    suspend fun homework(@Query("kidId") kidId: String? = null): HomeworkResponse

    @PATCH("/api/homework/{id}")
    suspend fun setHomeworkStatus(@Path("id") id: String, @Body body: Map<String, String>): HomeworkItemResponse

    @PATCH("/api/homework/{id}/checklist/{index}")
    suspend fun setHomeworkChecklistStep(
        @Path("id") id: String,
        @Path("index") index: Int,
        @Body body: Map<String, Boolean>
    ): HomeworkItemResponse

    @PATCH("/api/homework/{id}")
    suspend fun setHomeworkChecklist(
        @Path("id") id: String,
        @Body body: Map<String, List<HomeworkChecklistItem>>
    ): HomeworkItemResponse

    // MARK: - Family Actions
    @GET("/api/family/actions")
    suspend fun familyActions(): FamilyActionsResponse

    @PATCH("/api/family/actions/{id}")
    suspend fun updateFamilyAction(
        @Path("id") id: String,
        @Body body: Map<String, String?>
    ): FamilyActionResponse

    // MARK: - Chat
    @GET("/api/chat/rooms")
    suspend fun chatRooms(): List<ChatRoom>

    @GET("/api/chat/messages")
    suspend fun chatMessages(
        @Query("afterId") afterId: String? = null,
        @Query("wait") wait: Int? = null,
        @Query("limit") limit: Int? = null
    ): MessagesResponse

    @POST("/api/chat/messages")
    suspend fun postChatMessage(@Body body: PostChatMessageRequest): MessageResponse

    @DELETE("/api/chat/messages/{id}")
    suspend fun deleteChatMessage(@Path("id") id: String): OKResponse

    @POST("/api/chat/messages/{id}/flag")
    suspend fun flagChatMessage(@Path("id") id: String, @Body body: Map<String, String>): OKResponse

    @POST("/api/chat/buzz")
    suspend fun sendBuzz(@Body body: Map<String, String>): OKResponse

    // Trip Chat endpoints
    @GET("/api/trips/{tripId}/chat/messages")
    suspend fun tripChatMessages(
        @Path("tripId") tripId: String,
        @Query("afterId") afterId: String? = null,
        @Query("wait") wait: Int? = null,
        @Query("limit") limit: Int? = null
    ): MessagesResponse

    @POST("/api/trips/{tripId}/chat/messages")
    suspend fun postTripChatMessage(
        @Path("tripId") tripId: String,
        @Body body: PostChatMessageRequest
    ): MessageResponse

    @DELETE("/api/trips/{tripId}/chat/messages/{id}")
    suspend fun deleteTripChatMessage(
        @Path("tripId") tripId: String,
        @Path("id") id: String
    ): OKResponse

    @POST("/api/trips/{tripId}/chat/messages/{id}/flag")
    suspend fun flagTripChatMessage(
        @Path("tripId") tripId: String,
        @Path("id") id: String,
        @Body body: Map<String, String>
    ): OKResponse

    @POST("/api/trips/{tripId}/chat/buzz")
    suspend fun sendTripBuzz(
        @Path("tripId") tripId: String,
        @Body body: Map<String, String>
    ): OKResponse

    @Multipart
    @POST("/api/chat/attachments")
    suspend fun uploadChatAttachment(
        @Part file: MultipartBody.Part,
        @Part("roomId") roomId: RequestBody
    ): AttachmentUploadResponse

    @GET("/api/gifs/trending")
    suspend fun trendingGifs(): GifsResponse

    @GET("/api/gifs/search")
    suspend fun searchGifs(@Query("q") query: String): GifsResponse

    // MARK: - Notes
    @GET("/api/notes")
    suspend fun notes(): NotesResponse

    @POST("/api/notes")
    suspend fun createNote(@Body body: Map<String, String>): NoteResponse

    @DELETE("/api/notes/{id}")
    suspend fun deleteNote(@Path("id") id: String): OKResponse

    // MARK: - Meals
    @GET("/api/meals")
    suspend fun meals(): MealsState

    @POST("/api/meals/pantry")
    suspend fun addPantryItem(@Body body: Map<String, String?>): PantryItemResponse

    @PATCH("/api/meals/pantry/{id}")
    suspend fun updatePantryItem(@Path("id") id: String, @Body body: Map<String, String?>): PantryItemResponse

    @DELETE("/api/meals/pantry/{id}")
    suspend fun deletePantryItem(@Path("id") id: String): OKResponse

    @POST("/api/meals/menu")
    suspend fun addMenuEntry(@Body body: Map<String, String?>): MenuEntryResponse

    @DELETE("/api/meals/menu/{id}")
    suspend fun deleteMenuEntry(@Path("id") id: String): OKResponse

    @POST("/api/meals/menu/{id}/cooked")
    suspend fun cookMenuEntry(@Path("id") id: String): MenuEntryResponse

    @POST("/api/meals/shopping")
    suspend fun addShoppingItem(@Body body: Map<String, String?>): ShoppingItemResponse

    @PATCH("/api/meals/shopping/{id}")
    suspend fun toggleShoppingItem(@Path("id") id: String, @Body body: Map<String, Boolean>): ShoppingItemResponse

    @DELETE("/api/meals/shopping/{id}")
    suspend fun deleteShoppingItem(@Path("id") id: String): OKResponse

    @GET("/api/meals/recipes")
    suspend fun recipes(): RecipeListResponse

    @Multipart
    @POST("/api/ai/parse")
    suspend fun parsePantryImage(
        @Part file: MultipartBody.Part,
        @Part("kind") kind: RequestBody
    ): AIParsePantryResponse

    // MARK: - Daily 5
    @GET("/api/brainteaser/today")
    suspend fun brainTeaserToday(): BrainTeaserTodayResponse

    @GET("/api/wordbank/quiz")
    suspend fun wordQuiz(): WordQuizResponse

    @GET("/api/dailypuzzle/today")
    suspend fun dailyPuzzle(): DailyPuzzleResponse

    @GET("/api/news/recent")
    suspend fun recentNews(): RecentNewsResponse
}
