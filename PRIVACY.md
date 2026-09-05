# castmd Privacy Policy

Last updated: 26 August 2026 (castmd v1.4.0)

castmd is a Chrome extension that converts the web page you are viewing, or a local Markdown file
you open, into Markdown, JSON, or XML. All of that happens on your own device.

Canonical URL: https://castmd.cc4.marketing/privacy

## The short version

castmd collects no data. No analytics, no telemetry, no accounts, no cookies, no identifiers. The
developer receives nothing from your use of the extension.

## What castmd does with page content

When you invoke castmd (toolbar click, the right-click item, or the keyboard shortcut), it reads
the content of the page you acted on and converts it in your browser. The result goes to your
clipboard or to a file you download. Nothing is stored by the extension after the popup closes,
and nothing is transmitted to the developer or to any third party.

castmd does not run on pages you have not acted on, and it does not insert scripts, ads, or links
into pages you visit.

## Network requests

castmd makes network requests in exactly one case. When you start a Confluence tree export, it
fetches page content from your own Confluence Cloud site (https://your-tenant.atlassian.net) using
the session you are already signed in with. Those requests go directly from your browser to
Atlassian. No other network requests are made, and no remote code is ever loaded or executed.

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
