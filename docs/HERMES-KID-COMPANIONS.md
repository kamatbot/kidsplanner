# Child companions — first version

The primary surfaces are native iPhone and iPad Chat, plus the standalone child Apple Watch. Web provides the same profile controls and private conversation. The existing room ID remains `hermes`; the child's chosen name appears within it. Adult Hermes retains its existing private assistant and Operator capabilities. No Koko, My Corner, tab, or Family Rings rebrand is included.

A parent enables each child's companion and selects 6–8, 9–12, or 13–17. New profiles are disabled until that decision; age is not inferred from grade and no date of birth is collected. This first version has no under-six mode. The child chooses a name, one of five characters, a colour, a playful/calm/curious tone, and whether to receive companion reminders. These are bounded presentation values, never a custom system prompt. Parents can manage policy but cannot read the private child transcript through these settings.

## Learning and actions

The helper can discuss the child's own homework and goals, help choose a first step, explain concepts, and coach through a problem. Requests for a finished submission, answer-only homework, or concealing AI use get a gentle warning to the child followed by tutoring guidance. There is no cheating report or parent alert, and no claim of reliable cheating detection. Ordinary requests for explanations are legitimate learning help.

The first version reads the planner and offers existing navigation and reminder/snooze actions. It cannot submit homework, mark it done, send messages to others, create arbitrary scheduled reminders, purchase anything, or change account permissions. The model must not claim those actions happened. No agent tools execute on the family's Mac for child turns.

## Execution and content boundaries

Child messages use an isolated server model request through the existing Anthropic API configuration. Only a bounded child-thread history and the child's own planner context are supplied. No host tools, browser, terminal, filesystem, credentials, parent capability tokens, shared-room history, or persistent Hermes memory are included. A separate output review runs before model text is stored or shown. Failure, timeout, malformed moderation, and rejected text return a fixed safe fallback. These controls reduce risk; no AI content filter is perfect.

The legacy Hermes bearer cannot list, open, or write a child's private room. Child-origin shared-room mentions never enter its adult model loop; family chat supplies a fixed hint to open the private companion. AI replies in shared family rooms are screened for child-safe content even when a parent made the request. If screening is unavailable they are not published; adult assistance remains available in a parent's private thread.

Reminders reuse the existing Mac proactive planner but child-visible text and action labels are fixed on the server. Imported homework titles and gateway-authored prose cannot enter reminders. Reminder opt-out, enablement, 20:30–07:00 family-local quiet hours, and a four-reminder daily ceiling are enforced at delivery. No guilt, streak loss, invented urgency, or simulated emotional need is used. Notifications go only to the child, with generic lock-screen text. The Mac must still be running for scheduled companion nudges; chat itself does not depend on it.

## Interfaces and storage

- `GET/PUT /api/hermes/companion`: current child's profile; PUT accepts cosmetics/reminders only.
- `GET /api/hermes/companions`: current parent's family policy list, never transcripts.
- `PUT /api/hermes/companions/:kidId`: current family's child policy/profile.
- Existing private-thread GET/POST/actions routes continue to use the signed-in owner. A child POST can also return `messages` containing the screened reply; older clients receive it through polling.

Profiles and daily quotas use the existing encrypted database, and transcripts use encrypted chat storage. Forty child turns per family-local day bound spend; concurrent turns for the same child are rejected. Membership, parent disablement and age changes are rechecked after inference. Child removal clears profile and quota data. Existing chat retention remains unchanged; this version does not claim a new transcript-deletion UI or provider zero-data-retention agreement.

The standalone Watch uses its own parent-issued child bearer over HTTPS. Its allowlist includes only the child's profile and private-thread routes, not parent policy, Hermes MCP, bridge rooms, or other accounts. Parent Watch credentials cannot use the child companion routes. Standalone reminder APNs target the registered Watch topic without the family-chat inline-reply category. Native transport and screen behavior are described in the Watch README.

## Acceptance and release

Focused tests must cover role/child isolation, cosmetic injection, disabled/changed policy, revoked Watch credentials, duplicate sends, concurrent requests, bounded usage, unsafe or unavailable moderation, template-only nudges, quiet hours, and parent behavior. Validate native iPhone, iPad, and standalone Watch targets plus representative UI and account-switch states. Source/fixture tests do not prove model safety, live APNs delivery, or Wi-Fi/cellular independence.

Before production enablement, evaluate the actual configured model with age-banded benign, harmful, prompt-injection and multi-turn tutoring examples, and verify provider requirements for serving minors. A parent's existing account creation is not by itself evidence that every provider/privacy requirement is fulfilled. Review the current [Anthropic usage policy](https://www.anthropic.com/legal/aup) and [API documentation](https://platform.claude.com/docs/en/api/messages/create). No new credentials or provider settings are provisioned by this feature.

### Local acceptance recorded on 2026-10-13

Focused backend and web tests passed, including real-route browser flows for parent enablement, child customization/chat and sibling isolation. Native Xcode verification passed eight iOS and nine standalone Watch unit tests. Three native interaction flows passed on both iPhone and iPad simulators: child customization with load/save recovery, parent enablement/age controls at the largest text size, and private tutor chat. AI replies were fixed test responses; no live model safety conclusion follows from these checks. Watch navigation, dictation, physical wrist/network behavior and APNs still require device acceptance. No deployment or native distribution was performed.
