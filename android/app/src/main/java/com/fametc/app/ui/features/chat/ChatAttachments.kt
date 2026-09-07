package com.fametc.app.ui.features.chat

import android.content.Context
import android.net.Uri
import com.fametc.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream

object ChatAttachmentHelper {

    suspend fun uploadAttachment(
        context: Context,
        uri: Uri,
        roomId: String,
        mimeType: String = "image/jpeg"
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val contentResolver = context.contentResolver
            val inputStream = contentResolver.openInputStream(uri) ?: throw Exception("Cannot open file.")
            val tempFile = File(context.cacheDir, "chat_upload_${System.currentTimeMillis()}.tmp")
            FileOutputStream(tempFile).use { output ->
                inputStream.copyTo(output)
            }

            val requestFile = tempFile.asRequestBody(mimeType.toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData("file", tempFile.name, requestFile)
            val roomPart = roomId.toRequestBody("text/plain".toMediaTypeOrNull())

            val resp = ApiClient.api.uploadChatAttachment(filePart, roomPart)
            tempFile.delete()
            Result.success(resp.attachment.url)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
