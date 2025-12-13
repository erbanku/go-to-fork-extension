# Privacy Policy

**Last Updated:** December 12, 2025

## Overview

Go to Fork is a Chrome extension that helps you navigate between GitHub repositories and their forks. I am committed to protecting your privacy and being transparent about how I handle your data.

## Data Collection

**I do not collect, store, or transmit any of your personal information to external servers.**

### What I Don't Collect

- I do not collect any analytics or usage data
- I do not track your browsing history
- I do not collect information about which repositories you visit
- I do not upload any data to external servers
- I do not share any information with third parties

## Local Storage

### GitHub Personal Access Token

- Your GitHub Personal Access Token is stored **locally on your device only** using Chrome's `chrome.storage.sync` API
- The token is encrypted by Chrome and synchronized across your Chrome browsers if you're signed in to Chrome sync
- The token is never transmitted to my servers (I don't have any servers)
- The token is only used to make API requests directly from your browser to GitHub's API

### How Your Token Is Used

Your GitHub token is used exclusively to:
1. Authenticate API requests to GitHub's public API
2. Fetch information about repositories and forks you have access to
3. Determine which organizations you belong to

All API requests are made **directly from your browser to GitHub** - there are no intermediary servers.

## Permissions

The extension requires the following permissions:

- **`storage`**: To save your GitHub token locally on your device
- **`https://github.com/*`**: To inject the navigation buttons on GitHub repository pages
- **Host permission for `github.com`**: To read repository information and inject UI elements

## Third-Party Services

The only third-party service this extension interacts with is:

- **GitHub API** (`api.github.com`): For fetching repository and fork information using your personal access token

No other third-party services are used.

## Data Security

- Your GitHub token is stored securely using Chrome's built-in storage encryption
- All communication with GitHub's API uses HTTPS
- The extension operates entirely within your browser - no backend servers exist

## Your Rights

You have complete control over your data:

- You can remove your GitHub token at any time through the extension popup
- You can uninstall the extension at any time, which removes all locally stored data
- You can revoke the GitHub token from your GitHub settings at any time

## Changes to This Privacy Policy

I may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated "Last Updated" date.

## Contact

If you have any questions about this Privacy Policy, please open an issue on my [GitHub repository](https://github.com/erbanku/go-to-fork-extension).

## Open Source

This extension is open source. You can review the complete source code to verify my privacy practices at: https://github.com/erbanku/go-to-fork-extension
