## 2024-05-24 - Contextual Disabled Tooltips
**Learning:** In complex game interfaces where buttons can be disabled for multiple reasons (e.g., maximum team count reached, not enough members, being in a vehicle), simple disabled states leave users confused about *why* the action is unavailable.
**Action:** Always pair `disabled` states on action buttons with dynamic `title` (or tooltip) attributes that explicitly state the unmet condition blocking the action.
## 2024-05-24 - Interactive List Accessibility
**Learning:** Custom interactive list items (like `<li>` elements acting as buttons) completely exclude keyboard-only users if they rely only on `pointerdown` or `click` handlers, preventing critical gameplay functions (e.g., team selection and marking).
**Action:** Always ensure that dynamically generated custom interactive list items include `tabindex="0"`, `role="button"`, state attributes like `aria-pressed`, and explicitly map `keydown` events (Enter/Space) to the same interaction logic as pointer events.
