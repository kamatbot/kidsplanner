# iOS chat room header — 2026-09-30

Branch: `codex/ios-chat-room-tabs`, based on main `8cd4025`.

The combined Chat badge included unread Hermes messages, but the room picker hid the source of that count. Family, Hermes and each available trip now have separate labeled controls in the native chat header, with their own unread counts and selected state. The row scrolls horizontally for smaller screens, long trip names and Dynamic Type. Counts use the existing per-room model; the system Chat tab retains its combined count.

Entering or switching to a room acknowledges its already-loaded messages immediately. It does not wait for a network refresh or clear other rooms. Existing room authorization, routes, polling and per-room drafts are preserved. The additional AppStore fixture is DEBUG-only and requires both existing mock-chat launch settings and `FAM_MOCK_CHAT_ROOMS=1`.

Validation: Xcode 27.1, iOS 27 simulators. Both `ChatRoomHeaderUITests` passed on iPhone 17e, including accessibility XXXL text. The independent-count/switching test also passed on iPad mini. Screenshots reviewed. Focused native validation only; no full CI, web build, merge, deployment, archive or TestFlight upload.

Open `ios/FamETC.xcodeproj` in this worktree (regenerate using `xcodegen generate --spec ios/project.yml` after a fresh checkout). Local test results and screenshots are under `.dev-data/chat-room-tabs/`.

Claude owns merge/release. Hostinger releases must come from merged main; this native-only change requires no Hostinger deployment.
