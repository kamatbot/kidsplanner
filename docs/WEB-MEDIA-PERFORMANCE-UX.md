# Web media, performance, and family UX

Base: main d0d4a6047d0e3c588b4855e1550cdf930be42470 (2026-09-05).
Branch: feature/web-media-performance-family-ux.

## Scope

Keep FamETC free. Account deletion and native iOS account-switch/cache cleanup are explicitly out of scope. Preserve the merged prelaunch hardening work and current navigation/header language.

## Milestones

1. Performance: complete asynchronous Trip chat push delivery; tighten durable outbox scheduling/retries; reduce attachment request-path work while retaining encryption and authorization. Regression tests and checkpoint.
2. Web media: family and Trip chat photo/video selection, local compression before upload, preview/progress/cancel/error states, bounded file sizes, and reuse of private attachment APIs. No silent original-video fallback when compression is unavailable. Regression tests and checkpoint.
3. UX: one large Family Actions heading, a maximum of three visible actions, compact accessible snooze/overflow controls; responsive Homework workspace with meaningful use of desktop space, preserved child filters and parent/student permissions. Browser checks and checkpoint.

## Validation

Run focused Node regressions per milestone and full CI at completion. Exercise browser media preprocessing with synthetic local fixtures, verify narrow and wide layouts, and keep the PR unmerged for review. Record measured results and remaining limitations here.

## Milestone 1 — implemented

- Trip chat, Buzz and trip updates enqueue durable notification intent instead of awaiting provider calls. Retry recipients are intersected with current membership; deleted chat messages are not pushed.
- APNs and Web Push have bounded transport deadlines; actual provider failure results reach the retry queue. Fan-out is capped at 8 concurrent provider operations; outbox drains at most 20 rows per turn with 4 jobs at a time. Exhausted/expired SQLite jobs retain bounded, content-free dead-letter diagnostics.
- Attachment quotas use an additive SQLite index with a transactional, one-time legacy import. No directory scan or expiry cleanup on upload paths. Cleanup is scheduled and bounded at 100 unclaimed uploads per sweep.
- HTTP uploads/downloads use asynchronous disk I/O and WebCrypto hashing/encryption. Encrypted FAT1 storage remains compatible with previous versions; authorization and integrity verification remain mandatory before returning any bytes. Concurrent upload and download buffers are each capped at two.
- Long polls observe the response socket rather than the consumed GET request, and re-check access when delivering messages.
- New regressions cover async encrypted round trips, corruption, indexed request paths, quota reservations, cleanup, bounded concurrency and provider-failure/dead-letter handling.

Storage remains a single-host design. FAT1 byte-range responses still authenticate/decrypt the complete bounded file (maximum 25 MiB); chunk-encrypted range storage is not introduced in this pass. Push delivery is at-least-once, not exactly-once, and partial provider successes can be repeated after a failure. No live deployment or real APNs delivery is claimed.

## Milestone 3a — focused Family Actions

- One Family Actions heading, at most three unsnoozed pending actions, stable urgency ordering. Completed and future-snoozed records remain accessible through a separate All actions dialog.
- Compact clock/snooze popovers replace native select boxes and inline red Delete links. Parent/student permissions remain unchanged. Escape, outside-click and keyboard focus are supported.
- Full local Node suite: 928 passed, zero failures. Actual components rendered in Chromium with synthetic fixtures at desktop/mobile sizes; three-row cap and the seven-item All dialog verified. Browser navigation is restricted in this environment, so these are inline component checks, not a deployed end-to-end session.
