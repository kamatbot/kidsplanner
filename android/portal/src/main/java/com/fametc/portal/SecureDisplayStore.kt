package com.fametc.portal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.serialization.encodeToString
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One authenticated-encrypted record; token and cached family data never go in preferences. */
class SecureDisplayStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "fam_portal_session.bin"))
    private val alias = "fam_portal_display_v1"
    private val aad = "fametc.portal.display.v1".toByteArray(Charsets.UTF_8)

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun key(create: Boolean): SecretKey {
        val store = keyStore()
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "The device key is no longer available." }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            generateKey()
        }
    }

    fun read(): SavedDisplay? {
        val bytes = try {
            file.openRead().use {
                require(it.channel.size() <= 2L * 1024 * 1024 + 64)
                it.readBytes()
            }
        } catch (_: FileNotFoundException) { return null }
        require(bytes.size in 30..(2 * 1024 * 1024 + 64) && bytes[0].toInt() == 1)
        val ivLength = bytes[1].toInt() and 0xff
        require(ivLength == 12 && bytes.size > ivLength + 18)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(2, 2 + ivLength)))
        cipher.updateAAD(aad)
        val plain = cipher.doFinal(bytes.copyOfRange(2 + ivLength, bytes.size))
        return PortalApi.json.decodeFromString<SavedDisplay>(plain.toString(Charsets.UTF_8))
    }

    fun write(record: SavedDisplay) {
        val plain = PortalApi.json.encodeToString(record).toByteArray(Charsets.UTF_8)
        require(plain.size <= 2 * 1024 * 1024)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        cipher.updateAAD(aad)
        val encrypted = cipher.doFinal(plain)
        val output = file.startWrite()
        try {
            output.write(byteArrayOf(1, cipher.iv.size.toByte()))
            output.write(cipher.iv)
            output.write(encrypted)
            file.finishWrite(output)
        } catch (error: Exception) {
            file.failWrite(output)
            throw error
        }
    }

    fun clear() {
        file.delete()
        val store = keyStore()
        if (store.containsAlias(alias)) store.deleteEntry(alias)
    }
}
