# Child study space

Native iPad is the primary surface. The child's Today screen combines one
optional Koko study pal, an optional energy check-in, and My Corner with six
starter stickers and a short note. These controls are available only to the
authenticated child, not to parents using a child-profile filter. Homework and
the existing Daily 3 remain intact. iPhone and web retain secondary support.

## Privacy and sharing

Energy selections and editable sharing drafts are transient. Selecting an
energy level or cancelling a preview writes nothing. Only the explicit Send
to family action posts a message, visible to the existing family-chat members.
Retry uses the same message ID and account/family context to avoid duplicate
messages or a send under a different account.

My Corner has encrypted, child-scoped server persistence, strict sticker and
note limits, and revision conflict review. Native and web requests bind to the
editor's account independently of the current cookie. Parents and siblings
cannot fetch that child's corner. It is separate from family-visible Notes.
Web users are told to save before switching tabs: hidden tabs clear private
editor state, and reopening requires a fresh identity check.

Koko has no economy or streak penalty. Its show/hide preference is an
account-scoped local boolean; no private activity is stored in that preference.

## Local logout

Sign-out immediately removes private native view state and active hybrid
content, cancels the old native/auth request sessions, attempts bounded server
revocation, and deletes only the app's session-cookie pair in native and WK
stores. Onboarding distinguishes a completed local sign-out from unconfirmed
server revocation. Other cookies and other sites remain untouched.

## Integration verification

The accepted feature commits were integrated on top of the newer Daily 3
source. An independent privacy review identified and led to corrections for
failed native logout, missing native editor account binding, and private
content retained in a hidden web tab. Focused regression tests cover those
boundaries. Node 24.21.0 is used for local JavaScript verification.

The combined iPad journey uses the real application with synthetic local
accounts: all three features on child Today, mood cancel versus deliberate
family-chat send, editable corner persistence and failure recovery, portrait
and landscape, sign-out and a restart without an injected cookie, sibling
isolation, and parent exclusion. Supporting focused tests cover large text,
chat retries, response decoding, native/WK cookie cleanup and revision conflict
handling. Execution receipts and screenshots are retained in the integration
worktree's `.dev-data/study-pal-integration/` directory.

The baseline Watch AppIcon issue requires a simulator-only compiler override
for these checks. This is not a signed device archive or TestFlight build.
Physical-device passkey and spoken VoiceOver ceremonies are not claimed.

Final focused results: 19 backend tests and both browser journeys passed;
60 selected native unit/contract tests passed; both My Corner iPad tests,
including the combined three-feature journey, passed. The first multi-fixture
UI run then failed only the mood/Koko cases because their background fixture
processes had exited, and its result bundle stalled while finalizing. Those
four cases passed in a completed recovery bundle after persistent fixture
sessions replaced the short-lived processes. Logs preserve that distinction;
the interrupted first bundle is not presented as a successful overall run.
The accepted application source was unchanged between these test runs.
