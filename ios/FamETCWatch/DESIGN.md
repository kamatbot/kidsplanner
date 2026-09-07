---
name: Fam ETC Watch
description: One next thing at a glance, with the rest of the day close by.
colors:
  watch-accent: "#b98cff"
  watch-coral: "#f0704f"
typography:
  headline:
    fontFamily: "SF Rounded"
  body:
    fontFamily: "SF Rounded"
---

# Design System: Fam ETC Watch

## Overview

**Creative North Star: "One next thing at a glance"**

Fam ETC on watchOS is a small, reassuring companion for family logistics. Native watch navigation and controls carry the interaction; family identity, violet, coral, and rounded system type supply the personality. The watch answers what matters next without asking the wearer to interpret a dashboard.

This records the integrated source, principally `MyNextView.swift`, rather than a verified production release. Simulator layout and hardware interaction acceptance remain pending. The scope is the signed-in watch surface; setup retains its native system styling.

**Key Characteristics:**

- One relevant moment with a clear action.
- Native vertical pages and navigation depth.
- Playfulness through identity, symbols, and restrained acknowledgment.
- Honest local-save and sync states.

## Colors

Violet provides the interactive voice; coral adds warmth to the current moment.

### Primary

- **Watch violet** (`watch-accent`): navigation tint, primary actions, informative captions, and completion acknowledgment.

### Secondary

- **Watch coral** (`watch-coral`): large event/task symbols, happening-now emphasis, and focus celebration.

### Neutral

The watch uses the native black canvas, system primary/secondary foreground styles, and native list/button surfaces. These are platform-resolved styles, not additional fixed color tokens. Profile identity uses the supplied valid six-digit hexadecimal color with violet fallback; the photo fallback places a white initial over a darkened identity surface.

**The One Interactive Voice Rule.** Violet identifies controls; a profile color identifies a person, not a second button theme.

## Typography

Signed-in content inherits SwiftUI's rounded system font design. Semantic styles preserve Dynamic Type rather than declaring a fixed pixel scale.

The hierarchy moves from bold `title3` for the current task and page headings, through `headline` for identity and assignment titles, to `body` for readable work and step text. `subheadline`, `footnote`, and `caption` carry schedule and sync context. Focus countdowns use rounded `title2` with monospaced digits. Large-title sizing belongs to SF Symbols, not decorative display copy.

**The Readable Task Rule.** Critical task titles and step text wrap vertically; scrolling carries overflow instead of shrinking the meaning.

## Layout

A `NavigationStack` contains a vertical-page `TabView`: Now, Day, then More. The first page starts with wearer identity and the active focus or highest-ranked moment. Supporting details and sync/reminder controls follow down the scroll. Day and More use native lists; assignment and event details use scrolling stacks.

The recurring horizontal content inset is 10 points. Stack spacing varies with hierarchy rather than following a fabricated global scale. Action, homework, shopping, and checklist rows provide a minimum 44-point height where explicitly implemented. Dynamic Type and smaller watch displays must retain access through native scrolling; this remains a runtime acceptance check.

## Elevation & Depth

Navigation pushes, native button styles, and native list surfaces establish depth. The signed-in implementation does not add decorative shadows, glass panels, or a custom card dashboard. Native surfaces remain native rather than being restyled as web containers.

## Shapes

Identity is circular with a profile-colored outline. Button silhouettes and list rounding belong to watchOS. There is no authored reusable corner-radius scale.

## Components

### Navigation and next moment

Now presents an event, homework, or action with one corresponding primary control: See details, Open assignment, or Mark done. An active focus takes over this position. Parent identity reads “Family next”; child identity uses a greeting. Day opens calendar details; More opens school work, to-do, settings, and parent-only shopping.

### Buttons and recovery

Prominent bordered buttons carry the current action; bordered buttons carry supporting actions. Lists retain platform navigation affordances. Settings exposes refresh, pending changes, last update, reminder status, and a destructive disconnect confirmation. Empty, refreshing, offline, and error copy describes the available state without claiming that saved work has reached the server.

### Focus and completion

Focus shows its countdown and selected step, plus explicit Step done, Finish assignment, and End focus controls where applicable. Timer expiry never completes homework. The durable acknowledgment gate controls the success haptic; the completion symbol bounces only when Reduce Motion permits. Action completion briefly says “Saved on watch,” with a success haptic and a short fade disabled under Reduce Motion.

### Identity

The current profile supplies name, color, and optional JPEG data thumbnail. Unsupported or invalid image data falls back to an initial. The avatar is decorative to accessibility because the adjacent name supplies identity.

## Do's and Don'ts

- **Do** keep the current action explicit and native.
- **Do** preserve wrapping, scrolling, semantic text, and named accessibility controls.
- **Do** distinguish a local save from successful sync.
- **Don't** treat timer expiry as permission to finish an assignment.
- **Don't** expose parent shopping in the child navigation.
- **Don't** replace native watch navigation with a web-shaped dashboard.
