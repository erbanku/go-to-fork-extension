# Go to Fork Chrome Extension

A Chrome extension that shows a convenient link to your forked repository when viewing the upstream repository on GitHub.

Chrome Web Store:
https://chromewebstore.google.com/detail/github-go-to-fork/gmafgjjojobkaegbpnmkjlhjnfcbokdj
## Features

- Automatic detection when viewing a repository you have forked
- One-click navigation via a "Go to Fork" button in the repository header
- Multi-account support: checks all your organizations and personal accounts
- Dropdown menu when multiple forks exist
- Seamless integration with GitHub's UI

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked" and select this extension folder
5. Click the extension icon in your browser toolbar
6. Click "Generate Token on GitHub" to create a personal access token with these scopes:
   - `public_repo` - Access public repositories
   - `read:org` - Read organization membership
7. Copy the generated token and paste it into the extension popup
8. Click "Save Token"

## Required Permissions

- `public_repo` - Access public repositories
- `read:org` - Read organization membership

## Privacy

- Only works on `github.com` pages
- Uses your GitHub Personal Access Token stored locally in your browser
- Only requests minimum required permissions
- Does not send your token or any data to external servers
- Does not track your activity
- Token is stored securely using Chrome's sync storage (encrypted)

## License

MIT License

See [LICENSE](LICENSE) file for details.
