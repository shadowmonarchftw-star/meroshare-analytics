# Chrome Web Store Publishing Guide

This document keeps the Chrome Web Store listing, privacy answers, and extension behavior aligned.

## Single Purpose

Enhance the Mero Share Nepal experience with portfolio analytics, sync, alerts, and local tracking tools.

## Short Description

Advanced portfolio analytics, sync, alerts, and local insights for Mero Share Nepal.

## Detailed Description

Mero Share Integrated Stock Tracker adds a richer analytics layer to the Mero Share experience with portfolio tracking, gain/loss calculations, WACC-based insights, local price alerts, corporate-action monitoring, exports, and portfolio planning tools.

Key features:
- Portfolio dashboard with value, investment, and profit/loss insights
- WACC-aware calculations and purchase analysis
- Local desktop price alerts
- Corporate action tracking from public sources
- CSV/PDF export and JSON backup/restore
- Privacy helpers such as hidden-number mode
- Optional astrology-style insights for users who choose to enter birth details

How it works:
- Uses the user's existing logged-in Mero Share session to read portfolio and purchase data
- Stores portfolio metrics, notes, alerts, settings, and other extension data locally in the browser
- Fetches public market data and public corporate-action pages to enrich calculations
- Does not operate a publisher-owned backend or analytics service for portfolio data

## Privacy Tab Answers

Use conservative answers that match the code and privacy policy.

- Does this item collect or transmit user data?: Yes
- What user data is involved?: Financial/account information available through the user's Mero Share session, plus optional user-entered birth details if astrology-style features are used
- Is all user data encrypted in transit?: Yes
- Is the data sold?: No
- Is the data used for purposes unrelated to the item's core functionality?: No
- Is the data used to determine creditworthiness or for lending purposes?: No

## Data Handling Notes

- Portfolio data, notes, alerts, history, and settings are stored locally in browser storage.
- The extension sends authenticated requests to the official Mero Share backend using the user's active session.
- The extension also downloads public market data from configured HTTPS mirrors.
- The extension downloads public corporate-action pages from ShareSansar.
- The extension loads Google Fonts over HTTPS for the injected dashboard UI.
- External research or market links open only when the user clicks them.

## Privacy Policy URL

Use the public GitHub URL for the policy:

- https://github.com/shadowmonarchftw-star/meroshare-analytics/blob/main/PRIVACY_POLICY.md

## Final Pre-Publish Checklist

- Confirm `manifest.json` version is the release version you want to publish.
- Load the unpacked extension in Chrome and verify the background service worker starts successfully.
- Log in to Mero Share and run a full sync in Chrome.
- Verify portfolio, WACC, alerts, backup/restore, and dashboard rendering.
- Verify large purchase histories paginate correctly when "Show all" is unavailable.
- Verify the privacy policy URL is public and matches extension behavior.
- Make sure the Chrome Web Store Privacy tab answers match this document and `PRIVACY_POLICY.md`.
- Package the release zip from the repo root and upload that exact artifact.
- Capture final store screenshots from Chrome after validating the current build.
- Review the permission list one last time before submission.
