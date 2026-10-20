## 2024-05-24 - Contextual Disabled Tooltips
**Learning:** In complex game interfaces where buttons can be disabled for multiple reasons (e.g., maximum team count reached, not enough members, being in a vehicle), simple disabled states leave users confused about *why* the action is unavailable.
**Action:** Always pair `disabled` states on action buttons with dynamic `title` (or tooltip) attributes that explicitly state the unmet condition blocking the action.
## 2024-05-24 - Interactive List Accessibility
**Learning:** Custom interactive list items (like `<li>` elements acting as buttons) completely exclude keyboard-only users if they rely only on `pointerdown` or `click` handlers, preventing critical gameplay functions (e.g., team selection and marking).
**Action:** Always ensure that dynamically generated custom interactive list items include `tabindex="0"`, `role="button"`, state attributes like `aria-pressed`, and explicitly map `keydown` events (Enter/Space) to the same interaction logic as pointer events.
## 2024-10-19 - Focus States on Custom Roles
**Learning:** Custom interactive elements (like `<li>` with `role="button"`) created dynamically often lack the default browser focus outlines that native `<button>`s receive, leaving keyboard users with no visual indication of their current location.
**Action:** Always pair `role="button"` assignments with explicit `:focus-visible` CSS styling, ensuring the outline offset accounts for the element's container to prevent clipping.
## 2024-11-20 - Custom List Item Content Gibberish
**Learning:** Concatenating visual elements like acronyms, icons, and raw numbers in custom list items (like the squad UI) creates inaccessible, contextless gibberish when read by a screen reader (e.g., reading out "Alpha team 3g 4r" or just numbers back to back).
**Action:** Always provide a clear, human-readable `aria-label` on the container element (e.g., `aria-label="Alpha team, 3 grenades, 4 rockets"`) and hide the visual abbreviations/icons from screen readers using `aria-hidden="true"`.
