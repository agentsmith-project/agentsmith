# Cursor Design Guide for AgentSmith

This file is the UI style guide for AgentSmith.

It is based on the publicly observable design language of `https://cursor.com` as reviewed on April 11, 2026. It covers only UI style, visual language, and implementation preferences. It does not define product objects, IA, permissions, routes, contracts, or engineering gates.

## 1. Source of truth

When design questions come up, use this order:

1. Observed live Cursor UI truth on `cursor.com`
2. The translation rules in this document for turning that language into an enterprise control-plane app
3. Shared AgentSmith tokens, primitives, and shell components

Do not invent a parallel design language page by page.

## 2. Observed Cursor truth

### Theme model

Cursor's public site is a real dual-theme system, not a light-only site with a cosmetic dark variant.

Observed anchors from the live site:
- Light theme color: `#f7f7f4`
- Dark theme color: `#14120b`
- Light is warm cream, not white
- Dark is warm near-black, not cold graphite

Both themes are low-noise and restrained. Neither theme relies on loud gradients, glossy glass, or neon contrast.

### Typography

The live site exposes three defining font families:
- `CursorGothic`
- `jjannon`
- `berkeleyMono`

Use them by role, not decoratively:
- `CursorGothic`: display, headings, UI labels, structured interface language
- `jjannon`: editorial body copy, narrative/supporting prose, longer descriptive passages
- `berkeleyMono`: technical labels, code, request ids, terminals, compact diagnostics

Typography should carry hierarchy mostly through size, spacing, and restraint rather than heavy weights.

### Color and atmosphere

Cursor's visual language is warm, quiet, and precise.

Observed characteristics:
- Cream and parchment-like light surfaces
- Warm brown or near-black text instead of pure neutral black
- Orange used sparingly as accent, not as the default fill for everything
- Subtle borders and surface separation
- Visual density comes from typography and spacing more than decoration

Avoid:
- Pure white application backgrounds
- Cold blue-tinted neutrals as the primary shell language
- Heavy radial lighting effects
- Large areas of saturated brand orange
- Bright translucent overlays in dark mode

### Surfaces and depth

Cursor's site uses restrained depth.

Principles:
- Surfaces should feel calm and tactile, not glossy
- Borders are often more important than shadows
- Shadows are soft and editorial, not dramatic product-marketing lifts
- Overlays darken and quiet the background in both themes
- Background art, when present, is subtle and should never overpower content

### Shape and radius

The overall shape language is controlled and moderately rounded.

Use:
- Small to medium radii for controls and containers
- Full-pill only for true pills, chips, or compact toggles

Avoid:
- Oversized 24px to 32px radii as a default page language
- Soft, plush card systems that feel more like consumer SaaS than a precise editor brand

### Interaction language

Cursor's interactive language is understated.

Principles:
- Primary actions should feel deliberate, not loud
- Accent color should guide attention, not flood the screen
- Hover states should usually be color, border, or subtle surface changes
- Focus states must remain visible but not introduce a foreign color language
- Empty, loading, and error states should feel composed and informative rather than alarm-heavy

## 3. AgentSmith translation rules

AgentSmith is not Cursor's marketing site. It is an enterprise control-plane app. We should translate Cursor's visual language into a product shell that supports dense navigation, governance surfaces, data tables, forms, and audit-heavy workflows.

### What we inherit directly

We inherit:
- The warm light and warm dark theme mood
- The font stack and its role split
- The restrained use of accent orange
- The calm border-first surface model
- The editorial, low-noise shell tone

### What we translate for app surfaces

For control-plane surfaces:
- Shell chrome should stay quieter than content
- Navigation should be compact and legible, not decorative
- Data-heavy pages should prioritize scanability over theatrical styling
- Governance pages should feel stable and trustworthy, not celebratory
- Empty and recovery states should always explain next action clearly

### What we do not copy from the marketing site

Do not directly port:
- Scenic or painterly hero backgrounds into product chrome
- Marketing-only composition tricks as default page structure
- Feature-showcase color stories as global semantic tokens
- Decorative motion or large hero spacing into routine CRUD/governance pages

## 4. Foundation rules for implementation

### Tokens

All colors, borders, shadows, backgrounds, and surface states must come from shared theme tokens.

Do not:
- hardcode one-off dark-only values into pages
- invent page-local gradients to "make it feel like Cursor"
- use one-off rgba overlays instead of shared scrim tokens

### Primitives first

Design language must land in shared primitives before page code.

Prioritize:
- buttons
- inputs
- selects
- dialogs
- sheets
- cards
- tabs
- menus
- page headers
- shell navigation controls

Pages should compose these primitives. They should not define a private visual system.

### Dual-theme parity

Light and dark are both first-class truths.

Requirements:
- Every stable interface must remain readable and usable in both themes
- Public/auth pages must expose the same theme-switching capability as signed-in app surfaces
- Overlays must preserve hierarchy in both themes
- Visual review must cover both themes for stable pages

## 5. Page-level guidance

### Public and auth pages

These pages should feel clear, calm, and trust-building.

Requirements:
- Immediate orientation in the first screenful
- One dominant primary action
- Secondary actions that genuinely help recovery
- Theme switch visible on-page
- No dead-end CTA loops

### Workspace and project shells

These pages should feel like a composed application shell, not a marketing landing page.

Requirements:
- Quiet chrome
- Strong information hierarchy
- Consistent section headers and card containers
- Clear distinction between browse, create, and governance actions

### Recovery and permission states

Recovery UI must follow real route accessibility.

Requirements:
- Recovery CTAs must only point to reachable surfaces
- Permission-denied states must explain the boundary and offer a valid next step
- Governance-only visibility does not automatically imply project-shell navigation

## 6. Anti-patterns

Avoid these patterns even if they look visually appealing in isolation:
- Large, saturated orange primary buttons everywhere
- Over-bright dark theme overlays
- Big plush radii as the default language
- Heavy radial gradient backgrounds behind everyday work surfaces
- Page-specific visual patch classes that bypass shared tokens and primitives
- Public/auth pages that inherit theme state but offer no local theme control

## 7. Practical test for acceptance

A change fits this guide if it feels:
- warm, not cold
- precise, not flashy
- editorial, not ornamental
- quiet in chrome, strong in hierarchy
- equally intentional in light and dark
- implemented through shared tokens and primitives rather than page-local styling
