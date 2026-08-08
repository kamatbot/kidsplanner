# FamETC App Store screenshot manifest

## Capture record

- Capture window: 2026-08-08 23:40–2026-08-09 00:01 ICT (Asia/Bangkok).
- Repository baseline: `d9266e78c964961a8a1cf5fddd6a6bd0e4e72333` (`main`, synchronized with `origin/main` before capture).
- Toolchain: Xcode 26.5, build 17F42.
- Runtimes: iOS 26.5 (23F77) and watchOS 26.5 (23T570).
- Language: English; orientation: portrait.
- Apple source: [App Store Connect screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), checked 2026-08-08. The native simulator sizes below are accepted sizes for the current device classes; Apple requires opaque output and allows one to ten screenshots per localization.

## Devices and dimensions

| Platform | Simulator | UDID | Final dimensions | Count |
| --- | --- | --- | ---: | ---: |
| iPhone | iPhone 17 Pro | `2E9EDCE7-0D8A-4A97-AB1A-F0C90C497954` | 1206 × 2622 | 4 |
| iPad | iPad Pro 13-inch (M5) | `497C0B29-EF98-4835-9DF0-A5BAB2AD3318` | 2064 × 2752 | 4 |
| watchOS | Apple Watch Series 11 (46mm) | `D3114908-7653-457F-A5CF-E315D071245F` | 416 × 496 | 3 |

All final files are direct simulator screenshots with no crop, resize, or aspect-ratio change. `simctl` emitted RGBA PNGs; the final files were converted to opaque 8-bit RGB PNGs without resizing.

## Final upload sets

### iPhone — `AppStoreAssets/iPhone/6.3-inch/`

- `01-today.png` — Today overview: family actions, schedule, homework due, and Daily 5.
- `02-calendar.png` — Calendar month view with pickup, homework, meal, and library event.
- `03-shopping.png` — Meals → Shopping with the four-item family list.
- `04-chat.png` — Family Chat with homework, pickup, dinner, and shopping coordination.

### iPad — `AppStoreAssets/iPad/13-inch/`

- `01-today.png` — Today overview in the iPad navigation rail layout.
- `02-calendar.png` — Calendar month view with the seeded family schedule.
- `03-shopping.png` — Meals → Shopping with the four-item family list.
- `04-chat.png` — Authentic portrait Chat slide-over over the Today surface.

### watchOS — `AppStoreAssets/watchOS/Series11/`

- `01-my-next-urgent.png` — My next top position with connection status and Urgent actions.
- `02-homework.png` — My next scroll position centered on both homework items.
- `03-shopping.png` — My next scroll position centered on the Shopping section.

The shipped iOS Homework tab is currently a placeholder; the iPhone/iPad narrative uses the real Today Homework due card and real Calendar/Chat/Shopping surfaces instead. The watch screenshots use the shipped My next, Urgent, Homework, and Shopping sections.

## Privacy-safe fixture

The simulator-only local fixture was stored outside the repository at `/tmp/fametc-appstore-qa-data` and served only from `http://127.0.0.1:4100` / `http://localhost:4100`. It used generic fictional content:

- Displayed family identity: `Parent` and `Family`; no real names, emails, addresses, photos, tokens, or device identifiers appear in final images.
- Urgent actions: `Pack water bottle`; `Leave for school`.
- Homework: `Read chapter 4`; `Math worksheet`.
- Shopping: `Milk`; `Bananas`; `Pasta`; `Toothpaste`.
- Generic coordination: `School pickup`, `Library books due`, `Pasta night`, and non-personal family chat messages.
- Fixture dates were anchored to 2026-08-08 so the narrative remained deterministic.

The final watch screenshots were captured from the original watch target source after pairing through its shipped pairing screen with a local development pairing code. The watch target was generated from the existing `ios/project.yml` into `/tmp/FamETC-AppStore-WatchProject` and built ad-hoc for the watch simulator; no repository project or source file was changed. Temporary helper/diagnostic builds used during simulator provisioning were outside the repository and did not contribute final images.

## Build and capture evidence

- iOS build: existing `ios/FamETC.xcodeproj`, scheme `FamETC`, Debug, destination iPhone 17 Pro; build succeeded and the resulting app was installed on both the iPhone and iPad simulators.
- watch build: temporary XcodeGen project generated from `ios/project.yml`, scheme `FamETCWatch`, Debug, destination Series 11; build succeeded and the signed target was paired and refreshed against the local fixture API.
- Screenshot source: `xcrun simctl io <UDID> screenshot <path>`.
- Final conversion: Pillow `RGBA → RGB`, preserving native dimensions and pixel content.

## QA outputs

- `iPhone-validation.json` — `ok: true`, 4 screenshots, no errors.
- `iPad-validation.json` — `ok: true`, 4 screenshots, no errors.
- `watchOS-validation.json` — `ok: true`, 3 screenshots, no errors.
- `iPhone-contact-sheet.jpg`, `iPad-contact-sheet.jpg`, and `watchOS-contact-sheet.jpg` — deterministic contact sheets used for visual QA.

Validation commands (the validator prints JSON, so stdout was redirected to the corresponding QA file):

```sh
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 1206 --height 2622 --json AppStoreAssets/iPhone/6.3-inch/ > AppStoreAssets/QA/iPhone-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 2064 --height 2752 --json AppStoreAssets/iPad/13-inch/ > AppStoreAssets/QA/iPad-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 416 --height 496 --json AppStoreAssets/watchOS/Series11/ > AppStoreAssets/QA/watchOS-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/iPhone-contact-sheet.jpg AppStoreAssets/iPhone/6.3-inch/
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/iPad-contact-sheet.jpg AppStoreAssets/iPad/13-inch/
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/watchOS-contact-sheet.jpg AppStoreAssets/watchOS/Series11/
```

Visual QA checked the original-detail frames and contact sheets for clipping, duplicate frames, fake overlays, unsupported claims, and privacy leaks. No App Store Connect or Apple Developer Portal upload was performed. No commit was created.
