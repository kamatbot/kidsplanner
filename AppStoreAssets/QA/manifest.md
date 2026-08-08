# FamETC App Store screenshot manifest

## Task record

- Composition task date: 2026-08-09 (ICT, Asia/Bangkok).
- Composition starting commit: `b7ec7c8c76c45090813ee0fba6cfa8e038b8d636` (`main`); the worktree was clean before composition.
- Scope: generated App Store screenshot assets, raw-source preservation, and AppStoreAssets QA evidence only. Product source, Xcode project, server, validators, and unrelated files were not changed.
- Original capture window: 2026-08-08 23:40–2026-08-09 00:01 ICT (Asia/Bangkok).
- Original capture baseline: `d9266e78c964961a8a1cf5fddd6a6bd0e4e72333` (`main`, recorded with the accepted raw captures).
- Toolchain: Xcode 26.5, build 17F42; runtimes iOS 26.5 (23F77) and watchOS 26.5 (23T570).
- Language: English; orientation: portrait.

## Current Apple requirements verified

The official Apple sources were checked on 2026-08-09:

- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications) — the selected iPhone 6.3-inch, iPad 13-inch, and Apple Watch Series 11 wells accept the dimensions below; screenshots must be opaque and Apple accepts one to ten screenshots.
- [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots) — upload and ordering guidance.
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — truthful product presentation and privacy review.

## Devices and dimensions

| Platform | Simulator | UDID | Upload dimensions | Count |
| --- | --- | --- | ---: | ---: |
| iPhone | iPhone 17 Pro | `2E9EDCE7-0D8A-4A97-AB1A-F0C90C497954` | 1206 × 2622 | 4 |
| iPad | iPad Pro 13-inch (M5) | `497C0B29-EF98-4835-9DF0-A5BAB2AD3318` | 2064 × 2752 | 4 |
| watchOS | Apple Watch Series 11 (46mm) | `D3114908-7653-457F-A5CF-E315D071245F` | 416 × 496 | 3 |

The upload directories contain only the composed PNGs. Every composed canvas is opaque 8-bit RGB at the exact target dimensions. The source app frame is fitted with contain semantics below the tagline; it is never cropped, covered, stretched, or otherwise edited. The raw simulator captures remain available at the paths in the next section.

## Raw source preservation

The accepted raw captures were copied before composition and are preserved byte-for-byte here:

- iPhone source set: `AppStoreAssets/Raw/iPhone/6.3-inch/`
- iPad source set: `AppStoreAssets/Raw/iPad/13-inch/`
- watchOS source set: `AppStoreAssets/Raw/watchOS/Series11/`

Each raw file has the same SHA-256 as its pre-composition upload-directory predecessor. The final files are derived from these raw frames by a contain fit only, with the original pixels retained in the preserved source set.

## Composition system

- Canvas background: warm off-white `#F8F5F0`.
- Tagline: dark `#231F1D`, SF system font (`SFNS.ttf`) at variable weight 700, left aligned with a purple `#6C43D6` vertical accent.
- The authentic app screenshot occupies the lower canvas and is centered horizontally. Text is above it with a dedicated margin; watchOS taglines use a necessary two-line wrap for the 416 × 496 well.

| Platform | Raw frame | Contain-fit frame | Scale | Position in final canvas |
| --- | ---: | ---: | ---: | ---: |
| iPhone | 1206 × 2622 | 1108 × 2408 | 0.918383 | x=49, y=214 |
| iPad | 2064 × 2752 | 1893 × 2524 | 0.917151 | x=85, y=228 |
| watchOS | 416 × 496 | 350 × 417 | 0.840726 | x=33, y=79 |

## Final upload sets and locked taglines

### iPhone — `AppStoreAssets/iPhone/6.3-inch/`

- `01-today.png` — “Everything your family needs. Right now.”
- `02-calendar.png` — “See the whole family week at a glance.”
- `03-shopping.png` — “Meals, shopping, and pantry—together.”
- `04-chat.png` — “Turn family chat into a plan.”

### iPad — `AppStoreAssets/iPad/13-inch/`

- `01-today.png` — “One calm place to run the family.”
- `02-calendar.png` — “The family calendar, without the juggling.”
- `03-shopping.png` — “From menu to shopping list, in one place.”
- `04-chat.png` — “Everyone stays in the loop.”

### watchOS — `AppStoreAssets/watchOS/Series11/`

- `01-my-next-urgent.png` — “The next important thing, at a glance.”
- `02-homework.png` — “Homework reminders, right when they matter.”
- `03-shopping.png` — “Carry the family list on your wrist.”

The watchOS strings are line-wrapped only at word boundaries in the rendered 416 × 496 canvases; the locked wording is unchanged. The iPhone and iPad taglines render on one line.

The iOS Homework tab is currently a placeholder, so the iPhone/iPad narrative uses the real Today Homework due card and real Calendar, Chat, and Shopping surfaces. The watch screenshots use the shipped My next, Urgent, Homework, and Shopping sections.

## Privacy-safe source fixture and provenance

The simulator-only local fixture was stored outside the repository at `/tmp/fametc-appstore-qa-data` and served only from `http://127.0.0.1:4100` / `http://localhost:4100`. It used generic fictional content:

- Displayed family identity: `Parent` and `Family`; no real names, emails, addresses, photos, tokens, or device identifiers appear in final images.
- Urgent actions: `Pack water bottle`; `Leave for school`.
- Homework: `Read chapter 4`; `Math worksheet`.
- Shopping: `Milk`; `Bananas`; `Pasta`; `Toothpaste`.
- Generic coordination: `School pickup`, `Library books due`, `Pasta night`, and non-personal family chat messages.
- Fixture dates were anchored to 2026-08-08 so the narrative remained deterministic.

The raw source captures were produced with `xcrun simctl io <UDID> screenshot <path>` from the accepted simulator builds. The watch source came from the original watch target after pairing through its shipped pairing screen with a local development pairing code. No repository project or source file was changed for capture or composition.

## QA outputs

- `AppStoreAssets/QA/iPhone-validation.json` — exact-dimension validator, 4 screenshots, `ok: true`, zero errors and warnings.
- `AppStoreAssets/QA/iPad-validation.json` — exact-dimension validator, 4 screenshots, `ok: true`, zero errors and warnings.
- `AppStoreAssets/QA/watchOS-validation.json` — exact-dimension validator, 3 screenshots, `ok: true`, zero errors and warnings.
- `AppStoreAssets/QA/iPhone-contact-sheet.jpg`, `iPad-contact-sheet.jpg`, and `watchOS-contact-sheet.jpg` — regenerated deterministic contact sheets for visual QA.

Validation commands:

```sh
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 1206 --height 2622 --json AppStoreAssets/iPhone/6.3-inch/ > AppStoreAssets/QA/iPhone-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 2064 --height 2752 --json AppStoreAssets/iPad/13-inch/ > AppStoreAssets/QA/iPad-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/validate_screenshots.py --width 416 --height 496 --json AppStoreAssets/watchOS/Series11/ > AppStoreAssets/QA/watchOS-validation.json
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/iPhone-contact-sheet.jpg AppStoreAssets/iPhone/6.3-inch/
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/iPad-contact-sheet.jpg AppStoreAssets/iPad/13-inch/
python3 /Users/kamatbot/.codex/skills/build-app-store-assets/scripts/make_contact_sheet.py --force --output AppStoreAssets/QA/watchOS-contact-sheet.jpg AppStoreAssets/watchOS/Series11/
```

Original-detail and contact-sheet review checked tagline clipping and contrast, source-frame visibility, aspect-ratio preservation, privacy, duplicate frames, fake overlays, and unsupported claims. No App Store Connect or Apple Developer Portal upload was performed. No commit was created.
