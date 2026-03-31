# Admin Smoke Tests

Run this quick checklist after auth, form, theme, or widget changes.

## Login

1. Open `admin-panel.html`.
2. Enter a wrong email or password and click `Login`.
3. Confirm the form does not reset and the inline error stays visible.
4. Press `Enter` inside the email field.
5. Press `Enter` inside the password field.
6. Confirm both paths trigger the same login behavior.
7. Log in with a valid admin account.
8. Confirm the dashboard opens and only the password field is cleared.

## Password Toggle

1. Type a password on the login screen.
2. Click the eye icon repeatedly.
3. Confirm the field toggles between hidden and visible every time.
4. Confirm the icon changes between `eye` and `eye-slash`.

## Session

1. Refresh the page after a successful login.
2. Confirm the admin session restores cleanly.
3. Click `Logout`.
4. Confirm the dashboard hides and the login screen returns.

## Dark Mode

1. Toggle dark mode in the admin panel.
2. Confirm body text, labels, placeholders, and form values are readable.
3. Open the main site in dark mode and check card text plus inputs.
4. Open the WhatsApp widget and confirm the bubble, header, input, and placeholder text are readable.

## Forms

1. Type into each admin form for a few seconds.
2. Confirm values do not reset while typing.
3. Open and close tabs.
4. Confirm only the intended forms reset.
