---
name: Fam ETC — Horizon
description: A calm family workspace with clear priorities and approachable learning.
colors:
  primary: "#6f43d6"
  on-primary: "#ffffff"
  background: "#f1efec"
  surface: "#ffffff"
  surface-subtle: "#faf8f5"
  border: "#e7e3dd"
  text: "#211e1b"
  text-secondary: "#6a655f"
typography:
  body:
    fontFamily: '"Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif'
  greeting:
    fontSize: "32px"
    lineHeight: 1.08
    letterSpacing: "-.035em"
  section:
    fontSize: "18px"
    lineHeight: 1.2
    letterSpacing: "-.025em"
rounded:
  control: "10px"
  today-surface: "14px"
  card: "16px"
spacing:
  compact: "12px"
  standard: "16px"
  section: "18px"
  generous: "22px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
---

# Design System: Fam ETC

## Overview

**Horizon.** The incumbent system uses a warm neutral canvas, clear white surfaces and violet interactions. Typography is friendly and compact; hierarchy comes from space, scale and readable actions rather than decorative imagery.

This is an extraction of the existing web system, not a new global identity. The approved Today composition is recorded separately in `.impeccable/surfaces/today-home.md`.

## Colors

**The Interactive Violet Rule.** Use primary violet for actions, selected controls and focus. Neutral surfaces carry information; established child and status colors retain their semantic roles.

The frontmatter describes the light theme. `public/css/horizon.css` owns both themes; all new surfaces reference its CSS variables so dark-mode contrast and native form controls change together.

## Typography

Space Grotesk is the incumbent display and body face. Use the greeting role sparingly, section headings for readable grouping, and subordinate metadata beneath the content it explains. Do not replace content hierarchy with oversized counters.

## Layout

The application separates navigation, scrollable main content and family chat. Today uses an explicitly sized, centered main surface with a stable scrollbar gutter so changing an activity never changes page width. Its action/agenda split, support strip and learning tabs are surface-specific—not a mandatory layout for every screen.

At narrow widths, Today stacks its regions. Activity tabs remain a single horizontally scrollable row; panels retain their DOM and unfinished inputs. Existing chat behavior remains unchanged.

## Elevation & Depth

Today is flat at rest: borders and neutral surface contrast define its regions. Existing dialogs and popovers retain their established shadows. Do not add ambient shadows to every informational block.

## Shapes

Controls have gently curved corners; Today panels use the dedicated surface radius. Keep existing circular avatars and status marks consistent with the application rather than inventing a second icon system.

## Components

Primary buttons use violet with contrasting text. Secondary actions use quiet outlined or text treatments. Keyboard focus remains visibly outlined, and actionable schedule and homework rows are semantic buttons.

Daily 5 uses a tablist with one visible panel, roving keyboard focus, arrow navigation and Home/End support. Changing tabs must not remount activities, erase drafts or reset puzzle progress. An activity's completion or unavailable state stays visible in its selected panel.

## Do's and Don'ts

- Do retain real role boundaries and source/freshness labels when translating a comp.
- Do preserve the user's unchanged chat dock and the native/web split.
- Do show compact previews with explicit routes to their full screens.
- Don't turn illustrative mock data, read times or reactions into product claims.
- Don't let activity content or scrollbar appearance resize the surrounding page.
