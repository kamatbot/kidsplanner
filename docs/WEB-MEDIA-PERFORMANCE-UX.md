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
