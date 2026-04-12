# Cursor UI Contract for AgentSmith

This file defines the UI style contract for AgentSmith.

It is based only on the publicly observable UI of `https://cursor.com` and its public subpages as reviewed on April 11, 2026. It covers visual language, styling rules, and implementation constraints. It does not define product objects, permissions, routes, contracts, or engineering gates.

## 1. Scope

Use this file to answer:

- what the UI should feel like
- how colors, borders, surfaces, typography, and chrome should behave
- which implementation patterns are allowed
- which visual deviations are forbidden

Do not use this file to answer:

- what the product does
- who can access a route
- how a workflow should behave
- how a business feature should be modeled

## 2. Public Cursor Truth

### 2.1 Theme anchors

Observed public theme anchors:

- light theme-color: `#f7f7f4`
- dark theme-color: `#14120b`

Both themes are warm and restrained.

- Light is cream, parchment, and soft mineral, not white.
- Dark is warm near-black, not blue-black or graphite.
- Neither theme relies on loud gradients, glossy glass, or neon contrast.

### 2.2 Typography

Observed public font families:

- `CursorGothic`
- `jjannon`
- `berkeleymono`

Their public roles are consistent across the main site and content pages:

- `CursorGothic`: headings, UI labels, compact interface language
- `jjannon`: longer editorial copy and supporting prose
- `berkeleymono`: code, diagnostics, compact technical labels

Hierarchy comes from proportion, spacing, and restraint, not from extreme weight shifts.

### 2.3 Background and atmosphere

Cursor uses a low-noise page atmosphere.

- Backgrounds are mostly solid or nearly solid.
- Decorative light wash is subtle.
- The site explicitly describes its main demo background as a subtle, solid brand background.
- Decorative effects never overpower structure or text.

### 2.4 Surfaces and borders

Cursor's surfaces are calm and light-handed.

- Borders are visible but subdued.
- Borders must never be as strong as primary text.
- Surface separation is mild.
- Many sections are defined by spacing and type rhythm rather than large independent cards.
- Shadows are soft and sparse.

### 2.5 Radius and shape

Cursor uses controlled rounding.

- Small and medium radii are common.
- Large plush radii are not the default page language.
- Full-pill is reserved for chips, toggles, and compact controls.

### 2.6 Chrome and navigation

Cursor's shell is quiet.

- Chrome should be calmer than content.
- Active navigation is clear but understated.
- Navigation should not rely on loud rails, bright fills, or heavy outlining.
- Menus and top controls should feel integrated with the page, not like a detached component showcase.

### 2.7 CTA language

Cursor uses measured emphasis.

- Primary actions are clear but not theatrical.
- Accent orange is a guide, not a flood color.
- Buttons should feel deliberate and compact.
- Most actions should rely on subtle surface and typography changes rather than strong fills.

### 2.8 Overlay behavior

- Overlays darken and quiet the background.
- Overlays do not brighten the surrounding page in dark mode.
- Dialogs and sheets feel like slightly raised paper, not floating glass slabs.

## 3. Direct Copy Rules

The following traits must be copied directly in spirit and system behavior:

- warm cream light theme anchored on `#f7f7f4`
- warm near-black dark theme anchored on `#14120b`
- quiet shell chrome
- low-contrast border model
- restrained radius scale
- sparse, soft shadow model
- editorial typography split across `CursorGothic`, `jjannon`, and `berkeleymono`
- subtle backgrounds instead of decorative gradients
- calm CTA hierarchy with limited accent fill

These are not optional preferences. They are the default design system contract.

## 4. Allowed Translation for AgentSmith

AgentSmith is an application, not a marketing site. The allowed translation is visual only.

Allowed:

- denser navigation and data layouts
- denser form and governance surfaces
- application shell structures needed for multi-surface workflows
- control-plane tables, audit summaries, and settings forms

Not allowed:

- inventing a second visual language for app pages
- using dashboard tropes that overpower Cursor's quietness
- replacing subtle structure with piles of bordered cards
- replacing type rhythm with decoration

## 5. Executable Implementation Contract

### 5.1 Foundation

All visual language must come from shared tokens and primitives.

Required:

- dual-theme parity
- border tokens weaker than primary text
- small to medium default radius
- minimal background decoration
- quiet shadow model

### 5.2 Primitives

Shared primitives define the look. Pages compose them.

The following must carry the design language:

- buttons
- inputs
- selects
- menus
- tabs
- cards
- dialogs
- sheets
- page headers
- empty, error, and recovery states

### 5.3 Shell

Topbar, sidebar, and page headers must remain quieter than the content they frame.

Required:

- understated active states
- no heavy pill collection as the default chrome language
- no strong accent rails as the default active affordance
- no default page-header card shell unless the page genuinely needs a panel

### 5.4 Pages

Pages may translate layout density, but they may not invent private styling systems.

Required:

- rely on page recipes and shared primitives
- prefer spacing and typography over nested summary cards
- recovery CTAs must always point to real, reachable destinations

### 5.5 Page families

Every route must map to exactly one site-wide recipe family before implementation.

Default families:

- `public_auth_single`: one primary column for login, join, request, and completion flows
- `public_auth_split`: a single secondary aside only when it materially reduces cognitive load
- `work_surface_standard`: quiet shell plus one main work surface
- `work_surface_immersive`: full-height work surface with only minimal utility chrome
- `settings_sheet`: continuous settings sheet with section dividers, not a dashboard stack
- `governance_table_detail`: one dominant list or table plus an optional detail surface
- `system_admin_detail`: list-detail or editor-detail surface for system management
- `overlay_dialog`: lightweight confirmation or single-step choice
- `overlay_sheet`: multi-step or multi-field right-side panel

Required:

- one route, one recipe family
- no page-local shell wrapper that recreates a second top-level layout
- no chooser-card stack when a quiet list or single-column flow is sufficient
- no dashboard-style summary strip unless the recipe explicitly allows it
- any split layout must keep the primary task in the main column and helper content secondary

### 5.6 Shell, CTA, and state rules

Required:

- each visible header cluster may expose one primary CTA and at most two visible secondary actions
- the primary CTA is the only action that may use stronger accent fill
- shell chrome must remain quieter than the content it frames
- loading, empty, error, and recovery states must use shared primitives
- recovery CTAs must point to reachable destinations
- error states should surface stable identifiers such as `error_code` and `request_id` when available
- light and dark modes must preserve the same topology, action order, and affordance placement
- theme changes may alter tone and contrast, but not page recipe or information hierarchy

### 5.7 Visual baseline review

Every updated visual baseline must be reviewed against three truths:

- the route and recipe family
- the rendered screenshot in light and dark
- the current public Cursor visual language

Required review steps:

1. inspect the route code and shared recipe usage
2. inspect the rendered screenshot at full size
3. compare the screenshot to the public Cursor reference for shell weight, spacing, typography, and CTA hierarchy
4. record whether the baseline is accepted, rejected, or blocked on a missing recipe or state

Acceptance requires:

- no extra shell layer
- no page-local decorative language
- no dashboard tropes that overpower the main task
- no light/dark mismatch in layout or control placement
- no acceptance based on tests alone

## 6. Forbidden Deviations

These patterns are forbidden unless a deliberate exception is documented:

- borders at or near strongest text contrast
- default page-level `rounded-[18px]`, `rounded-[20px]`, `rounded-[24px]`, `rounded-[28px]`, `rounded-[32px]`
- page-local heavy gradients or radial glow backgrounds
- page-local custom shadow stacks for stable surfaces
- raw white/black alpha patches as a page's private surface model
- bright dark-mode overlays that lift the background
- default high-contrast filled orange CTA buttons everywhere
- loud active navigation rails and decorative shell emphasis
- nested card stacks used as a substitute for hierarchy

## 7. Acceptance Checklist

A change fits this contract only if it is:

- warm, not cold
- quiet, not flashy
- precise, not plush
- structured by spacing and typography more than card piles
- equally intentional in light and dark
- implemented through shared tokens, primitives, and shell recipes
- visibly consistent with the public Cursor site at a system level
