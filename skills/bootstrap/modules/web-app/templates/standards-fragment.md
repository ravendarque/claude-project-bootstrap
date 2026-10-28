### Web app

Platform persona for this stack: what ends up in the bundle and its size,
browser support, loading, empty and error states, and accessibility.

- **End-to-end tests with WebdriverIO** in Chromium and Firefox, against the
  built app, and in Safari on a macOS runner for public repositories
  (`E2E_BROWSERS` picks the browsers). axe-core checks every page against WCAG 2.2 AA at phone width
  in light and dark themes; a new page joins the accessibility spec's list.
- **Escape all user-controlled data** before it's interpolated into HTML.
  Never build markup from raw input.
- **A real `<button>` for anything clickable.** Modals have
  `role="dialog"`, `aria-modal`, a focus trap and Escape to close.
- **Links in running text are underlined**, not told apart by colour alone.
- **A button that opens something uses `aria-expanded`; one that toggles a
  setting uses `aria-pressed`.** Never both on the same button.
- **Don't style an empty state as an error.**
