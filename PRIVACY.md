# castmd Privacy Policy

Last updated: 6 November 2026 (export to HTML, PDF and DOCX)

castmd is a Chrome extension that converts the web page you are viewing, or a local Markdown file
you open, into Markdown, JSON, or XML. All of that happens on your own device.

Canonical URL: https://castmd.cc4.marketing/privacy

## The short version

castmd collects no data. No analytics, no telemetry, no accounts, no cookies, no identifiers. The
developer receives nothing from your use of the extension.

## What castmd does with page content

When you invoke castmd (toolbar click, the right-click item, or the keyboard shortcut), it reads
the content of the page you acted on and converts it in your browser. The result goes to your
clipboard or to a file you download. Nothing is transmitted to the developer or to any third
party.

## What castmd stores on your device

- Export: when you pick "Export as HTML, PDF, DOCX", the captured page is handed to the export
  page through Chrome's session storage. Only the latest capture is kept, and Chrome clears it when
  the browser closes.
- Brand presets: a brand file you import or create on the export page (logo, colors, fonts,
  contact details) and its on/off choices are kept in Chrome's local storage on your device until
  you remove the preset. castmd ships with no brand presets.

castmd does not run on pages you have not acted on, and it does not insert scripts, ads, or links
into pages you visit.

## Network requests

castmd makes network requests in two cases, both started by you:

- Confluence tree export: it fetches page content from your own Confluence Cloud site
  (https://your-tenant.atlassian.net) using the session you are already signed in with.
- Export as HTML, PDF, DOCX: the export page downloads the pictures of the page you exported, from
  the addresses that page already uses, so they can be embedded in the file. If a site blocks
  that, the export page offers a button that requests access to all sites and tries again;
  without it you export without those pictures.

These requests go directly from your browser to those sites. No other network requests are made,
and no remote code is ever loaded or executed.

## Local Markdown files

If you turn on "Allow access to file URLs" for castmd, opening a `.md` file from disk renders it as
formatted HTML. Clicking Save writes your edits back through Chrome's own file picker, so the write
target is always a location you chose. File contents never leave your machine.

## Permissions and why they exist

- `activeTab`, `scripting`: read and convert the page you explicitly act on
- `clipboardWrite`: put the result on your clipboard when you pick a Copy action
- `contextMenus`: add the right-click item "Copy page as Markdown"
- `tabs`: list the open tabs, with their titles and URLs, for the "Copy all tabs" and "Save all
  tabs" actions, and to detect whether the current page is a Confluence page
- `storage`: hand a captured page to the export page, and keep the brand presets you import
- Optional host access: never granted at install. Requested at runtime only for the export you
  started, and only for the site it targets

## Children

castmd is a developer and productivity tool. It is not directed at children and collects no
information from anyone, including children.

## Changes

Any change to this policy is published at the policy URL and noted in the extension changelog. The
source is public, so every claim here can be verified: https://github.com/blacklogos/castmd

## Contact

Questions about this policy: open an issue at https://github.com/blacklogos/castmd/issues
