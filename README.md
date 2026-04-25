<!-- markdownlint-disable MD041 -->
Languages: English | [日本語](./docs/i18n/README.ja.md) | [简体中文](./docs/i18n/README.zh-Hans.md)

# myTE Tools (Tampermonkey)

`myTE Tools` is a Tampermonkey userscript for `https://myte.accenture.com/*`.

It combines two features in one toolbar:

- Working Hours auto-fill (with optional overtime sync and vacation skip)
- Email template tools with Summary/Time/Expenses/Adjustments screenshots

## Features

- Add toolbar buttons in myTE header:
  - `⏰` Open Working Hours dialog
  - `📧` Open Email Template dialog
- Auto-fill Work/Break/Work rows for Working Hours
- Optional overtime synchronization from Daily Overtime row
- Optional vacation skipping based on configured codes
- Copy email body to clipboard with inline screenshots for:
  - Summary
  - Time
  - Expenses
  - Adjustments
- Generate `.eml` file with embedded screenshots for:
  - Summary
  - Time
  - Expenses
  - Adjustments
- Reset email template to the built-in default
- Save email template by Tampermonkey storage (`GM_setValue` / `GM_getValue`)

## Installation

1. Install the `Tampermonkey` browser extension.
1. Ensure extension settings are enabled:
   - Developer mode
   - Allow user scripts

![Extensions settings](./public/images/Extensions.png)
![Allow user scripts](./public/images/UserScript.png)

1. Open the script raw URL:

```text
https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
```

1. Tampermonkey will open the install page, then click `Install`.
1. In Tampermonkey, make sure the `myTE Tools` script is enabled.

![Enable myTE Tools script in Tampermonkey](./public/images/image.png)

1. Reload myTE and open the Working Hours page.

## Usage

### Working Hours (`⏰`)

1. Click `⏰` on the myTE toolbar.

![Header toolbar buttons](./public/images/image-1.png)

1. Adjust (Work / Break / Work) rows as needed.

![Sample generated email content](./public/images/image-2.png)

1. Optionally enable:
   - `Auto-sync Overtime`: Automatically apply overtime hours.
   - `Skip Vacations`: Do not auto-fill days that include leave/vacation entries.
1. Click `START FILLING`.
1. Wait for completion notice.

### Email Tools (`📧`)

1. Click `📧` on the myTE toolbar.

![Header toolbar buttons](./public/images/image-1.png)

1. Edit YAML frontmatter + Markdown template if needed.

![Sample generated email content](./public/images/image-3.png)

1. Use one of the dialog actions:
   - `Reset Template`: restore the default template and save it immediately.
   - `Copy Content`: capture 4 tabs, replace placeholders with screenshots, copy the email body to the clipboard, and show a completion alert.
   - `Downlowd Email`: capture 4 tabs and download an `.eml` file with embedded images.
2. The copied/downloaded content includes screenshots from:
   - Summary
   - Time
   - Expenses
   - Adjustments
3. The template is saved automatically when the textarea loses focus.

### Email template format

The email template is a single document that follows Jekyll-style YAML front matter:

- YAML front matter (between `---` and `---`) for metadata
- Markdown body for email content

Reference:

- [Front Matter | Jekyll • Simple, blog-aware, static sites](https://jekyllrb.com/docs/front-matter/)

Example:

```yaml
---
from: 'from@example.com'
to: 'to@example.com'
cc:
  - 'cc@example.com'
subject: '[myTE] Period {{period}} Approval Request'
---
```

```markdown
Dear Team,

## Summary
{{Summary}}
## Time
{{Time}}
## Expenses
{{Expenses}}
## Adjustments
{{Adjustments}}

regards,
```

Supported metadata keys:

- `from`: Sender address
- `to`: Recipient address
- `cc`: CC addresses (array or comma-separated string)
- `subject`: Subject template
- `displayName`: Used for fallback subject and filename

Subject variables:

- `{{period}}` is replaced with current period like `2026/04/15`

Body placeholders:

- `{{Summary}}`, `{{Time}}`, `{{Expenses}}`, `{{Adjustments}}` are replaced with captured images in the HTML email body.
- In `Copy Content`, the screenshots are embedded as inline clipboard images.

## Update behavior

If installed from the `raw.githubusercontent.com` URL above, Tampermonkey can check for updates from the same URL.

## Acknowledgements

This project is inspired by:

- [ballban/MyTE_Auto_Filler](https://github.com/ballban/MyTE_Auto_Filler)
- [souka-souka/myTE-Eml-Auto-Generator](https://github.com/souka-souka/myTE-Eml-Auto-Generator)
- [ava-innersource/myte-automate: This automate myTE Working Hours input](https://github.com/ava-innersource/myte-automate)
