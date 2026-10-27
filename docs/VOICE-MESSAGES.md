# Voice messages in family chat

Owner request 2026-10-27: kids (standalone 40mm Apple Watch SE, no iPhone) and
parents can send short voice messages in family chat from the watch, the iOS
app and the web app, and play the ones they receive.

Voice messages reuse the private chat attachment pipeline
(`lib/chat-attachments.js`, `lib/routes/chat.js`): upload first, then send a
normal chat message that carries the attachment descriptor. Bytes are
encrypted at rest exactly like photos and videos.

## Wire contract

### Upload

`POST /api/chat/attachments` (multipart/form-data)

| field | value |
| --- | --- |
| `file` | the recording |
| `roomId` | `family` (trip rooms also accept voice) |
| `durationMs` | integer recording length in milliseconds, 500–60000 |

Accepted audio MIME types, validated against the file's magic bytes:

| sent as | stored as | magic |
| --- | --- | --- |
| `audio/mp4`, `audio/x-m4a`, `audio/m4a` | `audio/mp4` | `ftyp` at bytes 4–8 |
| `audio/aac` | `audio/aac` | ADTS sync `0xFFF` |
| `audio/mpeg` | `audio/mpeg` | `ID3` or frame sync `0xFFE` |
| `audio/wav`, `audio/x-wav`, `audio/wave` | `audio/wav` | `RIFF`…`WAVE` |

WebM and Ogg audio are rejected: Apple's AVFoundation cannot play them, and
every recording must be playable on the watch and iPhone. Audio uploads are
capped at 5 MB and 60 s (`durationMs` outside 500–60000 is a 400).

Response (unchanged shape, two audio fields):

```json
{ "attachment": { "type": "attachment", "attachmentId": "a_…", "url": "/api/chat/attachments/a_…",
  "filename": "voice.m4a", "mimeType": "audio/mp4", "size": 48213,
  "kind": "audio", "durationMs": 6200 } }
```

### Send

`POST /api/chat/messages` with `{ "text": "", "media": <the attachment descriptor>, "clientMessageId": "…" }`.
Text may be empty when media is present. Messages list/long-poll responses carry
the same `media` object with `kind: "audio"` and `durationMs`.

Push/notification text for an audio message with no text: `🎤 Voice message`.

### Playback

`GET /api/chat/attachments/:id` serves verified audio inline with its
canonical `Content-Type`, `Accept-Ranges: bytes` and `206` range responses
(Safari/AVPlayer need ranges), `Cache-Control: private, no-store`.

### Watch credentials

Watch bearer tokens may now call `POST /api/chat/attachments` (audio only; any
other kind is a 403 for watch tokens) and `GET /api/chat/attachments/:id`
(family room only). Trips, buzz, flag and delete stay unavailable to watches.

## Recording formats per client

- **watchOS and iOS:** `AVAudioRecorder`, AAC in an `.m4a` container,
  mono, 22 050 Hz, ~32 kbps; upload as `audio/mp4`. Watch limit 30 s,
  iOS limit 60 s.
- **Web:** `MediaRecorder` with `audio/mp4` when
  `MediaRecorder.isTypeSupported` says so (Safari, recent Chrome); otherwise
  capture PCM with Web Audio and encode a 16 kHz mono 16-bit WAV in the
  browser. Never upload WebM/Ogg. Limit 60 s.
- Every client needs microphone permission copy aimed at families:
  "Fam ETC uses the microphone to record voice messages for your family chat."

## Playback UI

A voice bubble shows a play/pause control, a waveform-style bar row, and the
duration (`0:06`). Unplayed voice messages from someone else carry a small dot
(client-local state only). After playback, offer quick reactions where the
client already has them.
