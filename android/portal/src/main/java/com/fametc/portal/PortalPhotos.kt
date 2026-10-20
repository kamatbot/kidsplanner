package com.fametc.portal

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

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

/** Obviously fake picture so demo mode can show the Night board's photo layout. */
internal fun demoPhoto(): ImageBitmap {
    val bitmap = Bitmap.createBitmap(1600, 1000, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.rgb(0x0F, 0x3B, 0x40))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    fun disc(x: Float, y: Float, r: Float, color: Int) {
        paint.color = color
        canvas.drawCircle(x, y, r, paint)
    }
    disc(420f, 420f, 360f, Color.argb(200, 0xFF, 0xC1, 0x70))
    disc(1050f, 330f, 280f, Color.argb(190, 0x65, 0xCB, 0xB5))
    disc(1250f, 760f, 330f, Color.argb(170, 0xB3, 0x9A, 0xFF))
    paint.color = Color.WHITE
    paint.textSize = 56f
    // Centred near the top: the night board crops the sides of wide photos.
    paint.textAlign = android.graphics.Paint.Align.CENTER
    canvas.drawText("Sample family photo", 800f, 120f, paint)
    return bitmap.asImageBitmap()
}
