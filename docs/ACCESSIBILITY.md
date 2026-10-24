# Accessibility record

Last run: 24 October 2026, Chrome via Playwright, `tests/e2e/accessibility.spec.ts` (part of `npm run test:e2e`).

## What was checked automatically

These are scripted checks. They catch rule violations and broken keyboard paths, but they are **not a screen-reader test**.

| Check | Scope | Result |
|---|---|---|
| axe-core 4.13.0 (via `@axe-core/playwright` 4.13.0), WCAG 2.0/2.1/2.2 A and AA rules | Landing, method, forest inspector, registry, sign-in and registration at 1440 px and 390 px; empty workspace; new case; all seven shipment tabs at 1440 px and 390 px, after real uploads; the open review dialog | No violations after the fixes below |
| Keyboard-only journey | Registration by Tab and typing only; case creation; tab switching; opening and closing the review dialog | Passes |
| Focus order and visibility | Skip link is the first stop on a fresh load. After in-app navigation, focus moves to `#main`. The focused tab shows a visible outline. | Passes |
| Tabs | Shipment and landing demo tabs follow the WAI-ARIA tabs pattern: one Tab stop, arrow keys, Home and End, `aria-selected`, `aria-controls` | Passes |
| Dialog | Native modal `<dialog>` with an accessible name. Opening moves focus inside it. Over 25 Tab presses, focus stays in the dialog or briefly on the browser's page boundary, never on page content behind it. and Escape closes it and returns focus to the trigger. | Passes |
| Error announcements | A failed sign-in and a rejected GeoJSON upload appear in `role="alert"` regions | Passes |
| Status updates | "Saved N field(s)" appears inside a polite live region. Toasts use `role="status"` with `aria-live="polite"`. | Passes |
| Form labels | Every input, select and textarea in the scanned views has an accessible name (axe `label` rule; the tests find fields by label) | Passes |
| Reduced motion | With `prefers-reduced-motion: reduce`, all content is visible without animation (covered by `workflow.spec.ts`) | Passes |

## Fixes made during this pass

- **Statement text contrast:** the second sentence of the landing statement ("A clean result is not proof.") was below contrast. It now uses the slate token.
- **Scrollable regions:** the evidence trace diagram scrolls sideways on narrow screens, and was not keyboard-reachable. It is now a focusable, labelled region. Data tables use a `TableWrap` component that does the same only while the table actually overflows.
- **Narrow tables:** table headers now wrap on screens narrower than 560 px. At 390 px the loss-year table fits instead of hiding its last column.
- **Tabs:** arrow, Home and End keys and roving tabindex added. The forest inspector's "Coordinate box / Paste GeoJSON" switch was mislabelled as tabs and is now a toggle-button group (`aria-pressed`).
- **Plots tab:** after the first plot upload in a new case, no plot was selected, so the evidence panel stayed empty until a click. The first plot is now shown by default. This affected all users, not only assistive technology.

## Not yet tested (needs a person)

- **Screen readers:** no NVDA, JAWS, VoiceOver or TalkBack session has been run. Still unknown:
  - how the findings list, process line and pixel map are read aloud in practice;
  - whether live-region announcements are timely and not repeated;
  - whether the map's text alternative (legend, loss-year table and summary) is enough without the picture.
- **Other conditions:** Windows high-contrast mode and forced colours, 200–400 % zoom and text spacing overrides, and voice control have not been tested.
- **Cognitive load:** the plain-language review of finding text has not been done with users.

Suggested manual pass: NVDA with Chrome on Windows, and VoiceOver with Safari on iOS. Cover registration, creating a case, uploading a CSV with an error, reading a finding, opening its source, recording an investigation, and downloading the supplier request.
