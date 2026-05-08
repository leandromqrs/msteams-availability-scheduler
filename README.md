## Teams Availability Scheduler

[![Build](https://github.com/leandromqrs/msteams-availability-scheduler/actions/workflows/build.yml/badge.svg)](https://github.com/leandromqrs/msteams-availability-scheduler/actions/workflows/build.yml)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com)
[![Edge Add-ons](https://img.shields.io/badge/Microsoft%20Edge-Add--ons-0078D4?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons)

A Chrome/Edge extension that keeps your Microsoft Teams status active on a configurable weekly schedule, no subscriptions, no accounts, no external servers.

> **Note:** Use ethically and in compliance with your organization's policies.

![Extension screenshot](example_store.png?raw=true)

---

## Features

- **Weekly schedule** — define time slots per day when keep-alive should be active
- **All Days slots** — add intervals that apply to every day of the week
- **Per-day overrides** — day-specific slots take priority over All Days slots for status selection
- **Analog clock picker** — Android-style clock dialog for selecting times, or type directly
- **Drag & drop reordering** — reorder intervals within a day or move them across days
- **Status per interval** — choose Available, Busy, Away, or Do Not Disturb for each slot
- **Manual mode** — bypass the schedule and keep keep-alive always active
- **Force "Available"** — always set status to Available regardless of current status
- **Respect meetings** — optionally skip status changes during active calls or meetings
- **Extension enabled toggle** — turn everything on or off instantly from the popup
- **Schedule page** — full-page schedule editor (no popup width limits) opened via the popup button
- **Service worker keep-alive** — offscreen document + alarms prevent Chrome from suspending the extension
- **Teams tab detection** — automatically finds all open Teams tabs and sends keep-alive ticks
- **Auto-save** — all changes persist instantly to `chrome.storage.local`
- **Debug mode** — optional console logging for troubleshooting

---

## Installation

1. Download or clone this repository
2. Open Chrome/Edge and go to `chrome://extensions` or to `edge://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extension folder

---

## How it works

The extension runs a service worker that fires every minute to evaluate whether keep-alive should be active based on the current time and your configured schedule. When active, it sends periodic ticks to all open Teams tabs via a content script (`keepAlive.js`) that simulates mouse movement, overrides the Visibility API, and interacts with the Teams presence menu to maintain your chosen status.

An offscreen document with a silent AudioContext is used to prevent Chrome from suspending the service worker between alarm cycles.

---

## Schedule configuration

Click **Configure Schedule** in the popup to open the full schedule editor in a new tab.

- **All Days** — slots here are active every day of the week
- **Per-day sections** — slots here override the All Days status for that specific day
- Multiple intervals per day are supported
- Drag the grip handle on the left of any interval to reorder or move it to another day
- Click the clock icon next to a time input to open the analog picker

---

## Support

If this extension is useful to you, consider buying me a coffee ☕

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/leandromqrs)
