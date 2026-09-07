package com.fametc.app.auth

import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.fametc.app.Config
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.data.remote.FamEtcApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

class AuthService(
    private val context: Context,
    private val api: FamEtcApi = ApiClient.api
) {
    private val credentialManager = CredentialManager.create(context)

    fun extractErrorMessage(e: Throwable): String {
        if (e is retrofit2.HttpException) {
            val errorBody = try { e.response()?.errorBody()?.string() } catch (_: Exception) { null }
            if (!errorBody.isNullOrBlank()) {
                try {
                    val json = ApiClient.json.parseToJsonElement(errorBody).jsonObject
                    val err = (json["error"] as? JsonPrimitive)?.contentOrNull
                    if (!err.isNullOrBlank()) return err
                } catch (_: Exception) {}
            }
        }
        return e.localizedMessage ?: "An unexpected error occurred."
    }

    suspend fun signUpWithPasskey(name: String = "", inviteCode: String = ""): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. Get WebAuthn signup options from server
            val body = buildMap {
                if (name.isNotBlank()) put("name", name.trim())
                if (inviteCode.isNotBlank()) put("inviteCode", inviteCode.trim().lowercase())
            }
            val options = api.webauthnSignupOptions(body)
            val optionsJsonStr = JsonObject(options).toString()

            // 2. Platform passkey creation via Android Credential Manager
            val createRequest = CreatePublicKeyCredentialRequest(optionsJsonStr)
            val createResponse = try {
                credentialManager.createCredential(context, createRequest)
            } catch (e: CreateCredentialCancellationException) {
                return@withContext Result.failure(Exception("Passkey registration cancelled."))
            } catch (e: Exception) {
                val msg = e.localizedMessage ?: "Passkey registration failed."
                if (msg.contains("cannot be validated", ignoreCase = true)) {
                    return@withContext Result.failure(
                        Exception("Passkey domain verification failed: Digital Asset Links (assetlinks.json) not yet active on fametc.com.")
                    )
                }
                return@withContext Result.failure(Exception(msg))
            }

            val registrationJson = (createResponse as? androidx.credentials.CreatePublicKeyCredentialResponse)?.registrationResponseJson
                ?: return@withContext Result.failure(Exception("Failed to get credential response."))

            val responseObj = ApiClient.json.parseToJsonElement(registrationJson).jsonObject

            // 3. Verify on server
            api.webauthnSignupVerify(responseObj)

            // 4. Sync session cookie to WebView
            withContext(Dispatchers.Main) {
                ApiClient.syncCookiesToWebView()
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(Exception(extractErrorMessage(e)))
        }
    }

    suspend fun signInWithPasskey(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. Get WebAuthn assertion options from server
            val options = api.webauthnAuthOptions()
            val optionsJsonStr = JsonObject(options).toString()

            // 2. Platform passkey assertion via Credential Manager
            val getOption = GetPublicKeyCredentialOption(optionsJsonStr)
            val getRequest = GetCredentialRequest(listOf(getOption))
            val getResponse = try {
                credentialManager.getCredential(context, getRequest)
            } catch (e: GetCredentialCancellationException) {
                return@withContext Result.failure(Exception("Sign in cancelled."))
            } catch (e: Exception) {
                val msg = e.localizedMessage ?: "Passkey sign-in failed."
                if (msg.contains("cannot be validated", ignoreCase = true)) {
                    return@withContext Result.failure(
                        Exception("Passkey domain verification failed: Digital Asset Links (assetlinks.json) not yet active on fametc.com. Use a recovery backup code to sign in.")
                    )
                }
                return@withContext Result.failure(Exception(msg))
            }

            val credential = getResponse.credential as? androidx.credentials.PublicKeyCredential
                ?: return@withContext Result.failure(Exception("No public key credential returned."))

            val assertionJson = credential.authenticationResponseJson
            val responseObj = ApiClient.json.parseToJsonElement(assertionJson).jsonObject

            // 3. Verify on server
            api.webauthnAuthVerify(responseObj)

            // 4. Sync session cookie to WebView
            withContext(Dispatchers.Main) {
                ApiClient.syncCookiesToWebView()
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(Exception(extractErrorMessage(e)))
        }
    }

    suspend fun signInWithBackupCode(code: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.verifyBackupCode(mapOf("code" to code.trim()))
            withContext(Dispatchers.Main) {
                ApiClient.syncCookiesToWebView()
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(Exception(extractErrorMessage(e)))
        }
    }

    suspend fun issueBackupCodes(): List<String>? = withContext(Dispatchers.IO) {
        try {
            val resp = api.issueBackupCodes()
            val issued = (resp["issued"] as? JsonPrimitive)?.booleanOrNull ?: false
            if (!issued) return@withContext null
            val codesArray = (resp["backupCodes"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            codesArray
        } catch (e: Exception) {
            null
        }
    }

    // Kid sign-in flow
    data class KidRequestResult(val requestId: String, val pollToken: String, val name: String)

    suspend fun requestKidAccess(inviteCode: String, name: String): Result<KidRequestResult> = withContext(Dispatchers.IO) {
        try {
            val resp = api.requestKidAccess(
                mapOf(
                    "inviteCode" to inviteCode.trim(),
                    "name" to name.trim(),
                    "deviceLabel" to "an Android device"
                )
            )
            val requestId = resp["requestId"] ?: throw Exception("Invalid response from server.")
            val pollToken = resp["pollToken"] ?: throw Exception("Missing poll token.")
            val registeredName = resp["name"] ?: name
            Result.success(KidRequestResult(requestId, pollToken, registeredName))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun pollKidAccessStatus(requestId: String, pollToken: String): String = withContext(Dispatchers.IO) {
        try {
            val resp = api.checkKidAccessStatus(requestId, pollToken)
            resp["status"] ?: "pending"
        } catch (e: Exception) {
            "pending"
        }
    }

    suspend fun registerKidPasskey(requestId: String, pollToken: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. Get kid registration options
            val options = api.kidRegisterOptions(requestId, pollToken)
            val optionsJsonStr = JsonObject(options).toString()

            // 2. Create passkey on kid's Android device
            val createRequest = CreatePublicKeyCredentialRequest(optionsJsonStr)
            val createResponse = try {
                credentialManager.createCredential(context, createRequest)
            } catch (e: CreateCredentialCancellationException) {
                return@withContext Result.failure(Exception("Registration cancelled."))
            }

            val registrationJson = (createResponse as? androidx.credentials.CreatePublicKeyCredentialResponse)?.registrationResponseJson
                ?: return@withContext Result.failure(Exception("Failed to get credential."))

            val responseObj = ApiClient.json.parseToJsonElement(registrationJson).jsonObject

            // 3. Verify kid passkey and establish session
            api.kidRegisterVerify(requestId, pollToken, responseObj)

            withContext(Dispatchers.Main) {
                ApiClient.syncCookiesToWebView()
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
