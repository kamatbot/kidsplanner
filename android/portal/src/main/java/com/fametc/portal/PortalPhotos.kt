package com.fametc.portal

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream

/** Power-of-two BitmapFactory sample size that brings the longest side to at most [maxSide]. */
fun photoSampleSize(width: Int, height: Int, maxSide: Int = 1600): Int {
    var size = 1
    if (width <= 0 || height <= 0) return size
    while (maxOf(width, height) / size > maxSide) size *= 2
    return size
}

/** Decodes downloaded image bytes at screen-friendly size; null when they are not a decodable image. */
internal fun decodePhoto(bytes: ByteArray): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply { inSampleSize = photoSampleSize(bounds.outWidth, bounds.outHeight) }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
}

/** A downloaded photo kept as compressed bytes; identity is the server id only. */
class PortalPhoto(val id: String, val bytes: ByteArray) {
    override fun equals(other: Any?) = other is PortalPhoto && other.id == id
    override fun hashCode() = id.hashCode()
}

/** Obviously fake pictures so demo mode can show the Night board's photo layout and rotation. */
internal fun demoPhotos(): List<PortalPhoto> {
    val grounds = listOf(Color.rgb(0x0F, 0x3B, 0x40), Color.rgb(0x3B, 0x1F, 0x4A), Color.rgb(0x40, 0x2E, 0x14))
    val colors = listOf(
        listOf(Color.argb(200, 0xFF, 0xC1, 0x70), Color.argb(190, 0x65, 0xCB, 0xB5), Color.argb(170, 0xB3, 0x9A, 0xFF)),
        listOf(Color.argb(200, 0x65, 0xCB, 0xB5), Color.argb(190, 0xB3, 0x9A, 0xFF), Color.argb(170, 0xFF, 0xC1, 0x70)),
        listOf(Color.argb(200, 0xB3, 0x9A, 0xFF), Color.argb(190, 0xFF, 0xC1, 0x70), Color.argb(170, 0x65, 0xCB, 0xB5)),
    )
    // Circle centres (x, y, radius) per photo.
    val discs = listOf(
        listOf(floatArrayOf(420f, 420f, 360f), floatArrayOf(1050f, 330f, 280f), floatArrayOf(1250f, 760f, 330f)),
        listOf(floatArrayOf(1100f, 480f, 340f), floatArrayOf(380f, 330f, 260f), floatArrayOf(520f, 800f, 320f)),
        listOf(floatArrayOf(800f, 560f, 380f), floatArrayOf(250f, 780f, 250f), floatArrayOf(1350f, 300f, 270f)),
    )
    return List(3) { n ->
        val bitmap = Bitmap.createBitmap(1600, 1000, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(grounds[n])
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        discs[n].forEachIndexed { i, (x, y, r) ->
            paint.color = colors[n][i]
            canvas.drawCircle(x, y, r, paint)
        }
        paint.color = Color.WHITE
        paint.textSize = 56f
        // Centred near the top: the night board crops the sides of wide photos.
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText("Sample family photo ${n + 1}", 800f, 120f, paint)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
        bitmap.recycle()
        PortalPhoto("demo-${n + 1}", out.toByteArray())
    }
}
