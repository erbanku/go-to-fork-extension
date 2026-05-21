// Cache for quick access links to avoid repeated storage reads
let cachedQuickAccessLinks = null;
let cachedGithubToken = null;
let cachedSettings = null;
const QUICK_LINKS_STORAGE_KEY = "quickAccessLinks";
const QUICK_LINKS_STORAGE_AREA_KEY = "quickAccessLinksStorageArea";
let quickAccessButtonsObserver = null;
let quickAccessButtonsRaf = null;
let quickAccessButtonsInjecting = false;
const PACKAGE_METADATA_CLASS = "gh-assistant-package-metadata";
const PACKAGE_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const PACKAGE_METADATA_ACCESS_BACKOFF_MS = 5 * 60 * 1000;
const packageMetadataCache = new Map();
const packageMetadataRequests = new Map();
let packageMetadataRaf = null;
let packageMetadataAccessBlockedUntil = 0;
let packageMetadataAccessBlockedMessage = "";

// Global flag to ensure hotkeys are only initialized once
let hotkeysInitialized = false;

// Default settings - all features enabled by default
const DEFAULT_SETTINGS = {
    showImportButton: true,
    showQuickAccessLinks: true,
    showForkUpstreamButtons: true,
    showRawPageButtons: true,
    showCommitPRButtons: true,
    enableHotkeys: true,
    navHotkeys: [
        { keys: ['g', 'v'], name: 'Repo Owner Homepage', url: null, dynamic: true, urlType: 'owner-home' },
        { keys: ['g', 'h'], name: 'Repo Owner Homepage Alt', url: null, dynamic: true, urlType: 'owner-home' },
        { keys: ['g', 'd'], name: 'Dashboard', url: null, dynamic: true, urlType: 'dashboard' },
        { keys: ['g', 'f'], name: 'Repo Owner Feed/Dashboard', url: null, dynamic: true, urlType: 'owner-feed' },
        { keys: ['g', 't'], name: 'Packages Page', url: null, dynamic: true, urlType: 'packages' },
        { keys: ['g', 'g'], name: 'My Gists', url: null, dynamic: true, urlType: 'gists' },
        { keys: ['g', 'l'], name: 'Linear', url: 'https://linear.app', dynamic: false, urlType: 'static' },
        { keys: ['g', 'c'], name: 'GitHub Copilot', url: 'https://github.com/copilot', dynamic: false, urlType: 'static' },
    ],
};

// Load quick access links into cache
async function loadQuickAccessLinksCache() {
    const [syncResult, localResult] = await Promise.all([
        new Promise((resolve) => {
            chrome.storage.sync.get(
                [QUICK_LINKS_STORAGE_KEY, QUICK_LINKS_STORAGE_AREA_KEY],
                resolve
            );
        }),
        new Promise((resolve) => {
            chrome.storage.local.get(
                [QUICK_LINKS_STORAGE_KEY, QUICK_LINKS_STORAGE_AREA_KEY],
                resolve
            );
        }),
    ]);

    if (
        localResult[QUICK_LINKS_STORAGE_AREA_KEY] === "local" &&
        Array.isArray(localResult[QUICK_LINKS_STORAGE_KEY])
    ) {
        cachedQuickAccessLinks = localResult[QUICK_LINKS_STORAGE_KEY];
        return;
    }

    if (
        syncResult[QUICK_LINKS_STORAGE_AREA_KEY] === "sync" &&
        Array.isArray(syncResult[QUICK_LINKS_STORAGE_KEY])
    ) {
        cachedQuickAccessLinks = syncResult[QUICK_LINKS_STORAGE_KEY];
        return;
    }

    if (Array.isArray(syncResult[QUICK_LINKS_STORAGE_KEY])) {
        cachedQuickAccessLinks = syncResult[QUICK_LINKS_STORAGE_KEY];
        return;
    }

    if (Array.isArray(localResult[QUICK_LINKS_STORAGE_KEY])) {
        cachedQuickAccessLinks = localResult[QUICK_LINKS_STORAGE_KEY];
        return;
    }

    cachedQuickAccessLinks = [];
}

function handleQuickAccessLinkStorageChange(changes, areaName) {
    if (!changes[QUICK_LINKS_STORAGE_KEY] && !changes[QUICK_LINKS_STORAGE_AREA_KEY]) {
        return;
    }

    const areaValue = changes[QUICK_LINKS_STORAGE_AREA_KEY]
        ? changes[QUICK_LINKS_STORAGE_AREA_KEY].newValue
        : undefined;
    const linksValue = changes[QUICK_LINKS_STORAGE_KEY]
        ? changes[QUICK_LINKS_STORAGE_KEY].newValue
        : undefined;

    if (areaName === "local" && areaValue === "local" && Array.isArray(linksValue)) {
        cachedQuickAccessLinks = linksValue;
        injectQuickAccessButtons();
        return;
    }

    if (areaName === "sync" && areaValue === "sync" && Array.isArray(linksValue)) {
        cachedQuickAccessLinks = linksValue;
        injectQuickAccessButtons();
        return;
    }

    if (
        areaName === "local" &&
        changes[QUICK_LINKS_STORAGE_KEY] &&
        Array.isArray(linksValue) &&
        cachedQuickAccessLinks !== null
    ) {
        cachedQuickAccessLinks = linksValue;
        injectQuickAccessButtons();
        return;
    }

    if (
        areaName === "sync" &&
        changes[QUICK_LINKS_STORAGE_KEY] &&
        Array.isArray(linksValue) &&
        cachedQuickAccessLinks !== null
    ) {
        cachedQuickAccessLinks = linksValue;
        injectQuickAccessButtons();
        return;
    }

    if (
        changes[QUICK_LINKS_STORAGE_KEY] &&
        !Array.isArray(linksValue) &&
        changes[QUICK_LINKS_STORAGE_AREA_KEY]
    ) {
        loadQuickAccessLinksCache().then(() => {
            injectQuickAccessButtons();
        });
    }
}

// Load GitHub token into cache
async function loadGithubTokenCache() {
    const result = await new Promise((resolve) => {
        chrome.storage.sync.get(["githubToken"], resolve);
    });
    cachedGithubToken = result.githubToken || null;
}

// Load settings into cache
async function loadSettingsCache() {
    const result = await new Promise((resolve) => {
        chrome.storage.sync.get(["extensionSettings"], resolve);
    });
    const stored = result.extensionSettings || {};

    cachedSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
    };

    // Ensure navHotkeys is a valid array with proper structure
    if (!Array.isArray(cachedSettings.navHotkeys)) {
        cachedSettings.navHotkeys = DEFAULT_SETTINGS.navHotkeys;
    } else if (cachedSettings.navHotkeys.length === 0) {
        // If array is empty, use default
        cachedSettings.navHotkeys = DEFAULT_SETTINGS.navHotkeys;
    } else {
        // Validate each hotkey entry has required properties
        cachedSettings.navHotkeys = cachedSettings.navHotkeys.filter((hotkey) => {
            return hotkey &&
                   hotkey.keys &&
                   Array.isArray(hotkey.keys) &&
                   hotkey.keys.length > 0 &&
                   hotkey.urlType;
        });

        // If all hotkeys were filtered out, use defaults
        if (cachedSettings.navHotkeys.length === 0) {
            cachedSettings.navHotkeys = DEFAULT_SETTINGS.navHotkeys;
        }
    }
}

// Listen for storage changes to update cache
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" || areaName === "local") {
        handleQuickAccessLinkStorageChange(changes, areaName);
    }

    if (areaName === "sync") {
        if (changes.githubToken) {
            cachedGithubToken = changes.githubToken.newValue || null;
            packageMetadataCache.clear();
            packageMetadataRequests.clear();
            packageMetadataAccessBlockedUntil = 0;
            packageMetadataAccessBlockedMessage = "";
            // Re-initialize to update fork/upstream/import buttons
            init();
        }
        if (changes.extensionSettings) {
            cachedSettings = {
                ...DEFAULT_SETTINGS,
                ...(changes.extensionSettings.newValue || {}),
            };
            // Re-initialize to apply new settings
            init();
            initRawPage();
        }
    }
});

// GitHub has deprecated the import API endpoint.
// Now we redirect users to GitHub's official import tool.
function handleImportRepo(owner, repo, repoData, currentUser, githubToken) {
    // Store import data in sessionStorage for the import page to read
    sessionStorage.setItem(
        "gh_import_data",
        JSON.stringify({
            url: repoData.clone_url,
            name: repo,
            description: repoData.description || "",
            private: repoData.private,
            username: currentUser,
            token: githubToken,
            timestamp: Date.now(),
        }),
    );

    // Redirect to GitHub's import page with just the URL
    const importUrl = `https://github.com/new/import`;
    window.location.href = importUrl;
}

// Inject quick access buttons for custom links
async function injectQuickAccessButtons() {
    // Don't inject on raw pages
    if (
        window.location.hostname.includes("raw.githubusercontent.com") ||
        window.location.hostname.includes("gist.githubusercontent.com")
    ) {
        return;
    }

    // Check settings
    if (cachedSettings === null) {
        await loadSettingsCache();
    }
    if (!cachedSettings.showQuickAccessLinks) {
        return;
    }

    // Use cached links if available, otherwise load from storage
    if (cachedQuickAccessLinks === null) {
        await loadQuickAccessLinksCache();
    }

    const links = cachedQuickAccessLinks;
    const activeLinks = links.filter((link) => link.url);

    if (activeLinks.length === 0) {
        return;
    }

    // Find the top-nav-center section for button placement
    const topNavCenter = document.querySelector('[data-testid="top-nav-center"]');

    if (!topNavCenter) {
        console.log(
            "GitHub Assistant: Could not find top-nav-center for quick access buttons",
        );
        return;
    }

    const existing = document.getElementById(
        "github-assistant-quick-access-container",
    );
    if (existing && topNavCenter.contains(existing)) {
        return;
    }

    if (existing) {
        existing.remove();
    }

    // Find the search button group to insert before it
    const searchButtonGroup = topNavCenter.querySelector(".Search-module__searchButtonGroup--L3A4O") ||
                             topNavCenter.querySelector('[class*="Search"]');

    // Create container for quick access buttons - single row
    const container = document.createElement("div");
    container.id = "github-assistant-quick-access-container";
    container.style.cssText = `
        display: inline-flex;
        gap: 6px;
        align-items: center;
        margin-right: 8px;
    `;

    // Color palette for buttons
    const colorMap = {
        blue: {
            bg: "#ddf4ff",
            border: "#54aeff",
            text: "#0969da",
            hover: "#b6e3ff",
        },
        yellow: {
            bg: "#fff8c5",
            border: "#d4a72c",
            text: "#7d4e00",
            hover: "#fae17d",
        },
        green: {
            bg: "#dcffe4",
            border: "#4ac26b",
            text: "#116329",
            hover: "#aceebb",
        },
        purple: {
            bg: "#fbefff",
            border: "#d4a5db",
            text: "#8250df",
            hover: "#f2d8ff",
        },
    };

    // Create buttons for each link
    activeLinks.forEach((link, index) => {
        const displayName = link.name || `#${links.indexOf(link) + 1}`;
        const colorScheme = colorMap[link.color] || colorMap["green"];

        const button = document.createElement("a");
        button.href = link.url;
        button.target = "_blank";
        button.rel = "noopener noreferrer";
        button.className = "btn btn-sm";
        button.style.cssText = `
            display: inline-flex;
            align-items: center;
            height: 32px;
            background: ${colorScheme.bg};
            color: ${colorScheme.text};
            border: 1px solid ${colorScheme.border};
            padding: 5px 12px;
            font-size: 14px;
            text-decoration: none;
            border-radius: 6px;
            white-space: nowrap;
            cursor: pointer;
            transition: background 0.2s ease;
            font-weight: 600;
            text-transform: uppercase;
            line-height: 20px;
        `;
        button.textContent = displayName;
        button.title = `Quick access: ${link.url}`;

        button.addEventListener("mouseenter", () => {
            button.style.background = colorScheme.hover;
        });
        button.addEventListener("mouseleave", () => {
            button.style.background = colorScheme.bg;
        });

        container.appendChild(button);
    });

    // Insert buttons before search
    if (searchButtonGroup) {
        topNavCenter.insertBefore(container, searchButtonGroup);
    } else {
        topNavCenter.insertBefore(container, topNavCenter.firstChild);
    }

    console.log(
        `GitHub Assistant: Injected ${activeLinks.length} quick access button(s)`,
    );
}

function stopQuickAccessButtonsObserver() {
    if (quickAccessButtonsObserver) {
        quickAccessButtonsObserver.disconnect();
        quickAccessButtonsObserver = null;
    }

    if (quickAccessButtonsRaf !== null) {
        cancelAnimationFrame(quickAccessButtonsRaf);
        quickAccessButtonsRaf = null;
    }
}

async function ensureQuickAccessButtons() {
    if (quickAccessButtonsInjecting) {
        return;
    }

    quickAccessButtonsInjecting = true;
    try {
        await injectQuickAccessButtons();
    } finally {
        quickAccessButtonsInjecting = false;
    }
}

function scheduleQuickAccessButtonsInjection() {
    if (
        window.location.hostname.includes("raw.githubusercontent.com") ||
        window.location.hostname.includes("gist.githubusercontent.com")
    ) {
        return;
    }

    const tryInject = async () => {
        quickAccessButtonsRaf = null;

        const topNavCenter = document.querySelector('[data-testid="top-nav-center"]');
        if (!topNavCenter) {
            return;
        }

        await ensureQuickAccessButtons();
    };

    if (quickAccessButtonsRaf === null) {
        quickAccessButtonsRaf = requestAnimationFrame(() => {
            tryInject().catch((error) => {
                console.error(
                    "GitHub Assistant: Failed to ensure quick access buttons:",
                    error
                );
            });
        });
    }

    if (quickAccessButtonsObserver) {
        return;
    }

    quickAccessButtonsObserver = new MutationObserver(() => {
        const container = document.getElementById(
            "github-assistant-quick-access-container"
        );
        const topNavCenter = document.querySelector('[data-testid="top-nav-center"]');

        if (container && topNavCenter && topNavCenter.contains(container)) {
            return;
        }

        if (quickAccessButtonsRaf !== null) {
            return;
        }

        quickAccessButtonsRaf = requestAnimationFrame(() => {
            tryInject().catch((error) => {
                console.error(
                    "GitHub Assistant: Failed to re-ensure quick access buttons:",
                    error
                );
            });
        });
    });

    quickAccessButtonsObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
}

function isPackagesListPage() {
    const pathname = window.location.pathname;
    if (/^\/orgs\/[^/]+\/packages\/?$/i.test(pathname)) {
        return true;
    }

    if (/^\/users\/[^/]+\/packages\/?$/i.test(pathname)) {
        return true;
    }

    const query = new URLSearchParams(window.location.search);
    return query.get("tab") === "packages" && /^\/[^/]+\/?$/.test(pathname);
}

function parsePackageInfoFromLink(link) {
    if (!(link instanceof HTMLAnchorElement) || !link.href) {
        return null;
    }

    const url = new URL(link.href, window.location.origin);
    const path = url.pathname.replace(/\/+$/, "");

    const orgMatch = path.match(
        /^\/orgs\/([^/]+)\/packages\/([^/]+)\/(?:package\/)?([^/]+)(?:\/.*)?$/i
    );
    if (orgMatch) {
        const owner = decodeURIComponent(orgMatch[1]);
        const packageType = decodeURIComponent(orgMatch[2]).toLowerCase();
        const packageName = decodeURIComponent(orgMatch[3]);
        return {
            ownerScope: "orgs",
            owner,
            packageType,
            packageName,
            key: `orgs:${owner}:${packageType}:${packageName}`,
        };
    }

    const userScopeMatch = path.match(
        /^\/users\/([^/]+)\/packages\/([^/]+)\/(?:package\/)?([^/]+)(?:\/.*)?$/i
    );
    if (userScopeMatch) {
        const owner = decodeURIComponent(userScopeMatch[1]);
        const packageType = decodeURIComponent(userScopeMatch[2]).toLowerCase();
        const packageName = decodeURIComponent(userScopeMatch[3]);
        return {
            ownerScope: "users",
            owner,
            packageType,
            packageName,
            key: `users:${owner}:${packageType}:${packageName}`,
        };
    }

    const userMatch = path.match(
        /^\/([^/]+)\/packages\/([^/]+)\/(?:package\/)?([^/]+)(?:\/.*)?$/i
    );
    if (userMatch) {
        const excludedOwners = new Set([
            "new",
            "settings",
            "organizations",
            "enterprises",
            "team",
            "orgs",
            "marketplace",
            "explore",
            "topics",
            "trending",
            "collections",
            "events",
            "codespaces",
            "features",
            "sponsors",
            "about",
            "customer-stories",
            "dashboard",
            "pricing",
            "resources",
            "security",
            "users",
        ]);

        const owner = decodeURIComponent(userMatch[1]);
        if (excludedOwners.has(owner.toLowerCase())) {
            return null;
        }

        const packageType = decodeURIComponent(userMatch[2]).toLowerCase();
        const packageName = decodeURIComponent(userMatch[3]);
        return {
            ownerScope: "users",
            owner,
            packageType,
            packageName,
            key: `users:${owner}:${packageType}:${packageName}`,
        };
    }

    return null;
}

function applyPackageMetadataNodeLayout(node) {
    if (!node) {
        return;
    }

    node.style.cssText = `
        display: inline-flex;
        flex-wrap: nowrap;
        white-space: nowrap;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
        margin-left: 8px;
        margin-top: 0;
        width: auto;
        font-size: 12px;
        color: #57606a;
        vertical-align: middle;
        float: none;
    `;
}

function getPackageTypeCandidates(packageType) {
    const normalizedType = String(packageType || "").toLowerCase();
    if (!normalizedType) {
        return [];
    }

    if (normalizedType === "container") {
        return ["container", "docker"];
    }

    if (normalizedType === "docker") {
        return ["docker", "container"];
    }

    return [normalizedType];
}

function createPackageApiHeaders(githubToken, useBearer = false) {
    return {
        Accept: "application/vnd.github+json",
        Authorization: useBearer
            ? `Bearer ${githubToken}`
            : `token ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
    };
}

function isPackageMetadataAccessBlocked() {
    return (
        packageMetadataAccessBlockedUntil > Date.now() &&
        Boolean(packageMetadataAccessBlockedMessage)
    );
}

function blockPackageMetadataAccess(message) {
    packageMetadataAccessBlockedUntil =
        Date.now() + PACKAGE_METADATA_ACCESS_BACKOFF_MS;
    packageMetadataAccessBlockedMessage = message;
}

async function readGitHubApiErrorMessage(response) {
    try {
        const responseData = await response.json();
        if (
            responseData &&
            typeof responseData === "object" &&
            typeof responseData.message === "string"
        ) {
            return responseData.message.trim();
        }
    } catch {
        // Ignore JSON parse failures and fallback to status text.
    }

    return response.statusText || "";
}

async function fetchPackageMetadataApi(endpoint, githubToken) {
    const tokenResponse = await fetch(endpoint, {
        headers: createPackageApiHeaders(githubToken),
    });

    if (tokenResponse.status !== 401) {
        return tokenResponse;
    }

    return fetch(endpoint, {
        headers: createPackageApiHeaders(githubToken, true),
    });
}

function getPackageMetadataErrorMessage(errorText) {
    const normalizedError = String(errorText || "").toLowerCase();
    if (
        normalizedError.includes("read:packages") ||
        normalizedError.includes("forbidden") ||
        normalizedError.includes("(403)")
    ) {
        return "Token missing read:packages scope";
    }

    if (normalizedError.includes("rate limit")) {
        return "GitHub API rate limit exceeded";
    }

    if (
        normalizedError.includes("unauthorized") ||
        normalizedError.includes("bad credentials") ||
        normalizedError.includes("(401)")
    ) {
        return "Token is invalid or expired";
    }

    return "Package metadata unavailable";
}

function getPackageMetadataErrorTitle(errorText) {
    const normalizedError = String(errorText || "").toLowerCase();
    if (
        normalizedError.includes("read:packages") ||
        normalizedError.includes("forbidden") ||
        normalizedError.includes("(403)")
    ) {
        return "Update your token to include read:packages, then save it again in the extension popup.";
    }

    return "Unable to fetch package metadata from GitHub API.";
}

async function runWithConcurrencyLimit(items, maxConcurrency, worker) {
    const concurrency = Math.max(1, Math.floor(maxConcurrency || 1));
    let index = 0;

    const runners = new Array(Math.min(concurrency, items.length))
        .fill(null)
        .map(async () => {
            while (index < items.length) {
                const currentIndex = index++;
                await worker(items[currentIndex], currentIndex);
            }
        });

    await Promise.all(runners);
}

function extractLatestVersionTags(version) {
    if (!version || typeof version !== "object") {
        return [];
    }

    const containerTags =
        version.metadata &&
        version.metadata.container &&
        Array.isArray(version.metadata.container.tags)
            ? version.metadata.container.tags
            : [];

    const normalizedContainerTags = containerTags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean);

    if (normalizedContainerTags.length > 0) {
        return normalizedContainerTags;
    }

    const fallbackVersionName =
        typeof version.name === "string" ? version.name.trim() : "";
    return fallbackVersionName ? [fallbackVersionName] : [];
}

function formatRelativeTime(dateString) {
    const timestamp = Date.parse(dateString || "");
    if (Number.isNaN(timestamp)) {
        return "unknown";
    }

    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSeconds < 60) {
        return "just now";
    }

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
        return `${diffDays}d ago`;
    }

    return new Date(timestamp).toLocaleDateString();
}

function getPackageListEntryContainer(link) {
    return (
        link.closest(
            "li, article, div.Box-row, div[class*='Box-row'], div[data-testid='list-item']"
        ) || link.parentElement
    );
}

function parseUpdatedAtTimestamp(updatedAt) {
    const timestamp = Date.parse(String(updatedAt || ""));
    return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

function sortPackageListEntriesByUpdatedTime(packageTargets) {
    if (!Array.isArray(packageTargets) || packageTargets.length === 0) {
        return;
    }

    const groupedByParent = new Map();

    packageTargets.forEach((target) => {
        if (
            !target ||
            !target.listEntryContainer ||
            !target.parentContainer ||
            !target.parentContainer.contains(target.listEntryContainer)
        ) {
            return;
        }

        if (!groupedByParent.has(target.parentContainer)) {
            groupedByParent.set(target.parentContainer, []);
        }

        groupedByParent.get(target.parentContainer).push(target);
    });

    groupedByParent.forEach((targets, parentContainer) => {
        const sortedTargets = [...targets].sort((a, b) => {
            const aHasTimestamp = Number.isFinite(a.updatedAtTimestamp);
            const bHasTimestamp = Number.isFinite(b.updatedAtTimestamp);

            if (aHasTimestamp && bHasTimestamp) {
                if (a.updatedAtTimestamp !== b.updatedAtTimestamp) {
                    return b.updatedAtTimestamp - a.updatedAtTimestamp;
                }
            } else if (aHasTimestamp !== bHasTimestamp) {
                return aHasTimestamp ? -1 : 1;
            }

            return a.originalIndex - b.originalIndex;
        });

        sortedTargets.forEach((target) => {
            parentContainer.appendChild(target.listEntryContainer);
        });
    });
}

function findPackageDownloadsElement(container) {
    if (!container) {
        return null;
    }

    const semanticCandidate = container.querySelector(
        "[aria-label*='download' i], [title*='download' i], [data-testid*='download' i]"
    );
    if (semanticCandidate) {
        return semanticCandidate;
    }

    const iconCandidate = container.querySelector("svg.octicon-download");
    if (iconCandidate) {
        return iconCandidate.closest("span, div");
    }

    const countCandidate = container.querySelector(
        ".tmp-ml-3.no-wrap.flex-self-center span, .tmp-ml-3.no-wrap span, .no-wrap.flex-self-center span"
    );
    if (countCandidate) {
        return countCandidate;
    }

    const textCandidates = container.querySelectorAll(
        "span, div, li, p, strong, small"
    );
    for (const element of textCandidates) {
        const textContent = String(element.textContent || "")
            .trim()
            .toLowerCase();
        if (textContent.includes("download")) {
            return element;
        }
    }

    return null;
}

function normalizeDockerPathValue(value) {
    return String(value || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

function buildDockerPullCommand(packageInfo, tag) {
    if (!packageInfo || !tag) {
        return "";
    }

    const packageType = String(packageInfo.packageType || "").toLowerCase();
    if (packageType !== "container" && packageType !== "docker") {
        return "";
    }

    const owner = normalizeDockerPathValue(packageInfo.owner);
    const packageName = normalizeDockerPathValue(packageInfo.packageName);
    const versionTag = String(tag).trim();
    if (!owner || !packageName || !versionTag) {
        return "";
    }

    const scopedName = packageName.startsWith(`${owner}/`)
        ? packageName
        : `${owner}/${packageName}`;
    return `docker pull ghcr.io/${scopedName}:${versionTag}`;
}

function getOrCreatePackageMetadataNode(link, packageKey) {
    const container = getPackageListEntryContainer(link);
    if (!container) {
        return null;
    }

    const existingNode = Array.from(
        container.querySelectorAll(`.${PACKAGE_METADATA_CLASS}`)
    ).find((node) => node.dataset.packageKey === packageKey);

    if (existingNode) {
        applyPackageMetadataNodeLayout(existingNode);
        return existingNode;
    }

    const metadataNode = document.createElement("div");
    metadataNode.className = PACKAGE_METADATA_CLASS;
    metadataNode.dataset.packageKey = packageKey;
    applyPackageMetadataNodeLayout(metadataNode);

    const rightColumn = container.querySelector(
        ".tmp-ml-3.no-wrap.flex-self-center, .tmp-ml-3.no-wrap, .no-wrap.flex-self-center"
    );
    if (rightColumn) {
        const rightColumnDisplay = window.getComputedStyle(rightColumn).display;
        if (!rightColumnDisplay.includes("flex")) {
            rightColumn.style.display = "flex";
        }
        rightColumn.style.alignItems = "center";
        rightColumn.style.flexWrap = "nowrap";
        rightColumn.style.whiteSpace = "nowrap";
        rightColumn.style.gap = "8px";
        rightColumn.appendChild(metadataNode);
        return metadataNode;
    }

    const downloadsElement = findPackageDownloadsElement(container);
    if (downloadsElement && downloadsElement.parentElement) {
        const downloadsParent = downloadsElement.parentElement;
        const parentDisplay = window.getComputedStyle(downloadsParent).display;

        if (parentDisplay.includes("flex")) {
            downloadsParent.appendChild(metadataNode);
        } else {
            downloadsElement.insertAdjacentElement("afterend", metadataNode);
        }
        return metadataNode;
    }

    const heading = link.closest("h1, h2, h3, h4");
    if (heading && container.contains(heading)) {
        heading.insertAdjacentElement("afterend", metadataNode);
    } else {
        link.insertAdjacentElement("afterend", metadataNode);
    }

    return metadataNode;
}

function renderPackageMetadata(node, metadata, packageInfo) {
    if (!node) {
        return;
    }

    node.dataset.renderState = "ready";
    node.textContent = "";

    const updatedAt = metadata.updatedAt ? String(metadata.updatedAt) : "";
    const updatedAtTimestamp = parseUpdatedAtTimestamp(updatedAt);
    node.dataset.updatedAtTimestamp = Number.isFinite(updatedAtTimestamp)
        ? String(updatedAtTimestamp)
        : "";
    const updatedLabel = document.createElement("span");
    updatedLabel.textContent = `Updated ${formatRelativeTime(updatedAt)}`;
    updatedLabel.style.cssText = `
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid #54aeff;
        background: #ddf4ff;
        color: #0969da;
        font-weight: 600;
        font-size: 11px;
    `;
    if (updatedAt) {
        updatedLabel.title = new Date(updatedAt).toLocaleString();
    }
    node.appendChild(updatedLabel);

    const latestLabel = document.createElement("span");
    latestLabel.textContent = "Latest";
    latestLabel.style.cssText = `
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid #d4a5db;
        background: #fbefff;
        color: #8250df;
        font-weight: 600;
        font-size: 11px;
    `;
    node.appendChild(latestLabel);

    const tagsToShow =
        Array.isArray(metadata.latestTags) && metadata.latestTags.length > 0
            ? metadata.latestTags
            : ["unavailable"];
    const maxVisibleTags = 3;

    tagsToShow.slice(0, maxVisibleTags).forEach((tag) => {
        const tagNode = document.createElement("button");
        tagNode.type = "button";
        tagNode.textContent = tag;
        tagNode.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 10px;
            min-height: 22px;
            border: 1px solid #4ac26b;
            border-radius: 999px;
            background: #dcffe4;
            color: #116329;
            font-weight: 700;
            font-size: 11px;
            line-height: 18px;
            cursor: pointer;
            transition: all 0.15s ease;
        `;
        const dockerPullCommand = buildDockerPullCommand(packageInfo, tag);
        if (dockerPullCommand) {
            tagNode.title = `Copy command: ${dockerPullCommand}`;
            tagNode.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();

                const originalText = tagNode.textContent;
                const originalBackground = tagNode.style.background;
                const originalBorderColor = tagNode.style.borderColor;
                const originalColor = tagNode.style.color;

                try {
                    await navigator.clipboard.writeText(dockerPullCommand);
                    tagNode.textContent = "Copied";
                    tagNode.style.background = "#0969da";
                    tagNode.style.borderColor = "#0969da";
                    tagNode.style.color = "#ffffff";
                } catch (error) {
                    tagNode.textContent = "Failed";
                    tagNode.style.background = "#cf222e";
                    tagNode.style.borderColor = "#cf222e";
                    tagNode.style.color = "#ffffff";
                }

                setTimeout(() => {
                    tagNode.textContent = originalText;
                    tagNode.style.background = originalBackground;
                    tagNode.style.borderColor = originalBorderColor;
                    tagNode.style.color = originalColor;
                }, 1400);
            });
        } else {
            tagNode.disabled = true;
            tagNode.style.cursor = "default";
            tagNode.style.opacity = "0.8";
            tagNode.title = "No docker pull command available for this package type";
        }
        node.appendChild(tagNode);
    });

    if (tagsToShow.length > maxVisibleTags) {
        const moreNode = document.createElement("span");
        moreNode.textContent = `+${tagsToShow.length - maxVisibleTags}`;
        moreNode.style.fontSize = "11px";
        moreNode.style.color = "#57606a";
        node.appendChild(moreNode);
    }
}

function renderPackageMetadataError(
    node,
    message = "Package metadata unavailable"
) {
    if (!node) {
        return;
    }

    node.dataset.renderState = "error";
    delete node.dataset.updatedAtTimestamp;
    node.textContent = message;
    node.style.fontSize = "12px";
}

async function fetchLatestPackageMetadataFromApi(packageInfo, githubToken) {
    if (isPackageMetadataAccessBlocked()) {
        throw new Error(packageMetadataAccessBlockedMessage);
    }
    const packageTypes = getPackageTypeCandidates(packageInfo.packageType);
    let lastStatus = null;
    let lastApiMessage = "";

    for (const packageType of packageTypes) {
        const endpoint =
            `https://api.github.com/${packageInfo.ownerScope}/` +
            `${encodeURIComponent(packageInfo.owner)}/packages/` +
            `${encodeURIComponent(packageType)}/` +
            `${encodeURIComponent(packageInfo.packageName)}/versions?per_page=1`;
        const response = await fetchPackageMetadataApi(endpoint, githubToken);

        if (response.ok) {
            const versions = await response.json();
            const latestVersion = Array.isArray(versions) ? versions[0] : null;
            return {
                updatedAt:
                    latestVersion &&
                    (latestVersion.updated_at || latestVersion.created_at),
                latestTags: extractLatestVersionTags(latestVersion),
            };
        }

        lastStatus = response.status;
        lastApiMessage = await readGitHubApiErrorMessage(response);

        if (response.status === 403) {
            const message = String(lastApiMessage || "").toLowerCase().includes(
                "rate limit"
            )
                ? "GitHub API rate limit exceeded (403)"
                : "GitHub package API forbidden (403). Token likely needs read:packages.";
            blockPackageMetadataAccess(message);
            throw new Error(message);
        }

        if (response.status === 401) {
            throw new Error(
                "GitHub package API unauthorized (401). Token may be invalid or expired."
            );
        }
        if (response.status !== 404) {
            break;
        }
    }

    throw new Error(
        `GitHub packages API request failed${
            lastStatus ? ` (${lastStatus})` : ""
        }${lastApiMessage ? `: ${lastApiMessage}` : ""}`
    );
}

async function getPackageMetadata(packageInfo) {
    if (isPackageMetadataAccessBlocked()) {
        return {
            fetchedAt: Date.now(),
            data: null,
            error: packageMetadataAccessBlockedMessage,
        };
    }
    const cachedEntry = packageMetadataCache.get(packageInfo.key);
    if (
        cachedEntry &&
        Date.now() - cachedEntry.fetchedAt < PACKAGE_METADATA_CACHE_TTL_MS
    ) {
        return cachedEntry;
    }

    if (packageMetadataRequests.has(packageInfo.key)) {
        return packageMetadataRequests.get(packageInfo.key);
    }

    const request = fetchLatestPackageMetadataFromApi(
        packageInfo,
        cachedGithubToken
    )
        .then((data) => {
            const entry = {
                fetchedAt: Date.now(),
                data,
                error: null,
            };
            packageMetadataCache.set(packageInfo.key, entry);
            packageMetadataRequests.delete(packageInfo.key);
            return entry;
        })
        .catch((error) => {
            const entry = {
                fetchedAt: Date.now(),
                data: null,
                error: error.message || "Failed to fetch package metadata",
            };
            packageMetadataCache.set(packageInfo.key, entry);
            packageMetadataRequests.delete(packageInfo.key);
            return entry;
        });

    packageMetadataRequests.set(packageInfo.key, request);
    return request;
}

async function enhancePackagesListPageMetadata() {
    if (!isPackagesListPage()) {
        return;
    }

    if (cachedGithubToken === null) {
        await loadGithubTokenCache();
    }

    if (!cachedGithubToken) {
        return;
    }

    const packageLinks = Array.from(document.querySelectorAll('a[href*="/packages/"]'));
    if (packageLinks.length === 0) {
        return;
    }
    const packageTargets = [];
    const seenContainers = new Set();

    packageLinks.forEach((link, index) => {
        const packageInfo = parsePackageInfoFromLink(link);
        if (!packageInfo) {
            return;
        }

        const listEntryContainer = getPackageListEntryContainer(link);
        const parentContainer = listEntryContainer?.parentElement || null;

        if (!listEntryContainer || !parentContainer || seenContainers.has(listEntryContainer)) {
            return;
        }

        seenContainers.add(listEntryContainer);
        packageTargets.push({
            link,
            packageInfo,
            listEntryContainer,
            parentContainer,
            originalIndex: index,
            updatedAtTimestamp: Number.NaN,
        });
    });

    if (packageTargets.length === 0) {
        return;
    }

    await runWithConcurrencyLimit(packageTargets, 4, async (target) => {
        const metadataNode = getOrCreatePackageMetadataNode(
            target.link,
            target.packageInfo.key
        );
        if (!metadataNode) {
            return;
        }

        if (metadataNode.dataset.renderState === "ready") {
            const existingTimestamp = Number.parseInt(
                metadataNode.dataset.updatedAtTimestamp || "",
                10
            );
            if (Number.isFinite(existingTimestamp)) {
                target.updatedAtTimestamp = existingTimestamp;
            }
            return;
        }

        if (metadataNode.dataset.renderState !== "loading") {
            metadataNode.dataset.renderState = "loading";
            delete metadataNode.dataset.updatedAtTimestamp;
            metadataNode.textContent = "Loading package metadata...";
        }

        const metadataEntry = await getPackageMetadata(target.packageInfo);
        if (metadataEntry.error || !metadataEntry.data) {
            const errorMessage = getPackageMetadataErrorMessage(metadataEntry.error);
            metadataNode.title = getPackageMetadataErrorTitle(metadataEntry.error);
            renderPackageMetadataError(metadataNode, errorMessage);
            return;
        }

        target.updatedAtTimestamp = parseUpdatedAtTimestamp(
            metadataEntry.data.updatedAt
        );
        renderPackageMetadata(metadataNode, metadataEntry.data, target.packageInfo);
    });

    sortPackageListEntriesByUpdatedTime(packageTargets);
}

function schedulePackagesListEnhancement() {
    if (!isPackagesListPage()) {
        return;
    }

    if (packageMetadataRaf !== null) {
        return;
    }

    packageMetadataRaf = requestAnimationFrame(() => {
        packageMetadataRaf = null;
        enhancePackagesListPageMetadata().catch((error) => {
            console.error(
                "GitHub Assistant: Failed to enhance packages list page:",
                error
            );
        });
    });
}

async function init() {
    // Inject quick access buttons on all GitHub pages (except raw)
    await injectQuickAccessButtons();
    schedulePackagesListEnhancement();

    const parsedUrl = parseGitHubUrl(location.href);
    if (!parsedUrl) {
        console.log("GitHub Assistant: Could not parse GitHub URL");
        return;
    }

    const { owner, repo } = parsedUrl;

    // Load settings cache if not loaded
    if (cachedSettings === null) {
        await loadSettingsCache();
    }

    // Use cached GitHub token if available, otherwise load from storage
    if (cachedGithubToken === null) {
        await loadGithubTokenCache();
    }

    const githubToken = cachedGithubToken;
    if (!githubToken) {
        console.log("GitHub Assistant: No GitHub token found");
        return;
    }

    try {
        // Fetch user info and repo data in parallel for faster loading
        const [userResp, repoResp] = await Promise.all([
            fetch("https://api.github.com/user", {
                headers: {
                    Accept: "application/vnd.github.v3+json",
                    Authorization: `token ${githubToken}`,
                },
            }),
            fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: {
                    Accept: "application/vnd.github.v3+json",
                    Authorization: `token ${githubToken}`,
                },
            }),
        ]);

        if (!userResp.ok || !repoResp.ok) {
            console.log(
                `GitHub Assistant: API request failed (user: ${userResp.status}, repo: ${repoResp.status})`,
            );
            return;
        }

        const [userData, repoData] = await Promise.all([
            userResp.json(),
            repoResp.json(),
        ]);

        const currentUser = userData.login;

        // Check if current repo is a fork and show "Back to Upstream" button
        if (
            cachedSettings.showForkUpstreamButtons &&
            repoData.fork &&
            repoData.parent
        ) {
            const upstreamUrl = repoData.parent.html_url;
            const upstreamFullName = repoData.parent.full_name;
            addUpstreamButton(upstreamUrl, upstreamFullName);
        }

        // Determine the upstream/source repository for finding user's forks
        let sourceOwner = owner;
        let sourceRepo = repo;

        if (repoData.fork && repoData.source) {
            sourceOwner = repoData.source.owner.login;
            sourceRepo = repoData.source.name;
        }

        // Only show "GitHub Assistant" and import buttons if we're NOT on our own repo
        if (owner !== currentUser) {
            // Find all forks owned by the user
            if (cachedSettings.showForkUpstreamButtons) {
                const forks = await findAllForks(
                    currentUser,
                    sourceOwner,
                    sourceRepo,
                    githubToken,
                );

                if (forks.length > 0) {
                    addForkButton(forks);
                }
            }

            // Show import button for repos not owned by user
            if (cachedSettings.showImportButton) {
                console.log(
                    `GitHub Assistant: Showing import button for ${owner}/${repo}`,
                );
                addImportButton(
                    owner,
                    repo,
                    repoData,
                    currentUser,
                    githubToken,
                );
            }
        } else {
            console.log(
                `GitHub Assistant: Skipping import button (own repo: ${owner}/${repo})`,
            );
        }
    } catch (error) {
        console.error("GitHub Assistant: Error in init():", error);
    }
}

function parseGitHubUrl(url) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return null;

    const owner = match[1];
    const repo = match[2].replace(/[?#].*$/, ""); // Remove query params and hash

    // Exclude special GitHub pages (not actual repositories)
    const excludedOwners = [
        "new",
        "settings",
        "organizations",
        "enterprises",
        "team",
        "orgs",
        "marketplace",
        "explore",
        "topics",
        "trending",
        "collections",
        "events",
        "codespaces",
        "features",
        "sponsors",
        "about",
        "customer-stories",
        "pricing",
        "resources",
        "security",
    ];
    if (excludedOwners.includes(owner.toLowerCase())) {
        return null;
    }

    return {
        owner: owner,
        repo: repo,
    };
}

// Auto-fill import form if we're on the import page
function autofillImportForm() {
    // Check if we're on the import page
    if (!location.pathname.includes("/new/import")) return;

    // Get stored import data
    const importDataStr = sessionStorage.getItem("gh_import_data");
    if (!importDataStr) {
        console.log("GitHub Assistant: No import data found in sessionStorage");
        return;
    }

    const importData = JSON.parse(importDataStr);

    // Check if data is recent (within 30 seconds)
    if (Date.now() - importData.timestamp > 30000) {
        console.log("GitHub Assistant: Import data expired");
        sessionStorage.removeItem("gh_import_data");
        return;
    }

    console.log(
        "GitHub Assistant: Auto-filling import form with data:",
        importData,
    );

    // Add a helpful banner
    const addBanner = () => {
        if (document.getElementById("import-autofill-banner")) return;

        const banner = document.createElement("div");
        banner.id = "import-autofill-banner";
        banner.style.cssText = `
            background: linear-gradient(135deg, #6639ba 0%, #7c52cc 100%);
            color: white;
            padding: 20px 24px;
            border-radius: 8px;
            margin: 24px auto;
            margin-bottom: 300px;
            max-width: 900px;
            font-size: 16px;
            font-weight: 500;
            display: flex;
            align-items: flex-start;
            gap: 16px;
            border: 2px solid #8b5cf6;
            box-shadow: 0 4px 12px rgba(102, 57, 186, 0.3);
        `;

        banner.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink: 0; margin-top: 2px;">
                <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path>
            </svg>
            <div style="flex: 1;">
                <div style="font-size: 15px; line-height: 1.6; margin-bottom: ${
                    importData.private ? "12px" : "0"
                };">
                    Please set the repository owner, name and visibility<br/>
                </div>
                ${
                    importData.private
                        ? '<div style="font-size: 17px; line-height: 1.5; background: rgba(255, 215, 0, 0.15); padding: 10px 12px; border-radius: 6px; border-left: 3px solid #ffd700;"><strong style="color: #ffd700;">⚠️ PRIVATE REPOSITORY AHEAD:</strong> You must enter your GitHub username and Personal Access Token below to import this private repository!</div>'
                        : ""
                }
            </div>
        `;

        // Find the button container and insert banner right after it
        const buttonContainer =
            document.querySelector(
                '[data-direction="horizontal"][data-justify="end"]',
            ) ||
            document
                .querySelector('button[type="submit"]')
                ?.closest('[data-direction="horizontal"]');

        if (buttonContainer) {
            // Insert right after the button container
            buttonContainer.parentNode.insertBefore(
                banner,
                buttonContainer.nextSibling,
            );
        } else {
            // Fallback: append to content area
            const contentArea =
                document.querySelector("main") ||
                document.querySelector('[role="main"]') ||
                document.querySelector(".application-main") ||
                document.querySelector("body");

            if (contentArea) {
                contentArea.appendChild(banner);
            } else {
                document.body.appendChild(banner);
            }
        }

        // Copy URL to clipboard
        navigator.clipboard.writeText(importData.url).catch(() => {});
    };

    // Show banner immediately
    addBanner();

    // Wait for form to load and fill it
    const fillForm = () => {
        let filled = false;

        // Find all input fields for debugging
        const allInputs = document.querySelectorAll(
            'input[type="text"], input[type="url"], input:not([type])',
        );
        console.log(
            "GitHub Assistant: Found input fields:",
            Array.from(allInputs).map((i) => ({
                name: i.name,
                id: i.id,
                type: i.type,
                placeholder: i.placeholder,
            })),
        );

        // Fill the clone URL field - try multiple selectors
        const urlInput =
            document.querySelector('input[name="vcs_url"]') ||
            document.querySelector("input#vcs_url") ||
            document.querySelector('input[name="import_url"]') ||
            document.querySelector('input[type="url"]') ||
            document.querySelector('input[placeholder*="Clone URL"]') ||
            document.querySelector('input[placeholder*="repository"]') ||
            document.querySelector('input[placeholder*="https://"]') ||
            Array.from(allInputs).find((input) => {
                const label = input.labels?.[0]?.textContent || "";
                const placeholder = input.placeholder || "";
                const ariaLabel = input.getAttribute("aria-label") || "";
                return (
                    label.toLowerCase().includes("url") ||
                    label.toLowerCase().includes("clone") ||
                    placeholder.toLowerCase().includes("url") ||
                    ariaLabel.toLowerCase().includes("url")
                );
            });

        if (urlInput) {
            console.log("GitHub Assistant: Found URL input:", urlInput);
            // Use native setter to bypass React
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            ).set;
            nativeInputValueSetter.call(urlInput, importData.url);

            urlInput.dispatchEvent(new Event("input", { bubbles: true }));
            urlInput.dispatchEvent(new Event("change", { bubbles: true }));
            urlInput.dispatchEvent(new Event("blur", { bubbles: true }));
            urlInput.focus();
            filled = true;
        } else {
            console.log("GitHub Assistant: URL input not found");
        }

        // Fill repository name
        const nameInput =
            document.querySelector('input[name="repository_name"]') ||
            document.querySelector("input#repository_name") ||
            document.querySelector('input[name="name"]');

        if (nameInput) {
            console.log("GitHub Assistant: Found name input:", nameInput);
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            ).set;
            nativeInputValueSetter.call(nameInput, importData.name);

            nameInput.dispatchEvent(new Event("input", { bubbles: true }));
            nameInput.dispatchEvent(new Event("change", { bubbles: true }));
            nameInput.dispatchEvent(new Event("blur", { bubbles: true }));
            filled = true;
        } else {
            console.log("GitHub Assistant: Name input not found");
        }

        // Fill credentials for private repos
        if (importData.private) {
            const usernameInput =
                document.querySelector('input[name="vcs_username"]') ||
                document.querySelector("input#vcs_username") ||
                document.querySelector('input[placeholder*="username"]');

            if (usernameInput) {
                console.log("GitHub Assistant: Found username input");
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value",
                ).set;
                nativeInputValueSetter.call(usernameInput, importData.username);
                usernameInput.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                usernameInput.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                usernameInput.dispatchEvent(
                    new Event("blur", { bubbles: true }),
                );
            }

            const passwordInput =
                document.querySelector('input[name="vcs_password"]') ||
                document.querySelector("input#vcs_password") ||
                document.querySelector('input[type="password"]');

            if (passwordInput) {
                console.log("GitHub Assistant: Found password input");
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value",
                ).set;
                nativeInputValueSetter.call(passwordInput, importData.token);
                passwordInput.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                passwordInput.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                passwordInput.dispatchEvent(
                    new Event("blur", { bubbles: true }),
                );
            }
        }

        if (filled) {
            console.log("GitHub Assistant: Form filled successfully");
            // Clear after successful fill
            sessionStorage.removeItem("gh_import_data");
            return true;
        }
        return false;
    };

    // Try to fill immediately
    if (fillForm()) return;

    // Try again after delays
    setTimeout(() => fillForm(), 300);
    setTimeout(() => fillForm(), 800);
    setTimeout(() => fillForm(), 1500);
    setTimeout(() => fillForm(), 3000);

    // Also watch for DOM changes
    const observer = new MutationObserver(() => {
        if (fillForm()) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Stop observing after 5 seconds
    setTimeout(() => observer.disconnect(), 5000);
}

// Initialize on page load
// ===== COMMIT / PR DIFF+PATCH BUTTONS =====

/**
 * Parse a GitHub commit page URL.
 * Matches: github.com/owner/repo/commit/SHA (with optional sub-path/query/hash)
 * Returns { owner, repo, sha, baseUrl } or null.
 */
function parseCommitPageUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== "github.com") return null;
        const match = parsed.pathname.match(
            /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{4,40})(?:\/.*)?$/i
        );
        if (!match) return null;
        return {
            owner: match[1],
            repo: match[2],
            sha: match[3],
            baseUrl: `https://github.com/${match[1]}/${match[2]}/commit/${match[3]}`,
        };
    } catch {
        return null;
    }
}

/**
 * Parse a GitHub PR page URL.
 * Matches: github.com/owner/repo/pull/NUMBER (with optional sub-path/query/hash)
 * Returns { owner, repo, number, baseUrl } or null.
 */
function parsePRPageUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== "github.com") return null;
        const match = parsed.pathname.match(
            /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/
        );
        if (!match) return null;
        return {
            owner: match[1],
            repo: match[2],
            number: match[3],
            baseUrl: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
        };
    } catch {
        return null;
    }
}

// Attribute used to mark commit links that already have shortcuts injected
const COMMIT_SHORTCUT_ATTR = "data-gh-assistant-commit-shortcuts";
// Class used on the injected <span> wrappers so we can remove them on navigation
const COMMIT_SHORTCUT_CLASS = "gh-assistant-commit-shortcuts";

let fileTreeCommitLinksRaf = null;

/**
 * Returns true when we are on a repo landing page or file-tree page —
 * i.e. somewhere commit messages from the file browser are visible.
 * Excludes commit detail, PR, blob, issues, and other sub-pages.
 */
function isRepoFileTreePage() {
    if (parseCommitPageUrl(location.href)) return false;
    if (parsePRPageUrl(location.href)) return false;
    // Allow /owner/repo  and  /owner/repo/tree/...  only
    return /^\/[^/]+\/[^/]+(?:\/tree(?:\/.*)?)?$/.test(location.pathname);
}

/**
 * Append inline ".diff" (amber) and ".patch" (blue) text links immediately
 * after every commit-message anchor in the file browser and latest-commit row.
 */
async function injectFileTreeCommitLinks() {
    if (cachedSettings === null) await loadSettingsCache();
    if (!cachedSettings.showCommitPRButtons) return;
    if (!isRepoFileTreePage()) return;

    const links = document.querySelectorAll(
        `a[href*="/commit/"]:not([${COMMIT_SHORTCUT_ATTR}])`
    );

    links.forEach((link) => {
        const rawHref = link.getAttribute("href") || "";
        // Strip query params / hash before testing (latest-commit row sometimes has ?short_path=…)
        const href = rawHref.split("?")[0].split("#")[0];
        // Capture owner/repo/SHA; allow optional sub-paths after the SHA
        const m = href.match(/^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{4,40})(?:\/.*)?$/i);
        if (!m) return;
        // Skip the short-SHA badge links (text is just a hex string)
        if (/^[0-9a-f]{4,40}$/i.test(link.textContent.trim())) return;

        link.setAttribute(COMMIT_SHORTCUT_ATTR, "1");

        // Always use the clean /owner/repo/commit/SHA base regardless of sub-paths
        const baseUrl = `https://github.com/${m[1]}/${m[2]}/commit/${m[3]}`;
        const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace";
        const BASE_STYLE = `font-size:12px;font-weight:500;font-family:${MONO};text-decoration:none;`;

        function makeLink(text, url, color, title) {
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = text;
            a.title = title;
            a.style.cssText = `${BASE_STYLE}color:${color};margin-left:5px;`;
            a.addEventListener("mouseenter", () => { a.style.textDecoration = "underline"; });
            a.addEventListener("mouseleave", () => { a.style.textDecoration = "none"; });
            return a;
        }

        const wrap = document.createElement("span");
        wrap.className = COMMIT_SHORTCUT_CLASS;
        wrap.style.whiteSpace = "nowrap";
        wrap.appendChild(makeLink(".diff",  baseUrl + ".diff",  "#a16207", "View as plain-text diff"));
        wrap.appendChild(makeLink(".patch", baseUrl + ".patch", "#0969da", "Download as email-format patch"));

        if (!link.parentNode) return;
        link.insertAdjacentElement("afterend", wrap);
    });
}

function scheduleFileTreeCommitLinks() {
    if (fileTreeCommitLinksRaf !== null) return;
    fileTreeCommitLinksRaf = requestAnimationFrame(() => {
        fileTreeCommitLinksRaf = null;
        injectFileTreeCommitLinks().catch((err) => {
            console.error("GitHub Assistant: injectFileTreeCommitLinks error:", err);
        });
    });
}

// ===== END COMMIT / PR DIFF+PATCH BUTTONS =====

// ===== COMMIT METADATA PANEL =====

const COMMIT_META_ID = "gh-assistant-commit-meta";
let commitMetaBtnRaf = null;

/** Remove the modal panel and its backdrop. */
function removeCommitMetaUI() {
    document.getElementById(`${COMMIT_META_ID}-panel`)?.remove();
    document.getElementById(`${COMMIT_META_ID}-overlay`)?.remove();
}

function scheduleCommitMetaButton() {
    if (commitMetaBtnRaf !== null) return;
    commitMetaBtnRaf = requestAnimationFrame(() => {
        commitMetaBtnRaf = null;
        injectCommitMetaButton().catch((err) =>
            console.error("GitHub Assistant: injectCommitMetaButton error:", err)
        );
    });
}

/**
 * Inject an inline "sig" text link on commit pages.
 * Anchors to the clipboard-copy element for the commit SHA, which is always present.
 */
async function injectCommitMetaButton() {
    if (cachedSettings === null) await loadSettingsCache();
    if (!cachedSettings.showCommitPRButtons) return;

    const commitInfo = parseCommitPageUrl(location.href);
    if (!commitInfo) return;
    if (document.getElementById(`${COMMIT_META_ID}-btn`)) return;

    const { sha } = commitInfo;
    // clipboard-copy for the SHA is the most stable anchor; fall back to time elements
    const anchor =
        document.querySelector(`clipboard-copy[value="${sha}"]`) ||
        document.querySelector(`clipboard-copy[value="${sha.slice(0, 7)}"]`) ||
        document.querySelector("relative-time, time-ago");
    if (!anchor) return;

    const btn = document.createElement("a");
    btn.id = `${COMMIT_META_ID}-btn`;
    btn.href = "#";
    btn.textContent = "sig";
    btn.title = "Show author / committer email and signature details";
    btn.style.cssText =
        "font-size:12px;font-weight:500;" +
        "font-family:ui-monospace,SFMono-Regular,'SF Mono',Consolas,'Liberation Mono',Menlo,monospace;" +
        "color:#6e7781;text-decoration:none;cursor:pointer;margin-left:8px;vertical-align:middle;";
    btn.addEventListener("mouseenter", () => { btn.style.textDecoration = "underline"; });
    btn.addEventListener("mouseleave", () => { btn.style.textDecoration = "none"; });
    btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await showCommitMetaPanel(commitInfo);
    });

    anchor.insertAdjacentElement("afterend", btn);
}

/**
 * Fetch commit details from the GitHub API and show them in a modal.
 * Displays: author email, committer email, verification status/reason,
 * signature type (PGP/GPG or SSH), and the raw signature in a collapsible block.
 */
async function showCommitMetaPanel({ owner, repo, sha }) {
    removeCommitMetaUI();

    // Backdrop
    const overlay = document.createElement("div");
    overlay.id = `${COMMIT_META_ID}-overlay`;
    overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,0.32);z-index:9998;";
    overlay.addEventListener("click", removeCommitMetaUI);
    document.body.appendChild(overlay);

    // Panel shell
    const panel = document.createElement("div");
    panel.id = `${COMMIT_META_ID}-panel`;
    panel.style.cssText =
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
        "background:#fff;border:1px solid #d0d7de;border-radius:10px;" +
        "padding:20px 24px;z-index:9999;max-width:580px;width:90vw;" +
        "box-shadow:0 8px 24px rgba(140,149,159,0.25);" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;" +
        "font-size:13px;color:#24292f;overflow-y:auto;max-height:80vh;";
    panel.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">` +
            `<span style="font-weight:600;font-size:14px;">Commit Details</span>` +
            `<button id="${COMMIT_META_ID}-close" style="background:none;border:none;cursor:pointer;` +
                `font-size:20px;color:#57606a;padding:0;line-height:1;">&#x2715;</button>` +
        `</div>` +
        `<div id="${COMMIT_META_ID}-body"><span style="color:#57606a;font-size:12px;">Loading…</span></div>`;
    document.body.appendChild(panel);

    document.getElementById(`${COMMIT_META_ID}-close`).addEventListener("click", removeCommitMetaUI);
    // Close on Escape
    const onKeydown = (e) => {
        if (e.key === "Escape") { removeCommitMetaUI(); document.removeEventListener("keydown", onKeydown); }
    };
    document.addEventListener("keydown", onKeydown);

    const esc = (s = "") =>
        String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    try {
        const headers = { Accept: "application/vnd.github.v3+json" };
        if (cachedGithubToken) headers.Authorization = `token ${cachedGithubToken}`;

        const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
            { headers }
        );
        if (!resp.ok) {
            throw new Error(`GitHub API ${resp.status} — ${await resp.text().catch(() => resp.statusText)}`);
        }
        const data = await resp.json();
        const { author, committer, verification } = data.commit;
        const v = verification ?? {};

        // Detect PGP vs SSH signature
        let sigType = null;
        if (v.signature) {
            if (v.signature.startsWith("-----BEGIN PGP"))      sigType = "PGP / GPG";
            else if (v.signature.startsWith("-----BEGIN SSH")) sigType = "SSH";
            else                                                sigType = "unknown";
        }

        const MONO = "font-family:ui-monospace,SFMono-Regular,'SF Mono',Consolas,monospace;";
        const ROW  = "display:grid;grid-template-columns:110px 1fr;gap:8px;padding:7px 0;" +
                     "border-bottom:1px solid #f0f3f6;align-items:start;";
        const LBL  = "font-size:11px;font-weight:600;text-transform:uppercase;" +
                     "letter-spacing:.4px;color:#57606a;padding-top:1px;";
        const VAL  = `${MONO}font-size:12px;color:#24292f;word-break:break-all;`;

        const row = (label, value) =>
            `<div style="${ROW}"><span style="${LBL}">${label}</span><span style="${VAL}">${value}</span></div>`;

        let html = row("Author",
            `${esc(author.name)} <span style="color:#57606a;">&lt;${esc(author.email)}&gt;</span>`);
        html += row("Author date", esc(author.date));

        // Only show committer block when it differs from author
        if (committer.name !== author.name || committer.email !== author.email) {
            html += row("Committer",
                `${esc(committer.name)} <span style="color:#57606a;">&lt;${esc(committer.email)}&gt;</span>`);
            html += row("Committer date", esc(committer.date));
        }

        const vColor = v.verified ? "#1a7f37" : "#cf222e";
        const vIcon  = v.verified ? "✓" : "✗";
        html += row("Verified",
            `<span style="color:${vColor};font-weight:600;">${vIcon}</span>&nbsp;${esc(v.reason) || "no signature"}`);

        if (sigType) html += row("Sig type", sigType);

        if (v.signature) {
            html +=
                `<div style="margin-top:12px;">` +
                    `<details>` +
                        `<summary style="cursor:pointer;font-size:11px;font-weight:600;color:#57606a;` +
                            `text-transform:uppercase;letter-spacing:.4px;user-select:none;">` +
                            `▶ Raw signature` +
                        `</summary>` +
                        `<pre style="margin:8px 0 0;background:#f6f8fa;padding:10px 12px;` +
                            `border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap;` +
                            `word-break:break-all;max-height:240px;overflow-y:auto;` +
                            `color:#24292f;border:1px solid #d0d7de;">${esc(v.signature)}</pre>` +
                    `</details>` +
                `</div>`;
        }

        document.getElementById(`${COMMIT_META_ID}-body`).innerHTML = html;
    } catch (err) {
        document.getElementById(`${COMMIT_META_ID}-body`).innerHTML =
            `<span style="color:#cf222e;font-size:12px;">Error: ${esc(err.message)}</span>`;
    }
}

// ===== END COMMIT METADATA PANEL =====

// ===== RAW PAGE HANDLERS =====

/**
 * Parse gist raw URL and return the gist page URL with file anchor
 * Example: https://gist.githubusercontent.com/erbanku/cd468880461ddcce95e44da10b921262/raw/51ddada9e85be5b27426bcac66e80dab01815541/dify_workflows_export_EN.js
 * Returns: https://gist.github.com/erbanku/cd468880461ddcce95e44da10b921262#file-dify_workflows_export_en-js
 */
function parseGistRawUrl(url) {
    try {
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
        const isGistRawHost = parsedUrl.hostname === "gist.githubusercontent.com";
        const isGistRawPath =
            parsedUrl.hostname === "gist.github.com" &&
            pathSegments[2] === "raw";

        if (!isGistRawHost && !isGistRawPath) {
            return null;
        }

        if (pathSegments.length < 4 || pathSegments[2] !== "raw") {
            return null;
        }

        const username = pathSegments[0];
        const gistId = pathSegments[1];
        const rawFileSegments = pathSegments.slice(3);
        const filename = decodeURIComponent(
            rawFileSegments[rawFileSegments.length - 1] || "",
        );

        if (!filename) {
            return `https://gist.github.com/${username}/${gistId}`;
        }

        // GitHub gist anchors lowercase the filename and replace dots with hyphens.
        const anchor = "file-" + filename.toLowerCase().replace(/\./g, "-");

        return `https://gist.github.com/${username}/${gistId}#${anchor}`;
    } catch (error) {
        return null;
    }
}

/**
 * Parse repo raw URL and return the file view URL
 * Example: https://raw.githubusercontent.com/owner/repo/branch/path/to/file.js
 * Returns: https://github.com/owner/repo/blob/branch/path/to/file.js
 */
function parseRepoRawUrl(url) {
    const match = url.match(
        /raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/,
    );
    if (!match) return null;

    const owner = match[1];
    const repo = match[2];
    const branch = match[3];
    const filePath = match[4];

    return `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
}

function createGithubApiHeaders() {
    const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };

    if (cachedGithubToken) {
        headers.Authorization = `token ${cachedGithubToken}`;
    }

    return headers;
}

function parseGistIdentity(url) {
    try {
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
        if (pathSegments.length < 2) {
            return null;
        }

        const gistId = pathSegments[1];
        if (!gistId) {
            return null;
        }

        let filenameHint = "";
        if (pathSegments[2] === "raw" && pathSegments.length >= 5) {
            filenameHint = decodeURIComponent(
                pathSegments[pathSegments.length - 1]
            );
        }

        return {
            gistId,
            filenameHint,
        };
    } catch (error) {
        return null;
    }
}

function extractFilenameFromRawUrl(rawUrl) {
    if (!rawUrl) {
        return "";
    }

    try {
        const parsedUrl = new URL(rawUrl);
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
        if (pathSegments.length === 0) {
            return "";
        }
        return decodeURIComponent(pathSegments[pathSegments.length - 1] || "");
    } catch (error) {
        return "";
    }
}

function findPreferredGistRawLink() {
    if (location.hash) {
        const hashTarget = document.querySelector(location.hash);
        const hashContainer = hashTarget?.closest("div, article, section");
        const scopedRawLink = hashContainer?.querySelector('a[href*="/raw/"]');
        if (scopedRawLink) {
            return scopedRawLink;
        }
    }

    return document.querySelector('a[href*="/raw/"]');
}

function findMatchingGistFile(files, filenameHint) {
    const allFiles = Object.values(files || {});
    if (allFiles.length === 0) {
        return null;
    }

    const normalizedHint = String(filenameHint || "").trim().toLowerCase();
    if (!normalizedHint) {
        return allFiles[0];
    }

    const exactMatch = allFiles.find(
        (file) =>
            String(file.filename || "").trim().toLowerCase() === normalizedHint
    );
    if (exactMatch) {
        return exactMatch;
    }

    const basenameMatch = allFiles.find((file) =>
        String(file.filename || "")
            .trim()
            .toLowerCase()
            .endsWith(`/${normalizedHint}`)
    );
    if (basenameMatch) {
        return basenameMatch;
    }

    return allFiles[0];
}

async function fetchLatestGistRawUrl(gistId, filenameHint, fallbackRawUrl) {
    const response = await fetch(
        `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
        {
            headers: createGithubApiHeaders(),
        }
    );

    if (!response.ok) {
        if (fallbackRawUrl) {
            return fallbackRawUrl;
        }
        throw new Error(`Failed to fetch gist metadata (${response.status})`);
    }

    const gistData = await response.json();
    const matchingFile = findMatchingGistFile(gistData.files, filenameHint);
    if (matchingFile && matchingFile.raw_url) {
        return matchingFile.raw_url;
    }

    if (fallbackRawUrl) {
        return fallbackRawUrl;
    }

    throw new Error("Could not determine latest gist raw URL");
}

async function resolveLatestRawUrlForCurrentPage() {
    const host = window.location.hostname;
    if (host === "raw.githubusercontent.com") {
        return window.location.href;
    }

    if (host !== "gist.github.com" && host !== "gist.githubusercontent.com") {
        return "";
    }

    const gistIdentity = parseGistIdentity(window.location.href);
    if (!gistIdentity) {
        return "";
    }

    const preferredRawLink = findPreferredGistRawLink();
    const fallbackRawUrl =
        preferredRawLink?.href ||
        (host === "gist.githubusercontent.com" ||
        window.location.pathname.includes("/raw/")
            ? window.location.href
            : "");

    const filenameHint =
        gistIdentity.filenameHint || extractFilenameFromRawUrl(fallbackRawUrl);

    return fetchLatestGistRawUrl(
        gistIdentity.gistId,
        filenameHint,
        fallbackRawUrl
    );
}

/**
 * Add a "Go to Gist/File" button in the upper right corner of raw pages
 */
function addRawPageButton(targetUrl, buttonText, resolveLatestRawUrl = null) {
    // Remove existing button if present
    document.getElementById("go-to-source-container")?.remove();

    const container = document.createElement("div");
    container.id = "go-to-source-container";
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        gap: 8px;
    `;

    // Go to Gist/File button
    const button = document.createElement("button");
    button.style.cssText = `
        padding: 8px 16px;
        background-color: #238636;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        transition: background-color 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;

    button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path>
        </svg>
        ${buttonText}
    `;

    button.title = `Navigate to ${buttonText.toLowerCase()}`;

    button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#2ea043";
    });
    button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#238636";
    });

    button.addEventListener("click", () => {
        window.location.href = targetUrl;
    });

    // Copy All button
    const copyButton = document.createElement("button");
    copyButton.style.cssText = `
        padding: 8px 16px;
        background-color: #0969da;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        transition: background-color 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;

    copyButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
        </svg>
        Copy All
    `;

    copyButton.title = "Copy all content to clipboard";

    copyButton.addEventListener("mouseover", () => {
        copyButton.style.backgroundColor = "#0860ca";
    });
    copyButton.addEventListener("mouseout", () => {
        copyButton.style.backgroundColor = "#0969da";
    });

    copyButton.addEventListener("click", async () => {
        try {
            // Get the main content (usually <pre> on raw pages)
            const preElement = document.querySelector("pre");
            const content = (
                preElement
                    ? preElement.innerText || preElement.textContent
                    : document.body.innerText || document.body.textContent
            ).trim();

            await navigator.clipboard.writeText(content);

            // Visual feedback - change button temporarily
            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
                </svg>
                Copied!
            `;
            copyButton.style.backgroundColor = "#1a7f37";

            setTimeout(() => {
                copyButton.innerHTML = originalHTML;
                copyButton.style.backgroundColor = "#0969da";
            }, 2000);
        } catch (err) {
            console.error("GitHub Assistant: Failed to copy content:", err);

            // Show error feedback
            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"></path>
                </svg>
                Failed
            `;
            copyButton.style.backgroundColor = "#cf222e";

            setTimeout(() => {
                copyButton.innerHTML = originalHTML;
                copyButton.style.backgroundColor = "#0969da";
            }, 2000);
        }
    });

    const copyLatestRawButton = document.createElement("button");
    copyLatestRawButton.style.cssText = `
        padding: 8px 16px;
        background-color: #8250df;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        transition: background-color 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;
    copyLatestRawButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.75 1a.75.75 0 0 0 0 1.5h5.19L6.72 3.72a.75.75 0 1 0 1.06 1.06l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5A.75.75 0 1 0 6.72-.22L7.94 1H2.75Zm10.5 14a.75.75 0 0 0 0-1.5H8.06l1.22-1.22a.75.75 0 1 0-1.06-1.06l-2.5 2.5a.75.75 0 0 0 0 1.06l2.5 2.5a.75.75 0 0 0 1.06-1.06L8.06 15h5.19Z"></path>
        </svg>
        Copy Latest Raw
    `;
    copyLatestRawButton.title = "Copy latest raw file URL";

    copyLatestRawButton.addEventListener("mouseover", () => {
        copyLatestRawButton.style.backgroundColor = "#7c52cc";
    });
    copyLatestRawButton.addEventListener("mouseout", () => {
        copyLatestRawButton.style.backgroundColor = "#8250df";
    });

    copyLatestRawButton.addEventListener("click", async () => {
        if (typeof resolveLatestRawUrl !== "function") {
            return;
        }

        const originalHtml = copyLatestRawButton.innerHTML;
        try {
            const latestRawUrl = await resolveLatestRawUrl();
            if (!latestRawUrl) {
                throw new Error("No raw URL found");
            }
            await navigator.clipboard.writeText(latestRawUrl);
            copyLatestRawButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
                </svg>
                Raw URL Copied
            `;
            copyLatestRawButton.style.backgroundColor = "#1a7f37";
        } catch (error) {
            copyLatestRawButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"></path>
                </svg>
                Copy Failed
            `;
            copyLatestRawButton.style.backgroundColor = "#cf222e";
        }

        setTimeout(() => {
            copyLatestRawButton.innerHTML = originalHtml;
            copyLatestRawButton.style.backgroundColor = "#8250df";
        }, 2000);
    });

    container.appendChild(button);
    container.appendChild(copyLatestRawButton);
    container.appendChild(copyButton);
    document.body.appendChild(container);
}

function addGistViewCopyLatestRawButton() {
    document.getElementById("gist-copy-latest-raw-container")?.remove();

    const container = document.createElement("div");
    container.id = "gist-copy-latest-raw-container";
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        gap: 8px;
    `;

    const button = document.createElement("button");
    button.style.cssText = `
        padding: 8px 16px;
        background-color: #8250df;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        transition: background-color 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;
    button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.75 1a.75.75 0 0 0 0 1.5h5.19L6.72 3.72a.75.75 0 1 0 1.06 1.06l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5A.75.75 0 1 0 6.72-.22L7.94 1H2.75Zm10.5 14a.75.75 0 0 0 0-1.5H8.06l1.22-1.22a.75.75 0 1 0-1.06-1.06l-2.5 2.5a.75.75 0 0 0 0 1.06l2.5 2.5a.75.75 0 0 0 1.06-1.06L8.06 15h5.19Z"></path>
        </svg>
        Copy Latest Raw
    `;
    button.title = "Copy latest raw file URL";

    button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#7c52cc";
    });
    button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#8250df";
    });

    button.addEventListener("click", async () => {
        const originalHtml = button.innerHTML;
        try {
            const latestRawUrl = await resolveLatestRawUrlForCurrentPage();
            if (!latestRawUrl) {
                throw new Error("No raw URL found");
            }
            await navigator.clipboard.writeText(latestRawUrl);
            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
                </svg>
                Raw URL Copied
            `;
            button.style.backgroundColor = "#1a7f37";
        } catch (error) {
            button.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"></path>
                </svg>
                Copy Failed
            `;
            button.style.backgroundColor = "#cf222e";
        }

        setTimeout(() => {
            button.innerHTML = originalHtml;
            button.style.backgroundColor = "#8250df";
        }, 2000);
    });

    container.appendChild(button);
    document.body.appendChild(container);
}

/**
 * Check if the current page contains JSON content and format it
 */
function formatJSONContent() {
    try {
        // Get the main content element
        const preElement = document.querySelector("pre");
        if (!preElement) {
            return false;
        }

        // Get the raw text content
        const rawContent = (
            preElement.innerText || preElement.textContent
        ).trim();

        // Check if it's valid JSON
        try {
            const jsonData = JSON.parse(rawContent);

            // Store original content for toggling
            if (!preElement.dataset.originalContent) {
                preElement.dataset.originalContent = rawContent;
                preElement.dataset.isFormatted = "false";
            }

            // Format JSON with 2-space indentation
            const formattedJSON = JSON.stringify(jsonData, null, 2);

            // Apply formatted content
            preElement.textContent = formattedJSON;
            preElement.dataset.isFormatted = "true";

            // Add styling for better readability
            preElement.style.whiteSpace = "pre";
            preElement.style.fontFamily = "monospace";
            preElement.style.fontSize = "14px";
            preElement.style.lineHeight = "1.5";

            console.log(
                "GitHub Assistant: JSON content formatted successfully",
            );
            return true;
        } catch (parseError) {
            // Not valid JSON or already formatted
            return false;
        }
    } catch (error) {
        console.error("GitHub Assistant: Error formatting JSON:", error);
        return false;
    }
}

/**
 * Toggle between formatted and original JSON
 */
function toggleJSONFormat() {
    const preElement = document.querySelector("pre");
    if (!preElement || !preElement.dataset.originalContent) {
        return;
    }

    const isFormatted = preElement.dataset.isFormatted === "true";

    if (isFormatted) {
        // Show original
        preElement.textContent = preElement.dataset.originalContent;
        preElement.dataset.isFormatted = "false";
    } else {
        // Show formatted
        try {
            const jsonData = JSON.parse(preElement.dataset.originalContent);
            preElement.textContent = JSON.stringify(jsonData, null, 2);
            preElement.dataset.isFormatted = "true";
        } catch (error) {
            console.error(
                "GitHub Assistant: Error toggling JSON format:",
                error,
            );
        }
    }
}

/**
 * Add format toggle button for JSON files
 */
function addFormatToggleButton() {
    const preElement = document.querySelector("pre");
    if (!preElement || !preElement.dataset.originalContent) {
        return;
    }

    const container = document.getElementById("go-to-source-container");
    if (!container) {
        return;
    }

    // Check if button already exists
    if (document.getElementById("format-json-button")) {
        return;
    }

    const formatButton = document.createElement("button");
    formatButton.id = "format-json-button";
    formatButton.style.cssText = `
        padding: 8px 16px;
        background-color: #8250df;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
        transition: background-color 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;

    formatButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path>
        </svg>
        Toggle Format
    `;

    formatButton.title = "Toggle between formatted and original JSON";

    formatButton.addEventListener("mouseover", () => {
        formatButton.style.backgroundColor = "#7c52cc";
    });
    formatButton.addEventListener("mouseout", () => {
        formatButton.style.backgroundColor = "#8250df";
    });

    formatButton.addEventListener("click", () => {
        toggleJSONFormat();

        // Update button text based on current state
        const preElement = document.querySelector("pre");
        const isFormatted = preElement?.dataset.isFormatted === "true";

        if (isFormatted) {
            formatButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path>
                </svg>
                Toggle Format
            `;
        } else {
            formatButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"></path>
                </svg>
                Toggle Format
            `;
        }
    });

    // Insert the format button before the copy button (as second button)
    const copyButton = container.querySelector("button:nth-child(2)");
    if (copyButton) {
        container.insertBefore(formatButton, copyButton);
    } else {
        container.appendChild(formatButton);
    }
}

/**
 * Initialize raw page handler - detects if we're on a raw page and adds appropriate button
 */
async function initRawPage() {
    // Load settings if not loaded
    if (cachedSettings === null) {
        await loadSettingsCache();
    }

    // Check if raw page buttons are enabled
    if (!cachedSettings.showRawPageButtons) {
        return;
    }

    if (cachedGithubToken === null) {
        await loadGithubTokenCache();
    }

    if (document.readyState === "loading") {
        await new Promise((resolve) => {
            document.addEventListener("DOMContentLoaded", resolve, {
                once: true,
            });
        });
    }

    const currentUrl = location.href;

    // Check if we're on a gist view page and show copy latest raw button
    if (
        location.hostname === "gist.github.com" &&
        !location.pathname.includes("/raw/")
    ) {
        const gistIdentity = parseGistIdentity(currentUrl);
        const rawLink = findPreferredGistRawLink();
        if (gistIdentity && rawLink) {
            addGistViewCopyLatestRawButton();
        }
        return;
    }

    // Check if we're on a gist raw page
    if (
        currentUrl.includes("gist.githubusercontent.com") ||
        (
            location.hostname === "gist.github.com" &&
            location.pathname.includes("/raw/")
        )
    ) {
        const gistUrl = parseGistRawUrl(currentUrl);
        if (gistUrl) {
            console.log(
                "GitHub Assistant: Detected gist raw page, adding button",
            );
            addRawPageButton(
                gistUrl,
                "Go to Gist",
                resolveLatestRawUrlForCurrentPage
            );

            // Try to format JSON content
            const isJSON = formatJSONContent();
            if (isJSON) {
                addFormatToggleButton();
            }
        }
        return;
    }

    // Check if we're on a repo raw page
    if (currentUrl.includes("raw.githubusercontent.com")) {
        const fileUrl = parseRepoRawUrl(currentUrl);
        if (fileUrl) {
            console.log(
                "GitHub Assistant: Detected repo raw page, adding button",
            );
            addRawPageButton(
                fileUrl,
                "Go to File",
                resolveLatestRawUrlForCurrentPage
            );

            // Try to format JSON content
            const isJSON = formatJSONContent();
            if (isJSON) {
                addFormatToggleButton();
            }
        }
        return;
    }
}

// ===== END RAW PAGE HANDLERS =====

init();
scheduleQuickAccessButtonsInjection();
schedulePackagesListEnhancement();
autofillImportForm();
initRawPage();
scheduleFileTreeCommitLinks();
[300, 800, 1500, 3000].forEach((ms) => setTimeout(scheduleFileTreeCommitLinks, ms));
scheduleCommitMetaButton();
[300, 800, 1500].forEach((ms) => setTimeout(scheduleCommitMetaButton, ms));
initHotkeys();

// Handle GitHub's SPA navigation with better detection
let lastUrl = location.href;

// Use both pushState/replaceState interception and MutationObserver
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

function handleNavigation() {
    const url = location.href;
    if (url !== lastUrl) {
        console.log(
            `GitHub Assistant: Navigation detected from ${lastUrl} to ${url}`,
        );
        lastUrl = url;

        // Remove existing buttons before reinitializing
        document.getElementById("go-to-fork-container")?.remove();
        document.getElementById("back-to-upstream-container")?.remove();
        document.getElementById("import-repo-container")?.remove();
        document.getElementById("github-assistant-quick-access-container")?.remove();
        document.getElementById("go-to-source-container")?.remove();
        document.getElementById("gist-copy-latest-raw-container")?.remove();
        document.getElementById(`${COMMIT_META_ID}-btn`)?.remove();
        removeCommitMetaUI();
        document
            .querySelectorAll(`.${COMMIT_SHORTCUT_CLASS}`)
            .forEach((node) => node.remove());
        document
            .querySelectorAll(`[${COMMIT_SHORTCUT_ATTR}]`)
            .forEach((el) => el.removeAttribute(COMMIT_SHORTCUT_ATTR));
        document
            .querySelectorAll(`.${PACKAGE_METADATA_CLASS}`)
            .forEach((node) => node.remove());
        scheduleQuickAccessButtonsInjection();
        schedulePackagesListEnhancement();

        // Reinitialize immediately with minimal delay
        setTimeout(async () => {
            console.log("GitHub Assistant: Reinitializing after navigation...");
            await init();
            autofillImportForm();
            initRawPage();
            scheduleFileTreeCommitLinks();
            scheduleCommitMetaButton();
            schedulePackagesListEnhancement();
            // Staggered retries for lazily-loaded content
            [300, 800, 1500, 3000].forEach((ms) => setTimeout(scheduleFileTreeCommitLinks, ms));
            [300, 800, 1500].forEach((ms) => setTimeout(scheduleCommitMetaButton, ms));
        }, 50);
    }
}

history.pushState = function (...args) {
    originalPushState.apply(this, args);
    handleNavigation();
};

history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    handleNavigation();
};

// Also listen for popstate (back/forward buttons)
window.addEventListener("popstate", handleNavigation);

// Fallback MutationObserver for any missed navigations
let mutationTimeout;
new MutationObserver(() => {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(() => {
        handleNavigation();
        schedulePackagesListEnhancement();
        scheduleFileTreeCommitLinks();
    }, 100);
}).observe(document, { subtree: true, childList: true });

async function findAllForks(currentUser, sourceOwner, sourceRepo, githubToken) {
    const forks = [];
    const userOrgs = new Set();
    userOrgs.add(currentUser);

    console.log(
        `GitHub Assistant: Searching forks for ${sourceOwner}/${sourceRepo}`,
    );

    // Get user's organizations
    try {
        const orgsResp = await fetch(
            "https://api.github.com/user/orgs?per_page=100",
            {
                headers: {
                    Accept: "application/vnd.github.v3+json",
                    Authorization: `token ${githubToken}`,
                },
            },
        );

        if (orgsResp.ok) {
            const orgs = await orgsResp.json();
            orgs.forEach((org) => userOrgs.add(org.login));
        }
    } catch (e) {
        console.log("GitHub Assistant: Could not fetch organizations:", e);
    }

    // Use the GitHub forks API to get all forks of the source repo
    try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const forksResp = await fetch(
                `https://api.github.com/repos/${sourceOwner}/${sourceRepo}/forks?per_page=100&page=${page}`,
                {
                    headers: {
                        Accept: "application/vnd.github.v3+json",
                        Authorization: `token ${githubToken}`,
                    },
                },
            );

            if (!forksResp.ok) {
                console.log(
                    `GitHub Assistant: Failed to fetch forks (status ${forksResp.status})`,
                );
                break;
            }

            const allForks = await forksResp.json();

            if (allForks.length === 0) {
                hasMore = false;
                break;
            }

            // Filter forks that belong to the user or their organizations
            for (const fork of allForks) {
                if (userOrgs.has(fork.owner.login)) {
                    forks.push({
                        owner: fork.owner.login,
                        name: fork.name,
                        url: fork.html_url,
                    });
                }
            }

            // If we found forks, we can stop early
            if (forks.length > 0) break;

            page++;
            if (allForks.length < 100) hasMore = false;
        }
    } catch (e) {
        console.log("GitHub Assistant: Could not fetch forks:", e);
    }

    if (forks.length > 0) {
        console.log(`GitHub Assistant: Found ${forks.length} fork(s)`);
    }
    return forks;
}

function addForkButton(forks) {
    // Prevent duplicate buttons
    if (document.getElementById("go-to-fork-container")) return;

    // Find the top-nav-center section for button placement
    const topNavCenter = document.querySelector('[data-testid="top-nav-center"]');

    if (!topNavCenter) {
        console.log(
            "GitHub Assistant: Could not find top-nav-center for fork button",
        );
        return;
    }

    // Find the search button group to insert before it
    const searchButtonGroup = topNavCenter.querySelector(".Search-module__searchButtonGroup--L3A4O") ||
                             topNavCenter.querySelector('[class*="Search"]');

    const container = createForkButtonContainer(forks);

    // Insert before search
    if (searchButtonGroup) {
        topNavCenter.insertBefore(container, searchButtonGroup);
    } else {
        topNavCenter.insertBefore(container, topNavCenter.firstChild);
    }
    console.log("GitHub Assistant: Fork button added successfully");
}

function createForkButtonContainer(forks) {
    const container = document.createElement("div");
    container.id = "go-to-fork-container";
    container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0;
    position: relative;
    margin-right: 4px;
    vertical-align: middle;
  `;

    if (forks.length === 1) {
        // Single fork - just a button
        const button = document.createElement("a");
        button.href = forks[0].url;
        button.className = "btn btn-sm";
        button.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      height: 32px;
      background-color: #238636;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
        button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path>
      </svg>
      Go to Fork
    `;
        button.addEventListener("mouseover", () => {
            button.style.backgroundColor = "#2ea043";
        });
        button.addEventListener("mouseout", () => {
            button.style.backgroundColor = "#238636";
        });
        container.appendChild(button);
    } else {
        // Multiple forks - button with dropdown
        const wrapper = document.createElement("div");
        wrapper.style.cssText = `
      position: relative;
      display: inline-flex;
    `;

        const mainBtn = document.createElement("a");
        mainBtn.href = forks[0].url;
        mainBtn.className = "btn btn-sm";
        mainBtn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      height: 32px;
      background-color: #238636;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px 0 0 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
        mainBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path>
      </svg>
      GitHub Assistant
    `;

        const dropBtn = document.createElement("button");
        dropBtn.type = "button";
        dropBtn.className = "btn btn-sm";
        dropBtn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 8px;
      height: 32px;
      background-color: #238636;
      color: white;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-left: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 0 6px 6px 0;
      cursor: pointer;
      font-size: 12px;
      line-height: 20px;
    `;
        dropBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"></path>
      </svg>
    `;

        const dropdown = document.createElement("div");
        dropdown.style.cssText = `
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      background: #ffffff;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      min-width: 200px;
      box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
      z-index: 1000;
      overflow: hidden;
    `;

        forks.forEach((fork, index) => {
            const item = document.createElement("a");
            item.href = fork.url;
            item.style.cssText = `
        display: block;
        padding: 8px 12px;
        color: #24292f;
        text-decoration: none;
        font-size: 13px;
        border-bottom: ${
            index < forks.length - 1 ? "1px solid #d0d7de" : "none"
        };
        transition: background-color 0.1s;
      `;
            item.innerHTML = `
        <div style="font-weight: 500;">${fork.owner}/${fork.name}</div>
      `;
            item.addEventListener("mouseover", () => {
                item.style.backgroundColor = "#f6f8fa";
            });
            item.addEventListener("mouseout", () => {
                item.style.backgroundColor = "transparent";
            });
            dropdown.appendChild(item);
        });

        let isOpen = false;
        const toggleDropdown = (e) => {
            e?.preventDefault();
            e?.stopPropagation();
            isOpen = !isOpen;
            dropdown.style.display = isOpen ? "block" : "none";
        };

        dropBtn.addEventListener("click", toggleDropdown);

        mainBtn.addEventListener("mouseover", () => {
            mainBtn.style.backgroundColor = "#2ea043";
        });
        mainBtn.addEventListener("mouseout", () => {
            mainBtn.style.backgroundColor = "#238636";
        });

        dropBtn.addEventListener("mouseover", () => {
            dropBtn.style.backgroundColor = "#2ea043";
        });
        dropBtn.addEventListener("mouseout", () => {
            dropBtn.style.backgroundColor = "#238636";
        });

        document.addEventListener("click", (e) => {
            if (!wrapper.contains(e.target)) {
                isOpen = false;
                dropdown.style.display = "none";
            }
        });

        wrapper.appendChild(mainBtn);
        wrapper.appendChild(dropBtn);
        wrapper.appendChild(dropdown);
        container.appendChild(wrapper);
    }

    return container;
}

function addUpstreamButton(upstreamUrl, upstreamFullName) {
    // Prevent duplicate buttons
    if (document.getElementById("back-to-upstream-container")) return;

    // Find the top-nav-center section for button placement
    const topNavCenter = document.querySelector('[data-testid="top-nav-center"]');

    if (!topNavCenter) {
        console.log(
            "GitHub Assistant: Could not find top-nav-center for upstream button",
        );
        return;
    }

    // Find the search button group to insert before it
    const searchButtonGroup = topNavCenter.querySelector(".Search-module__searchButtonGroup--L3A4O") ||
                             topNavCenter.querySelector('[class*="Search"]');

    const container = createUpstreamButtonContainer(
        upstreamUrl,
        upstreamFullName,
    );

    // Insert before search
    if (searchButtonGroup) {
        topNavCenter.insertBefore(container, searchButtonGroup);
    } else {
        topNavCenter.insertBefore(container, topNavCenter.firstChild);
    }
    console.log("GitHub Assistant: Upstream button added successfully");
}

function createUpstreamButtonContainer(upstreamUrl, upstreamFullName) {
    const container = document.createElement("div");
    container.id = "back-to-upstream-container";
    container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0;
    position: relative;
    margin-right: 4px;
    vertical-align: middle;
  `;

    const button = document.createElement("a");
    button.href = upstreamUrl;
    button.className = "btn btn-sm";
    button.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      height: 32px;
      background-color: #0969da;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path>
      </svg>
      Back to Upstream
    `;
    button.title = `Go to upstream: ${upstreamFullName}`;
    button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#0860ca";
    });
    button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#0969da";
    });
    container.appendChild(button);

    return container;
}

// ===============================================
// Navigation Hotkey Handlers
// ===============================================

/**
 * Navigate to repository owner's homepage
 */
/**
 * Navigate to repo owner's homepage (smart detection for repos, users, orgs)
 * - Repo page: Navigate to repo owner
 * - User/org profile: Navigate to same profile
 * - Org pages: Navigate to org homepage
 * - Other pages: Try to extract owner from URL path
 */
function handleOwnerHomepage() {
    const pathname = location.pathname;

    // Check if we're on an org page (orgs/owner/...)
    const orgMatch = pathname.match(/^\/orgs\/([^\/]+)/);
    if (orgMatch) {
        const owner = orgMatch[1];
        window.location.href = `https://github.com/${owner}`;
        return;
    }

    // Check if we're on a repo page (owner/repo)
    const repoMatch = pathname.match(/^\/(\w[\w-]*)\/([\\w-]+)/);
    if (repoMatch) {
        const owner = repoMatch[1];
        // Exclude special pages
        const excludedOwners = ['new', 'settings', 'organizations', 'enterprises', 'team', 'orgs',
                               'marketplace', 'explore', 'topics', 'trending', 'collections', 'events',
                               'codespaces', 'features', 'sponsors', 'about', 'customer-stories'];
        if (!excludedOwners.includes(owner.toLowerCase())) {
            window.location.href = `https://github.com/${owner}`;
            return;
        }
    }

    // Check if we're on a user/org profile page
    const profileMatch = pathname.match(/^\/(\w[\w-]*)(?:\/.*)?$/);
    if (profileMatch) {
        const owner = profileMatch[1];
        const excludedOwners = ['new', 'settings', 'organizations', 'enterprises', 'team', 'orgs',
                               'marketplace', 'explore', 'topics', 'trending', 'collections', 'events',
                               'codespaces', 'features', 'sponsors', 'about', 'customer-stories', 'dashboard'];
        if (!excludedOwners.includes(owner.toLowerCase())) {
            window.location.href = `https://github.com/${owner}`;
            return;
        }
    }

    // Fallback: Go to current user's profile
    const parsedUrl = parseGitHubUrl(location.href);
    if (parsedUrl) {
        window.location.href = `https://github.com/${parsedUrl.owner}`;
    }
}

/**
 * Navigate to current user's dashboard OR organization dashboard if on org page
 * - If on org page/repo: Go to org dashboard
 * - Otherwise: Go to user's personal dashboard
 */
async function handleDashboard() {
    const pathname = location.pathname;
    let owner = null;

    // Check if we're on an org dashboard already
    const orgDashMatch = pathname.match(/^\/orgs\/([^\/]+)/);
    if (orgDashMatch) {
        owner = orgDashMatch[1];
        window.location.href = `https://github.com/orgs/${owner}/dashboard`;
        return;
    }

    // Check if we're on a repo page (owner/repo)
    const repoMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)/);
    if (repoMatch) {
        owner = repoMatch[1];
    } else {
        // Check if we're on a profile page
        const profileMatch = pathname.match(/^\/([^\/]+)(?:\/.*)?$/);
        if (profileMatch) {
            owner = profileMatch[1];
        }
    }

    // List of excluded special pages
    const excludedOwners = ['new', 'settings', 'organizations', 'enterprises', 'team', 'orgs',
                           'marketplace', 'explore', 'topics', 'trending', 'collections', 'events',
                           'codespaces', 'features', 'sponsors', 'about', 'customer-stories', 'dashboard'];

    if (owner && !excludedOwners.includes(owner.toLowerCase())) {
        console.log('GitHub Assistant: Checking dashboard for owner:', owner);

        // Ensure token is loaded
        if (cachedGithubToken === null) {
            await loadGithubTokenCache();
        }

        // Check if owner is an organization using the API
        if (cachedGithubToken) {
            try {
                const response = await fetch(`https://api.github.com/users/${owner}`, {
                    headers: { 'Authorization': `token ${cachedGithubToken}` },
                });
                if (response.ok) {
                    const userData = await response.json();
                    console.log('GitHub Assistant: Owner type for dashboard:', userData.type);
                    if (userData.type === 'Organization') {
                        // Navigate to org dashboard
                        window.location.href = `https://github.com/orgs/${owner}/dashboard`;
                        return;
                    }
                }
            } catch (err) {
                console.log('GitHub Assistant: Failed to check if owner is org for dashboard:', err);
            }
        }
    }

    // Default: Navigate to user's personal dashboard
    console.log('GitHub Assistant: Navigating to personal dashboard');
    window.location.href = 'https://github.com/dashboard';
}

/**
 * Navigate to repository owner's feed/dashboard page (smart detection for org/user)
 * - Detects if owner is an organization and navigates to org dashboard
 * - For users, navigates to repositories tab
 * - From homepage/dashboard, goes to activity feed
 */
async function handleOwnerFeed() {
    const pathname = location.pathname;
    let owner = null;

    // Special case: on dashboard or homepage, go to activity feed
    if (pathname === '/dashboard' || pathname === '/' || pathname === '') {
        console.log('GitHub Assistant: Navigating to activity feed');
        window.location.href = 'https://github.com/feed';
        return;
    }

    // Check if we're on an org page (orgs/owner/...)
    const orgMatch = pathname.match(/^\/orgs\/([^\/]+)/);
    if (orgMatch) {
        owner = orgMatch[1];
        // Already know it's an org, navigate directly
        window.location.href = `https://github.com/orgs/${owner}/dashboard`;
        return;
    }

    // Check if we're on a repo page (owner/repo)
    const repoMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)/);
    if (repoMatch) {
        owner = repoMatch[1];
    } else {
        // Check if we're on a profile page
        const profileMatch = pathname.match(/^\/([^\/]+)(?:\/.*)?$/);
        if (profileMatch) {
            owner = profileMatch[1];
        }
    }

    // List of excluded special pages
    const excludedOwners = ['new', 'settings', 'organizations', 'enterprises', 'team', 'orgs',
                           'marketplace', 'explore', 'topics', 'trending', 'collections', 'events',
                           'codespaces', 'features', 'sponsors', 'about', 'customer-stories', 'dashboard'];

    if (!owner || excludedOwners.includes(owner.toLowerCase())) {
        // Fallback: Try to extract owner from URL
        const parsedUrl = parseGitHubUrl(location.href);
        if (parsedUrl) {
            owner = parsedUrl.owner;
        } else {
            console.log('GitHub Assistant: Could not extract owner from URL');
            return;
        }
    }

    console.log('GitHub Assistant: Checking owner type for:', owner);

    // Ensure token is loaded
    if (cachedGithubToken === null) {
        await loadGithubTokenCache();
    }

    // Check if owner is an organization using the API
    if (cachedGithubToken) {
        try {
            const response = await fetch(`https://api.github.com/users/${owner}`, {
                headers: { 'Authorization': `token ${cachedGithubToken}` },
            });
            if (response.ok) {
                const userData = await response.json();
                console.log('GitHub Assistant: Owner type:', userData.type);
                if (userData.type === 'Organization') {
                    // Navigate to org dashboard
                    console.log('GitHub Assistant: Navigating to org dashboard');
                    window.location.href = `https://github.com/orgs/${owner}/dashboard`;
                    return;
                }
            } else {
                console.log('GitHub Assistant: API response not OK:', response.status);
            }
        } catch (err) {
            console.log('GitHub Assistant: Failed to check if owner is org:', err);
        }
    } else {
        console.log('GitHub Assistant: No GitHub token found');
    }

    // Default: Navigate to repositories tab (for users or if API call fails)
    console.log('GitHub Assistant: Navigating to repositories tab');
    window.location.href = `https://github.com/${owner}?tab=repositories`;
}

/**
 * Navigate to a custom URL
 */
function handleCustomNavigation(url) {
    if (!url) return;
    window.location.href = url;
}

/**
 * Navigate to packages page of current owner (organization or user)
 * - Detects if owner is an organization and uses correct URL format
 * - Organizations: /orgs/{owner}/packages
 * - Users: /{owner}?tab=packages
 */
async function handlePackages() {
    const pathname = location.pathname;
    let owner = null;

    // Check if we're on an org page (orgs/owner/...)
    const orgMatch = pathname.match(/^\/orgs\/([^\/]+)/);
    if (orgMatch) {
        owner = orgMatch[1];
        // Already know it's an org, navigate directly
        window.location.href = `https://github.com/orgs/${owner}/packages`;
        return;
    }

    // Check if we're on a repo page (owner/repo)
    const repoMatch = pathname.match(/^\/([^\/]+)\/([^\/]+)/);
    if (repoMatch) {
        owner = repoMatch[1];
    } else {
        // Check if we're on a profile page
        const profileMatch = pathname.match(/^\/([^\/]+)(?:\/.*)?$/);
        if (profileMatch) {
            owner = profileMatch[1];
        }
    }

    // List of excluded special pages
    const excludedOwners = ['new', 'settings', 'organizations', 'enterprises', 'team', 'orgs',
                           'marketplace', 'explore', 'topics', 'trending', 'collections', 'events',
                           'codespaces', 'features', 'sponsors', 'about', 'customer-stories', 'dashboard'];

    if (!owner || excludedOwners.includes(owner.toLowerCase())) {
        // Fallback: Try to extract owner from URL
        const parsedUrl = parseGitHubUrl(location.href);
        if (parsedUrl) {
            owner = parsedUrl.owner;
        } else {
            console.log('GitHub Assistant: Could not extract owner for packages navigation');
            return;
        }
    }

    console.log('GitHub Assistant: Navigating to packages for:', owner);

    // Ensure token is loaded
    if (cachedGithubToken === null) {
        await loadGithubTokenCache();
    }

    // Check if owner is an organization using the API
    if (cachedGithubToken) {
        try {
            const response = await fetch(`https://api.github.com/users/${owner}`, {
                headers: { 'Authorization': `token ${cachedGithubToken}` },
            });
            if (response.ok) {
                const userData = await response.json();
                console.log('GitHub Assistant: Owner type for packages:', userData.type);
                if (userData.type === 'Organization') {
                    // Navigate to org packages
                    window.location.href = `https://github.com/orgs/${owner}/packages`;
                    return;
                }
            } else {
                console.log('GitHub Assistant: API response not OK:', response.status);
            }
        } catch (err) {
            console.log('GitHub Assistant: Failed to check if owner is org for packages:', err);
        }
    } else {
        console.log('GitHub Assistant: No GitHub token found for packages navigation');
    }

    // Default: Navigate to packages tab (for users or if API call fails)
    window.location.href = `https://github.com/${owner}?tab=packages`;
}

/**
 * Navigate to gists page of current logged-in user
 * - Gets current user from API
 * - Navigates to their gists page
 */
async function handleGists() {
    // Try to get current user from API
    if (cachedGithubToken) {
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `token ${cachedGithubToken}` },
            });
            if (response.ok) {
                const userData = await response.json();
                window.location.href = `https://gist.github.com/${userData.login}`;
                return;
            }
        } catch (err) {
            console.log('GitHub Assistant: Failed to fetch current user for gists navigation');
        }
    }

    // Fallback: Navigate to gists homepage
    window.location.href = 'https://gist.github.com/';
}

/**
 * Navigate to GitHub Copilot page
 */
function handleGithubCopilot() {
    window.location.href = 'https://github.com/copilot';
}

// ===============================================
// Hotkey Navigation for Issues/PRs and Releases
// ===============================================

/**
 * Initialize hotkey listeners for navigating issues/PRs and releases
 * j/k: Navigate to previous/next issue/PR
 * gr: Navigate to releases page
 */

async function initHotkeys() {
    // Prevent multiple initializations
    if (hotkeysInitialized) {
        return;
    }

    // Load settings if not loaded
    if (cachedSettings === null) {
        await loadSettingsCache();
    }

    // Check if hotkeys feature is enabled (defaulting to true)
    if (cachedSettings.enableHotkeys === false) {
        return;
    }

    let comboState = {
        keys: [],
        timeout: null,
    };

    document.addEventListener("keydown", async (event) => {
        // Don't trigger if user is typing in an input/textarea/contenteditable
        if (
            event.target.matches(
                "input, textarea, [contenteditable], button, select",
            )
        ) {
            return;
        }

        const key = event.key.toLowerCase();
        clearTimeout(comboState.timeout);

        // Add key to combo state
        comboState.keys.push(key);
        const currentSequence = comboState.keys.join('');

        // Check for navigation hotkey combos (array format like ['g', 'f'])
        let navHotkeys = cachedSettings.navHotkeys || DEFAULT_SETTINGS.navHotkeys;

        // Validate navHotkeys array exists and has items
        if (!navHotkeys || !Array.isArray(navHotkeys) || navHotkeys.length === 0) {
            console.log('GitHub Assistant: navHotkeys is not properly initialized');
            navHotkeys = DEFAULT_SETTINGS.navHotkeys;
        }

        // Check built-in navHotkeys (array format)
        for (const hotkey of navHotkeys) {
            // Skip invalid hotkey entries
            if (!hotkey || !hotkey.keys || !Array.isArray(hotkey.keys)) {
                continue;
            }

            if (
                hotkey.keys.length === comboState.keys.length &&
                hotkey.keys.every((k, i) => k === comboState.keys[i])
            ) {
                event.preventDefault();
                event.stopPropagation();
                await handleHotkeyNavigation(hotkey);
                comboState.keys = [];
                clearTimeout(comboState.timeout);
                return;
            }
        }

        // Check custom hotkeys (string format)
        const customHotkeys = cachedSettings.customHotkeys || [];
        for (const customHotkey of customHotkeys) {
            if (customHotkey.keys && customHotkey.url) {
                if (currentSequence === customHotkey.keys.toLowerCase()) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.location.href = customHotkey.url;
                    comboState.keys = [];
                    clearTimeout(comboState.timeout);
                    return;
                }
            }
        }

        // Check for prefix match - keep waiting for more keys
        const hasPrefix = navHotkeys.some((hotkey) => {
            // Skip invalid hotkeys
            if (!hotkey || !hotkey.keys || !Array.isArray(hotkey.keys)) {
                return false;
            }
            return (
                hotkey.keys.length > comboState.keys.length &&
                hotkey.keys.slice(0, comboState.keys.length).every((k, i) => k === comboState.keys[i])
            );
        });

        // Also check if current sequence is a prefix of any custom hotkey
        const hasCustomPrefix = customHotkeys.some(customHotkey => {
            return customHotkey.keys && customHotkey.keys.toLowerCase().startsWith(currentSequence);
        });

        if (hasPrefix || hasCustomPrefix) {
            event.preventDefault();
            event.stopPropagation();
            // Set timeout to reset if no more keys come
            comboState.timeout = setTimeout(() => {
                comboState.keys = [];
            }, 1000);
            return;
        }

        // No match and no prefix - reset combo and handle single keys
        comboState.keys = [];
        clearTimeout(comboState.timeout);

        // Handle j/k for navigating issues/PRs
        if (key === "j") {
            event.preventDefault();
            handlePreviousIssue();
        } else if (key === "k") {
            event.preventDefault();
            handleNextIssue();
        }
    });

    hotkeysInitialized = true;
    console.log("GitHub Assistant: Hotkey listeners initialized");
}
/**
 * Handle navigation based on hotkey configuration
 */
async function handleHotkeyNavigation(hotkey) {
    // Guard against undefined or invalid hotkey
    if (!hotkey || typeof hotkey !== 'object') {
        console.log('GitHub Assistant: Invalid hotkey object', hotkey);
        return;
    }

    if (hotkey.urlType === 'static' && hotkey.url) {
        handleCustomNavigation(hotkey.url);
    } else if (hotkey.urlType === 'owner-home') {
        handleOwnerHomepage();
    } else if (hotkey.urlType === 'owner-feed') {
        await handleOwnerFeed();
    } else if (hotkey.urlType === 'dashboard') {
        await handleDashboard();
    } else if (hotkey.urlType === 'packages') {
        await handlePackages();
    } else if (hotkey.urlType === 'gists') {
        await handleGists();
    }
}

/**
 * Initialize hotkey listeners for navigating issues/PRs and releases
 * j/k: Navigate to previous/next issue/PR
 * gr: Navigate to releases page
 */

/**
 * Navigate to the previous (older) issue/PR
 * Shows a notification if on the first issue/PR
 */
function handlePreviousIssue() {
    const parsedUrl = parseGitHubUrl(location.href);
    if (!parsedUrl) return;

    // Check if we're on an issue or PR page
    const issueMatch = location.pathname.match(/\/issues\/(\d+)/);
    const prMatch = location.pathname.match(/\/pull\/(\d+)/);

    if (!issueMatch && !prMatch) {
        return;
    }

    const currentNumber = parseInt(issueMatch ? issueMatch[1] : prMatch[1]);
    if (currentNumber <= 1) {
        showNavigationNotification("You are at the first issue/PR");
        return;
    }

    const type = issueMatch ? "issues" : "pull";
    const { owner, repo } = parsedUrl;
    const newUrl = `https://github.com/${owner}/${repo}/${type}/${
        currentNumber - 1
    }`;
    window.location.href = newUrl;
}

/**
 * Navigate to the next (newer) issue/PR
 */
function handleNextIssue() {
    const parsedUrl = parseGitHubUrl(location.href);
    if (!parsedUrl) return;

    // Check if we're on an issue or PR page
    const issueMatch = location.pathname.match(/\/issues\/(\d+)/);
    const prMatch = location.pathname.match(/\/pull\/(\d+)/);

    if (!issueMatch && !prMatch) {
        return;
    }

    const currentNumber = parseInt(issueMatch ? issueMatch[1] : prMatch[1]);
    const type = issueMatch ? "issues" : "pull";
    const { owner, repo } = parsedUrl;
    const newUrl = `https://github.com/${owner}/${repo}/${type}/${
        currentNumber + 1
    }`;
    window.location.href = newUrl;
}

/**
 * Navigate to releases page of current repository
 * No notification shown per requirement
 */
function handleGotoReleases() {
    const parsedUrl = parseGitHubUrl(location.href);
    if (!parsedUrl) return;

    const { owner, repo } = parsedUrl;
    const releasesUrl = `https://github.com/${owner}/${repo}/releases`;
    window.location.href = releasesUrl;
}

/**
 * Show a temporary notification for navigation feedback
 */
function showNavigationNotification(message) {
    // Remove existing notification if present
    const existing = document.getElementById("gh-assistant-nav-notification");
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement("div");
    notification.id = "gh-assistant-nav-notification";
    notification.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #f6f8fa;
        border: 1px solid #d0d7de;
        border-radius: 6px;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        color: #24292f;
        box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
        z-index: 10000;
        animation: slideIn 0.2s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    `;

    // Add animation
    const style = document.createElement("style");
    style.textContent = `
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
    `;
    if (!document.querySelector("style[data-gh-assistant-animation]")) {
        style.setAttribute("data-gh-assistant-animation", "true");
        document.head.appendChild(style);
    }

    notification.textContent = message;
    document.body.appendChild(notification);

    // Auto-remove after 2.5 seconds
    setTimeout(() => {
        notification.style.opacity = "0";
        notification.style.transition = "opacity 0.2s ease-out";
        setTimeout(() => {
            notification.remove();
        }, 200);
    }, 2500);
}

// ===============================================
// Import Repository Functionality
// ===============================================

function addImportButton(owner, repo, repoData, currentUser, githubToken) {
    // Prevent duplicate buttons
    if (document.getElementById("import-repo-container")) return;

    // Find the search button group in the top navigation
    const searchButtonGroup =
        document.querySelector(".Search-module__searchButtonGroup--L3A4O") ||
        document.querySelector('[data-testid="top-nav-center"]');

    if (!searchButtonGroup) {
        console.log(
            "GitHub Assistant: Could not find search button group for import button",
        );
        return;
    }

    const container = createImportButtonContainer(
        owner,
        repo,
        repoData,
        currentUser,
        githubToken,
    );

    container.style.marginRight = "8px";
    container.style.display = "inline-block";

    // Insert before the search button group
    searchButtonGroup.parentNode.insertBefore(container, searchButtonGroup);
    console.log("GitHub Assistant: Import button added successfully");
}

function createImportButtonContainer(
    owner,
    repo,
    repoData,
    currentUser,
    githubToken,
) {
    const container = document.createElement("div");
    container.id = "import-repo-container";
    container.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 0;
        position: relative;
        margin-right: 4px;
        vertical-align: middle;
    `;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        height: 32px;
        background-color: #6639ba;
        color: white !important;
        border: 1px solid rgba(27, 31, 36, 0.15);
        border-radius: 6px;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        line-height: 20px;
    `;

    button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V1.5h-8a1 1 0 0 0-1 1v6.708A2.493 2.493 0 0 1 3.5 9h3.25a.75.75 0 0 1 0 1.5H3.5a1 1 0 0 0 0 2h5.75a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 11.5Zm13.23 7.79h-.001l-1.224-1.224v6.184a.75.75 0 0 1-1.5 0V9.066L10.28 10.29a.75.75 0 0 1-1.06-1.061l2.505-2.504a.75.75 0 0 1 1.06 0L15.29 9.23a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018Z"></path>
        </svg>
        Import Repository
    `;

    button.title = `Import ${owner}/${repo} to your account`;

    button.addEventListener("mouseover", () => {
        button.style.backgroundColor = "#7c52cc";
    });
    button.addEventListener("mouseout", () => {
        button.style.backgroundColor = "#6639ba";
    });

    button.addEventListener("click", () => {
        handleImportRepo(owner, repo, repoData, currentUser, githubToken);
    });

    container.appendChild(button);
    return container;
}
