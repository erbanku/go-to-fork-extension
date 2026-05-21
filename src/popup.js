// DOM elements
const setupView = document.getElementById("setup-view");
const configuredView = document.getElementById("configured-view");
const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save-btn");
const changeTokenBtn = document.getElementById("change-token-btn");
const removeTokenBtn = document.getElementById("remove-token-btn");
const statusDiv = document.getElementById("status");
const quickLinksContainer = document.getElementById("quick-links-container");
const configuredLinksContainer = document.getElementById(
    "configured-links-container"
);
const editLinksBtn = document.getElementById("edit-links-btn");
const toggleTokenBtn = document.getElementById("toggle-token");
const toggleDisplayTokenBtn = document.getElementById("toggle-display-token");
const copyTokenBtn = document.getElementById("copy-token-btn");
const displayTokenSpan = document.getElementById("display-token");
const formViewBtn = document.getElementById("form-view-btn");
const jsonViewBtn = document.getElementById("json-view-btn");
const formViewContainer = document.getElementById("form-view-container");
const jsonViewContainer = document.getElementById("json-view-container");
const jsonEditor = document.getElementById("json-editor");
const jsonError = document.getElementById("json-error");
const jsonLineNumbers = document.getElementById("json-line-numbers");
const saveJsonBtn = document.getElementById("save-json-btn");
const resetLinksBtn = document.getElementById("reset-links-btn");

// Settings checkboxes
const setupImportBtn = document.getElementById("setup-setting-import-btn");
const setupQuickLinks = document.getElementById("setup-setting-quick-links");
const setupForkUpstream = document.getElementById(
    "setup-setting-fork-upstream"
);
const setupRawPage = document.getElementById("setup-setting-raw-page");
const setupCommitPRButtons = document.getElementById("setup-setting-commit-pr-buttons");
const setupHotkeys = document.getElementById("setup-setting-hotkeys");
const configImportBtn = document.getElementById("setting-import-btn");
const configQuickLinks = document.getElementById("setting-quick-links");
const configForkUpstream = document.getElementById("setting-fork-upstream");
const configRawPage = document.getElementById("setting-raw-page");
const configCommitPRButtons = document.getElementById("setting-commit-pr-buttons");
const configHotkeys = document.getElementById("setting-hotkeys");
const editHotkeysBtn = document.getElementById("edit-hotkeys-btn");
const hotkeyEditorDiv = document.getElementById("hotkeys-editor");
const hotkeysList = document.getElementById("hotkeys-list");
const saveHotkeysBtn = document.getElementById("save-hotkeys-btn");
const cancelHotkeysBtn = document.getElementById("cancel-hotkeys-btn");

let savedToken = "";
let currentView = "form";
const QUICK_LINKS_STORAGE_KEY = "quickAccessLinks";
const QUICK_LINKS_STORAGE_AREA_KEY = "quickAccessLinksStorageArea";

function isQuotaExceededError(error) {
    const runtimeError = chrome.runtime && chrome.runtime.lastError;
    const message =
        (error && typeof error.message === "string" && error.message) ||
        (runtimeError &&
            typeof runtimeError.message === "string" &&
            runtimeError.message) ||
        "";

    return /quota|MAX_ITEMS|MAX_WRITE_OPERATIONS/i.test(message);
}

function syncGet(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result);
        });
    });
}

function localGet(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(result);
        });
    });
}

function syncSet(items) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.set(items, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function localSet(items) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function syncRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

function localRemove(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve();
        });
    });
}

async function loadQuickAccessLinks() {
    const [syncResult, localResult] = await Promise.all([
        syncGet([QUICK_LINKS_STORAGE_KEY, QUICK_LINKS_STORAGE_AREA_KEY]),
        localGet([QUICK_LINKS_STORAGE_KEY, QUICK_LINKS_STORAGE_AREA_KEY]),
    ]);

    if (
        localResult[QUICK_LINKS_STORAGE_AREA_KEY] === "local" &&
        Array.isArray(localResult[QUICK_LINKS_STORAGE_KEY])
    ) {
        return localResult[QUICK_LINKS_STORAGE_KEY];
    }

    if (
        syncResult[QUICK_LINKS_STORAGE_AREA_KEY] === "sync" &&
        Array.isArray(syncResult[QUICK_LINKS_STORAGE_KEY])
    ) {
        return syncResult[QUICK_LINKS_STORAGE_KEY];
    }

    if (Array.isArray(syncResult[QUICK_LINKS_STORAGE_KEY])) {
        return syncResult[QUICK_LINKS_STORAGE_KEY];
    }

    if (Array.isArray(localResult[QUICK_LINKS_STORAGE_KEY])) {
        return localResult[QUICK_LINKS_STORAGE_KEY];
    }

    return [];
}

async function saveQuickAccessLinks(links) {
    try {
        await syncSet({
            [QUICK_LINKS_STORAGE_KEY]: links,
            [QUICK_LINKS_STORAGE_AREA_KEY]: "sync",
        });
        await localRemove([
            QUICK_LINKS_STORAGE_KEY,
            QUICK_LINKS_STORAGE_AREA_KEY,
        ]);
    } catch (error) {
        if (!isQuotaExceededError(error)) {
            throw error;
        }

        console.log(
            "Quick access links too large for sync storage, using local storage"
        );
        await localSet({
            [QUICK_LINKS_STORAGE_KEY]: links,
            [QUICK_LINKS_STORAGE_AREA_KEY]: "local",
        });
        await syncRemove([
            QUICK_LINKS_STORAGE_KEY,
            QUICK_LINKS_STORAGE_AREA_KEY,
        ]);
    }
}

// Reset links by fetching organizations again
resetLinksBtn.addEventListener("click", async () => {
    if (!savedToken) {
        showStatus(
            "No GitHub token found. Please configure your token first.",
            "error"
        );
        return;
    }

    resetLinksBtn.textContent = "Fetching...";
    resetLinksBtn.disabled = true;

    try {
        const orgsResponse = await fetch("https://api.github.com/user/orgs", {
            headers: {
                Authorization: `token ${savedToken}`,
                Accept: "application/vnd.github.v3+json",
            },
        });

        if (orgsResponse.ok) {
            const orgs = await orgsResponse.json();
            const defaultColors = [
                "green",
                "yellow",
                "blue",
                "purple",
                "green",
            ];
            const newLinks = orgs.slice(0, 5).map((org, idx) => ({
                name: org.login,
                link_num: `LINK ${idx + 1}`,
                url: `https://github.com/${org.login}`,
                color: defaultColors[idx],
            }));

            // Save and update UI
            saveQuickAccessLinks(newLinks).then(() => {
                initQuickLinks(newLinks);
                jsonEditor.value = JSON.stringify(newLinks, null, 2);
                updateJsonLineNumbers();
                showStatus(
                    `✓ Reset to ${newLinks.length} organization link(s)!`,
                    "success"
                );
                setTimeout(() => {
                    statusDiv.style.display = "none";
                }, 2000);
            }).catch((error) => {
                showStatus(
                    `Failed to reset quick access links: ${error.message}`,
                    "error"
                );
            });
        } else {
            showStatus(
                "Failed to fetch organizations. Check your token permissions.",
                "error"
            );
        }
    } catch (err) {
        console.error("Error fetching organizations:", err);
        showStatus("Network error. Please try again.", "error");
    } finally {
        resetLinksBtn.textContent = "Reset to Org Links";
        resetLinksBtn.disabled = false;
    }
});

// Update JSON line numbers with Link labels
function updateJsonLineNumbers() {
    const lines = jsonEditor.value.split("\n");
    let lineNumbers = "";
    let linkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Detect start of a new object
        if (line.startsWith("{")) {
            lineNumbers += `<div>Link ${linkIndex + 1}</div>`;
            linkIndex++;
        } else {
            lineNumbers += "<div></div>";
        }
    }

    jsonLineNumbers.innerHTML = lineNumbers;
}

// Sync JSON editor scroll with line numbers
jsonEditor.addEventListener("scroll", () => {
    jsonLineNumbers.scrollTop = jsonEditor.scrollTop;
});

// Update line numbers when JSON changes
jsonEditor.addEventListener("input", () => {
    updateJsonLineNumbers();
});

// Toggle between form and JSON view
formViewBtn.addEventListener("click", () => {
    currentView = "form";
    formViewBtn.classList.add("active");
    jsonViewBtn.classList.remove("active");
    formViewContainer.classList.remove("hidden");
    jsonViewContainer.classList.remove("active");
    jsonError.classList.remove("show");

    // Sync from JSON to form and save to storage if valid
    try {
        const jsonData = JSON.parse(jsonEditor.value || "[]");
        const quickLinksData = extractQuickLinksFromJsonInput(jsonData);
        const limitedData = normalizeQuickLinksFromJson(quickLinksData);
        saveQuickAccessLinks(limitedData).catch((error) => {
            console.error("Failed to save quick links from JSON view:", error);
        });
        initQuickLinks(limitedData);
    } catch (e) {
        // Keep existing form data if JSON is invalid
    }
});

jsonViewBtn.addEventListener("click", () => {
    currentView = "json";
    jsonViewBtn.classList.add("active");
    formViewBtn.classList.remove("active");
    formViewContainer.classList.add("hidden");
    jsonViewContainer.classList.add("active");
    jsonError.classList.remove("show");

    // Sync from form to JSON
    const links = collectQuickLinks();
    jsonEditor.value = JSON.stringify(links, null, 2);
    updateJsonLineNumbers();
});

// Save JSON immediately on blur (handles popup-close and focus-away cases)
jsonEditor.addEventListener("blur", () => {
    try {
        const data = JSON.parse(jsonEditor.value || "[]");
        const quickLinksData = extractQuickLinksFromJsonInput(data);
        const normalized = normalizeQuickLinksFromJson(quickLinksData);
        for (const item of normalized) {
            if (item.url && !isValidGitHubUrl(item.url)) return;
        }
        persistQuickLinksAndSyncUI(normalized);
        jsonError.classList.remove("show");
    } catch (e) {
        // Invalid JSON - don't save
    }
});

// Save JSON button - save and sync form view
saveJsonBtn.addEventListener("click", () => {
    try {
        const data = JSON.parse(jsonEditor.value || "[]");
        const allSettingsData = extractAllSettingsFromJsonInput(data);
        const quickLinksData = extractQuickLinksFromJsonInput(data);
        const limitedData = normalizeQuickLinksFromJson(quickLinksData);
        for (const item of limitedData) {
            if (item.url && !isValidGitHubUrl(item.url)) {
                throw new Error(`Invalid GitHub URL: ${item.url}`);
            }
        }
        const extraStorage = {};
        if (allSettingsData) {
            if (typeof allSettingsData.githubToken === "string") {
                extraStorage.githubToken = allSettingsData.githubToken;
            }
            if (allSettingsData.extensionSettings) {
                extraStorage.extensionSettings = allSettingsData.extensionSettings;
            }
        }
        const includesFullSettings = !!allSettingsData;
        persistQuickLinksAndSyncUI(
            limitedData,
            true,
            extraStorage,
            includesFullSettings
        );
    } catch (e) {
        jsonError.textContent = `Invalid JSON: ${e.message}`;
        jsonError.classList.add("show");
    }
});

// Validate and auto-save JSON
jsonEditor.addEventListener(
    "input",
    debounce(() => {
        try {
            const data = JSON.parse(jsonEditor.value || "[]");
            const quickLinksData = extractQuickLinksFromJsonInput(data);

            // Validate structure
            if (!Array.isArray(quickLinksData)) throw new Error("Invalid JSON format");

            // Validate URLs
            for (const item of quickLinksData) {
                if (item.url && !isValidGitHubUrl(item.url)) {
                    throw new Error(`Invalid GitHub URL: ${item.url}`);
                }
            }

            // Limit to 5 items
            const limitedData = normalizeQuickLinksFromJson(quickLinksData);

            // Save if valid
            saveQuickAccessLinks(limitedData).then(() => {
                console.log("Quick links saved from JSON");
                jsonError.classList.remove("show");
            }).catch(() => {
                // Keep existing editor state if save fails.
            });
        } catch (e) {
            jsonError.textContent = `Invalid JSON: ${e.message}`;
            jsonError.classList.add("show");
        }
    }, 1000)
);

// Copy token to clipboard
copyTokenBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(savedToken);
        copyTokenBtn.classList.add("copied");
        const originalTitle = copyTokenBtn.title;
        copyTokenBtn.title = "Copied!";

        setTimeout(() => {
            copyTokenBtn.classList.remove("copied");
            copyTokenBtn.title = originalTitle;
        }, 2000);
    } catch (err) {
        console.error("Failed to copy token:", err);
    }
});

// Toggle password visibility in setup view
toggleTokenBtn.addEventListener("click", () => {
    const isPassword = tokenInput.type === "password";
    tokenInput.type = isPassword ? "text" : "password";
    document.getElementById("eye-icon").style.display = isPassword
        ? "none"
        : "block";
    document.getElementById("eye-slash-icon").style.display = isPassword
        ? "block"
        : "none";
});

// Toggle token visibility in configured view
toggleDisplayTokenBtn.addEventListener("click", () => {
    const isHidden = displayTokenSpan.textContent.startsWith("••");
    if (isHidden) {
        displayTokenSpan.textContent = savedToken;
        document.getElementById("eye-icon-display").style.display = "none";
        document.getElementById("eye-slash-icon-display").style.display =
            "block";
    } else {
        displayTokenSpan.textContent = "••••••••••••••••••••";
        document.getElementById("eye-icon-display").style.display = "block";
        document.getElementById("eye-slash-icon-display").style.display =
            "none";
    }
});

// Color palette options
const colorOptions = [
    {
        name: "Blue",
        value: "blue",
        bg: "#ddf4ff",
        border: "#54aeff",
        text: "#0969da",
        hover: "#b6e3ff",
    },
    {
        name: "Yellow",
        value: "yellow",
        bg: "#fff8c5",
        border: "#d4a72c",
        text: "#7d4e00",
        hover: "#fae17d",
    },
    {
        name: "Green",
        value: "green",
        bg: "#dcffe4",
        border: "#4ac26b",
        text: "#116329",
        hover: "#aceebb",
    },
    {
        name: "Purple",
        value: "purple",
        bg: "#fbefff",
        border: "#d4a5db",
        text: "#8250df",
        hover: "#f2d8ff",
    },
];

// Initialize quick links inputs
function initQuickLinks(links = []) {
    quickLinksContainer.innerHTML = "";
    const defaultColors = ["green", "yellow", "blue", "purple", "green"];

    for (let i = 0; i < 5; i++) {
        const link = links[i] || { name: "", url: "", color: defaultColors[i] };
        const linkItem = document.createElement("div");
        linkItem.className = "quick-link-item";

        const colorOptionsHtml = colorOptions
            .map(
                (opt) =>
                    `<option value="${opt.value}" ${
                        (link.color || defaultColors[i]) === opt.value
                            ? "selected"
                            : ""
                    }>${opt.name}</option>`
            )
            .join("");

        linkItem.innerHTML = `
            <div class="quick-link-label">Link ${i + 1}</div>
            <input type="text"
                   class="link-name"
                   placeholder="Name (optional, default: #${i + 1})"
                   value="${link.name || ""}">
            <input type="text"
                   class="link-url"
                   placeholder="GitHub URL (e.g., https://github.com/org)"
                   value="${link.url || ""}">
            <select class="link-color" style="width: 100%; padding: 8px 12px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 13px; box-sizing: border-box; margin-top: 6px;">
                ${colorOptionsHtml}
            </select>`;
        quickLinksContainer.appendChild(linkItem);
    }

    // Add auto-save on input change
    const allInputs = quickLinksContainer.querySelectorAll("input, select");
    allInputs.forEach((input) => {
        input.addEventListener(
            "input",
            debounce(() => {
                autoSaveQuickLinks();
            }, 1000)
        );
        input.addEventListener(
            "change",
            debounce(() => {
                autoSaveQuickLinks();
            }, 500)
        );
    });
}

// Debounce function to prevent too frequent saves
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Auto-save quick links
function autoSaveQuickLinks() {
    const quickLinks = collectQuickLinks();

    // Validate URLs before saving
    for (const link of quickLinks) {
        if (link.url && !isValidGitHubUrl(link.url)) {
            console.log(`Invalid URL, not auto-saving: ${link.url}`);
            return;
        }
    }

    saveQuickAccessLinks(quickLinks).then(() => {
        console.log("Quick links auto-saved");
        // Sync to JSON editor if currently in form view
        if (currentView === "form") {
            jsonEditor.value = JSON.stringify(quickLinks, null, 2);
            updateJsonLineNumbers();
        }
    }).catch((error) => {
        console.error("Failed to auto-save quick links:", error);
    });
}

// Display configured links
function displayConfiguredLinks(links = []) {
    const activeLinks = links.filter((link) => link.url);
    if (activeLinks.length === 0) {
        configuredLinksContainer.innerHTML =
            '<div class="help-text">No quick access links configured</div>';
        return;
    }

    configuredLinksContainer.innerHTML = activeLinks
        .map((link, idx) => {
            const displayName = link.name || `#${links.indexOf(link) + 1}`;
            const colorScheme =
                colorOptions.find((c) => c.value === link.color) ||
                colorOptions[0];
            return `
            <div class="configured-link-item" style="border-left: 4px solid ${colorScheme.border};">
                <strong>${displayName}</strong> <span style="color: ${colorScheme.text}; font-size: 11px; font-weight: 600;">[${colorScheme.name}]</span><br>
                <a href="${link.url}" target="_blank">${link.url}</a>
            </div>
        `;
        })
        .join("");
}

// Validate GitHub URL
function isValidGitHubUrl(url) {
    if (!url) return true;
    try {
        const parsed = new URL(url);
        return parsed.hostname === "github.com";
    } catch {
        return false;
    }
}

function extractQuickLinksFromJsonInput(data) {
    if (Array.isArray(data)) {
        if (
            data.length === 1 &&
            data[0] &&
            typeof data[0] === "object" &&
            Array.isArray(data[0].quickAccessLinks)
        ) {
            return data[0].quickAccessLinks;
        }
        return data;
    }

    if (data && typeof data === "object" && Array.isArray(data.quickAccessLinks)) {
        return data.quickAccessLinks;
    }

    throw new Error("JSON must be quick links array or object with quickAccessLinks");
}

function extractAllSettingsFromJsonInput(data) {
    let payload = data;
    if (
        Array.isArray(payload) &&
        payload.length === 1 &&
        payload[0] &&
        typeof payload[0] === "object" &&
        !Array.isArray(payload[0])
    ) {
        payload = payload[0];
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    if (
        !Object.prototype.hasOwnProperty.call(payload, "githubToken") &&
        !Object.prototype.hasOwnProperty.call(payload, "extensionSettings") &&
        !Object.prototype.hasOwnProperty.call(payload, "quickAccessLinks")
    ) {
        return null;
    }
    return payload;
}

function normalizeQuickLinksFromJson(data) {
    const allowedColors = new Set(["blue", "yellow", "green", "purple"]);
    return data
        .slice(0, 5)
        .map((item, idx) => {
            const rawUrl =
                item && (item.url ?? item.link ?? item.href)
                    ? String(item.url ?? item.link ?? item.href)
                    : "";
            const normalizedColor =
                item && item.color && allowedColors.has(String(item.color))
                    ? String(item.color)
                    : "blue";
            return {
                name: (item && item.name ? String(item.name) : "").trim(),
                link_num: `LINK ${idx + 1}`,
                url: rawUrl.trim(),
                color: normalizedColor,
            };
        })
        .filter((item) => item.url || item.name);
}

async function persistQuickLinksAndSyncUI(
    links,
    showButtonFeedback = false,
    extraStorage = {},
    showAllSettingsInEditor = false
) {
    try {
        await saveQuickAccessLinks(links);
        if (Object.keys(extraStorage).length > 0) {
            await syncSet(extraStorage);
        }

        const [storedSync, persisted] = await Promise.all([
            syncGet(["githubToken", "extensionSettings"]),
            loadQuickAccessLinks(),
        ]);

        initQuickLinks(persisted);
        displayConfiguredLinks(persisted);
        if (showAllSettingsInEditor) {
            jsonEditor.value = JSON.stringify(
                {
                    githubToken: storedSync.githubToken || "",
                    quickAccessLinks: persisted,
                    extensionSettings: storedSync.extensionSettings || {},
                },
                null,
                2
            );
        } else {
            jsonEditor.value = JSON.stringify(persisted, null, 2);
        }
        updateJsonLineNumbers();
        if (typeof storedSync.githubToken === "string") {
            savedToken = storedSync.githubToken;
            displayTokenSpan.textContent = savedToken
                ? "••••••••••••••••••••"
                : "";
        }
        applySettingsToCheckboxes(storedSync.extensionSettings || {});
        jsonError.classList.remove("show");
        showStatus("Quick access links saved!", "success");

        if (!showButtonFeedback) {
            return;
        }
        const orig = saveJsonBtn.textContent;
        saveJsonBtn.textContent = "Saved!";
        saveJsonBtn.disabled = true;
        setTimeout(() => {
            saveJsonBtn.textContent = orig;
            saveJsonBtn.disabled = false;
        }, 1500);
    } catch (error) {
        jsonError.textContent = `Save failed: ${error.message}`;
        jsonError.classList.add("show");
    }
}

function applySettingsToCheckboxes(rawSettings) {
    const settings = {
        showImportButton: true,
        showQuickAccessLinks: true,
        showForkUpstreamButtons: true,
        showRawPageButtons: true,
        showCommitPRButtons: true,
        enableHotkeys: true,
        ...(rawSettings || {}),
    };
    setupImportBtn.checked = settings.showImportButton;
    setupQuickLinks.checked = settings.showQuickAccessLinks;
    setupForkUpstream.checked = settings.showForkUpstreamButtons;
    setupRawPage.checked = settings.showRawPageButtons;
    setupCommitPRButtons.checked = settings.showCommitPRButtons;
    setupHotkeys.checked = settings.enableHotkeys;
    configImportBtn.checked = settings.showImportButton;
    configQuickLinks.checked = settings.showQuickAccessLinks;
    configForkUpstream.checked = settings.showForkUpstreamButtons;
    configRawPage.checked = settings.showRawPageButtons;
    configCommitPRButtons.checked = settings.showCommitPRButtons;
    configHotkeys.checked = settings.enableHotkeys;
}

// Collect quick links from inputs
function collectQuickLinks() {
    const links = [];
    const nameInputs = quickLinksContainer.querySelectorAll(".link-name");
    const urlInputs = quickLinksContainer.querySelectorAll(".link-url");
    const colorSelects = quickLinksContainer.querySelectorAll(".link-color");

    for (let i = 0; i < 5; i++) {
        const name = nameInputs[i].value.trim();
        const url = urlInputs[i].value.trim();
        const color = colorSelects[i].value;

        if (url || name) {
            links.push({
                name,
                link_num: `LINK ${i + 1}`,
                url,
                color,
            });
        }
    }
    return links;
}

// Load saved token on popup open
Promise.all([
    syncGet(["githubToken", "extensionSettings"]),
    loadQuickAccessLinks(),
]).then(async ([data, quickAccessLinks]) => {
        // Load settings
        const defaultSettings = {
            showImportButton: true,
            showQuickAccessLinks: true,
            showForkUpstreamButtons: true,
            showRawPageButtons: true,
            showCommitPRButtons: true,
            enableHotkeys: true,
        };
        const settings = {
            ...defaultSettings,
            ...(data.extensionSettings || {}),
        };

        // Set checkbox states in both views
        setupImportBtn.checked = settings.showImportButton;
        setupQuickLinks.checked = settings.showQuickAccessLinks;
        setupForkUpstream.checked = settings.showForkUpstreamButtons;
        setupRawPage.checked = settings.showRawPageButtons;
        setupCommitPRButtons.checked = settings.showCommitPRButtons;
        configImportBtn.checked = settings.showImportButton;
        configQuickLinks.checked = settings.showQuickAccessLinks;
        configForkUpstream.checked = settings.showForkUpstreamButtons;
        configRawPage.checked = settings.showRawPageButtons;
        configCommitPRButtons.checked = settings.showCommitPRButtons;
        setupHotkeys.checked = settings.enableHotkeys;
        configHotkeys.checked = settings.enableHotkeys;

        if (data.githubToken) {
            savedToken = data.githubToken;
            displayTokenSpan.textContent = "••••••••••••••••••••";
            // If we have a token but no quick links, fetch orgs as defaults
            if (
                !quickAccessLinks ||
                quickAccessLinks.length === 0 ||
                quickAccessLinks.every((link) => !link.url)
            ) {
                try {
                    const orgsResponse = await fetch(
                        "https://api.github.com/user/orgs",
                        {
                            headers: {
                                Authorization: `token ${data.githubToken}`,
                                Accept: "application/vnd.github.v3+json",
                            },
                        }
                    );

                    if (orgsResponse.ok) {
                        const orgs = await orgsResponse.json();
                        const defaultColors = [
                            "green",
                            "yellow",
                            "blue",
                            "purple",
                            "green",
                        ];
                        const defaultLinks = orgs
                            .slice(0, 5)
                            .map((org, idx) => ({
                                name: org.login,
                                url: `https://github.com/${org.login}`,
                                color: defaultColors[idx],
                            }));

                        // Save default links
                        await saveQuickAccessLinks(defaultLinks);
                        displayConfiguredLinks(defaultLinks);
                        initQuickLinks(defaultLinks);
                    } else {
                        displayConfiguredLinks(quickAccessLinks || []);
                        initQuickLinks(quickAccessLinks || []);
                    }
                } catch (err) {
                    console.log("Could not fetch organizations");
                    displayConfiguredLinks(quickAccessLinks || []);
                    initQuickLinks(quickAccessLinks || []);
                }
            } else {
                displayConfiguredLinks(quickAccessLinks || []);
                initQuickLinks(quickAccessLinks || []);
            }
            showConfiguredView();
        } else {
            document.getElementById("token-section").style.display = "block";
            document.getElementById("links-section").style.display = "block";
            showSetupView();
            initQuickLinks(quickAccessLinks || []);
        }
    })
    .catch((error) => {
        console.error("Failed to load popup state:", error);
    });

// Save token
saveBtn.addEventListener("click", async () => {
    const tokenSectionVisible =
        document.getElementById("token-section").style.display !== "none";
    const linksSectionVisible =
        document.getElementById("links-section").style.display !== "none";

    const token = tokenInput.value.trim();
    const quickLinks = collectQuickLinks();

    // Validate quick links URLs if links section is visible
    if (linksSectionVisible) {
        for (const link of quickLinks) {
            if (link.url && !isValidGitHubUrl(link.url)) {
                showStatus(`Invalid GitHub URL: ${link.url}`, "error");
                return;
            }
        }
    }

    // If only editing links (token section hidden)
    if (!tokenSectionVisible) {
        saveQuickAccessLinks(quickLinks).then(() => {
            showStatus("Quick access links saved!", "success");
            setTimeout(() => {
                showConfiguredView();
                displayConfiguredLinks(quickLinks);
            }, 1000);
        }).catch((error) => {
            showStatus(`Failed to save quick access links: ${error.message}`, "error");
        });
        return;
    }

    if (!token) {
        // Allow saving just quick links without token
        saveQuickAccessLinks(quickLinks).then(() => {
            showStatus("Quick access links saved!", "success");
        }).catch((error) => {
            showStatus(`Failed to save quick access links: ${error.message}`, "error");
        });
        return;
    }

    // Validate token format
    if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
        showStatus(
            'Invalid token format. Token should start with "ghp_" or "github_pat_"',
            "error"
        );
        return;
    }

    // Test the token
    saveBtn.textContent = "Validating...";
    saveBtn.disabled = true;

    try {
        const response = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.v3+json",
            },
        });

        if (response.ok) {
            const user = await response.json();

            // Check if token has required scopes
            const scopes = response.headers.get("X-OAuth-Scopes") || "";
            const scopeList = scopes
                .split(",")
                .map((scope) => scope.trim())
                .filter(Boolean);
            const hasPublicRepo =
                scopeList.includes("public_repo") || scopeList.includes("repo");
            const hasReadOrg = scopeList.includes("read:org");
            const hasReadPackages =
                scopeList.includes("read:packages") ||
                scopeList.includes("write:packages") ||
                scopeList.includes("delete:packages");

            if (!hasPublicRepo || !hasReadOrg || !hasReadPackages) {
                showStatus(
                    'Token is valid but missing required permissions. Please generate a new token with "repo" (or "public_repo"), "read:org", and "read:packages" scopes.',
                    "error"
                );
                saveBtn.textContent = "Save Token";
                saveBtn.disabled = false;
                return;
            }

            // If quick links are empty, fetch user's organizations as defaults
            let linksToSave = quickLinks;
            if (
                quickLinks.length === 0 ||
                quickLinks.every((link) => !link.url)
            ) {
                try {
                    const orgsResponse = await fetch(
                        "https://api.github.com/user/orgs",
                        {
                            headers: {
                                Authorization: `token ${token}`,
                                Accept: "application/vnd.github.v3+json",
                            },
                        }
                    );

                    if (orgsResponse.ok) {
                        const orgs = await orgsResponse.json();
                        const defaultColors = [
                            "green",
                            "yellow",
                            "blue",
                            "purple",
                            "green",
                        ];
                        linksToSave = orgs.slice(0, 5).map((org, idx) => ({
                            name: org.login,
                            url: `https://github.com/${org.login}`,
                            color: defaultColors[idx],
                        }));
                    }
                } catch (err) {
                    console.log(
                        "Could not fetch organizations, using empty links"
                    );
                }
            }

            // Save token and quick links
            await saveQuickAccessLinks(linksToSave);
            await syncSet({ githubToken: token });
            showStatus(
                `✓ Token saved! Authenticated as ${user.login}`,
                "success"
            );
            setTimeout(() => {
                showConfiguredView();
                displayConfiguredLinks(linksToSave);
            }, 1500);
        } else {
            const error = await response.json();
            showStatus(
                `Invalid token: ${error.message || "Authentication failed"}`,
                "error"
            );
            saveBtn.textContent = "Save Token";
            saveBtn.disabled = false;
        }
    } catch (err) {
        showStatus(
            "Network error. Please check your connection and try again.",
            "error"
        );
        saveBtn.textContent = "Save Token";
        saveBtn.disabled = false;
    }
});

// Change token
changeTokenBtn.addEventListener("click", async () => {
    loadQuickAccessLinks().then((quickAccessLinks) => {
        initQuickLinks(quickAccessLinks || []);
        tokenInput.value = "";
        tokenInput.disabled = false;
        document.getElementById("token-section").style.display = "block";
        document.getElementById("links-section").style.display = "none";
        showSetupView();
        tokenInput.focus();
    }).catch((error) => {
        showStatus(`Failed to load quick access links: ${error.message}`, "error");
    });
});

// Remove token
removeTokenBtn.addEventListener("click", () => {
    if (
        confirm(
            "Are you sure you want to remove your GitHub token? The extension will stop working until you add a new token."
        )
    ) {
        chrome.storage.sync.remove("githubToken", () => {
            showStatus("Token removed", "success");
            tokenInput.value = "";
            setTimeout(() => {
                showSetupView();
            }, 1000);
        });
    }
});

// Edit links button
editLinksBtn.addEventListener("click", () => {
    loadQuickAccessLinks().then((quickAccessLinks) => {
        initQuickLinks(quickAccessLinks || []);
        document.getElementById("token-section").style.display = "none";
        document.getElementById("links-section").style.display = "block";
        showSetupView();
    }).catch((error) => {
        showStatus(`Failed to load quick access links: ${error.message}`, "error");
    });
});

// Helper functions
function showSetupView() {
    setupView.style.display = "block";
    configuredView.style.display = "none";
    const tokenSection = document.getElementById("token-section");
    const linksSection = document.getElementById("links-section");

    // Determine which section is visible and set button text accordingly
    if (tokenSection.style.display === "none") {
        saveBtn.textContent = "Save Links";
    } else if (linksSection.style.display === "none") {
        saveBtn.textContent = "Save Token";
    } else {
        saveBtn.textContent = "Save Token";
    }

    saveBtn.disabled = false;
    statusDiv.className = "status";
    statusDiv.textContent = "";
}

function showConfiguredView() {
    setupView.style.display = "none";
    configuredView.style.display = "block";
    statusDiv.className = "status";
    statusDiv.textContent = "";
}

function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

// Allow Enter key to save
tokenInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        saveBtn.click();
    }
});

// Settings change handlers
function saveSettings() {
    const settings = {
        showImportButton: setupImportBtn.checked,
        showQuickAccessLinks: setupQuickLinks.checked,
        showForkUpstreamButtons: setupForkUpstream.checked,
        showRawPageButtons: setupRawPage.checked,
        showCommitPRButtons: setupCommitPRButtons.checked,
        enableHotkeys: setupHotkeys.checked,
    };
    chrome.storage.sync.set({ extensionSettings: settings });
}

function saveConfiguredSettings() {
    const settings = {
        showImportButton: configImportBtn.checked,
        showQuickAccessLinks: configQuickLinks.checked,
        showForkUpstreamButtons: configForkUpstream.checked,
        showRawPageButtons: configRawPage.checked,
        showCommitPRButtons: configCommitPRButtons.checked,
        enableHotkeys: configHotkeys.checked,
    };
    chrome.storage.sync.set({ extensionSettings: settings });
}

// Setup view settings
setupImportBtn.addEventListener("change", saveSettings);
setupQuickLinks.addEventListener("change", saveSettings);
setupForkUpstream.addEventListener("change", saveSettings);
setupRawPage.addEventListener("change", saveSettings);
setupCommitPRButtons.addEventListener("change", saveSettings);
setupHotkeys.addEventListener("change", saveSettings);

// Configured view settings
configImportBtn.addEventListener("change", saveConfiguredSettings);
configQuickLinks.addEventListener("change", saveConfiguredSettings);
configForkUpstream.addEventListener("change", saveConfiguredSettings);
configRawPage.addEventListener("change", saveConfiguredSettings);
configCommitPRButtons.addEventListener("change", saveConfiguredSettings);
configHotkeys.addEventListener("change", saveConfiguredSettings);

// ===============================================
// Custom Hotkeys Management
// ===============================================

const customHotkeysList = document.getElementById("custom-hotkeys-list");
const addHotkeyBtn = document.getElementById("add-hotkey-btn");

let customHotkeys = [];

// Load custom hotkeys from storage
async function loadCustomHotkeys() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["extensionSettings"], (result) => {
            const settings = result.extensionSettings || {};
            customHotkeys = settings.customHotkeys || [];
            resolve(customHotkeys);
        });
    });
}

// Render custom hotkeys editor
async function renderCustomHotkeys() {
    await loadCustomHotkeys();
    customHotkeysList.innerHTML = '';

    if (customHotkeys.length === 0) {
        customHotkeysList.innerHTML = '<div style="text-align: center; color: #57606a; padding: 12px; font-size: 12px;">No custom hotkeys. Click "+ Add Custom Hotkey" to create one.</div>';
        return;
    }

    customHotkeys.forEach((hotkey, index) => {
        const item = document.createElement('div');
        item.className = 'custom-hotkey-item';

        item.innerHTML = `
            <div class="hotkey-input-label">Keys (max 10 chars, case-insensitive)</div>
            <input type="text" class="hotkey-keys" placeholder="e.g., gl, gpr, mykey" value="${hotkey.keys || ''}" maxlength="10" data-index="${index}" />
            <div class="hotkey-input-label">URL</div>
            <input type="text" class="hotkey-url" placeholder="https://example.com" value="${hotkey.url || ''}" data-index="${index}" />
            <button class="custom-hotkey-remove" data-index="${index}">Remove</button>
        `;

        customHotkeysList.appendChild(item);
    });

    // Add event listeners for remove buttons
    document.querySelectorAll('.custom-hotkey-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            customHotkeys.splice(index, 1);
            renderCustomHotkeys();
        });
    });
}

// Add new custom hotkey
addHotkeyBtn.addEventListener('click', () => {
    customHotkeys.push({ keys: '', url: '' });
    renderCustomHotkeys();
});

// Show custom hotkeys editor
editHotkeysBtn.addEventListener('click', async () => {
    await renderCustomHotkeys();
    hotkeyEditorDiv.style.display = 'block';
    editHotkeysBtn.style.display = 'none';
});

// Save custom hotkeys
saveHotkeysBtn.addEventListener('click', async () => {
    // Collect all hotkey data from inputs
    const updatedHotkeys = [];
    document.querySelectorAll('.custom-hotkey-item').forEach(item => {
        const keysInput = item.querySelector('.hotkey-keys');
        const urlInput = item.querySelector('.hotkey-url');
        const keys = keysInput.value.trim().toLowerCase();
        const url = urlInput.value.trim();

        if (keys && url) {
            // Validate URL
            try {
                new URL(url);
                updatedHotkeys.push({ keys, url });
            } catch (e) {
                showStatus(`Invalid URL: ${url}`, 'error');
                return;
            }
        }
    });

    // Load existing settings and update customHotkeys
    const result = await new Promise((resolve) => {
        chrome.storage.sync.get(['extensionSettings'], resolve);
    });
    const settings = result.extensionSettings || {};
    settings.customHotkeys = updatedHotkeys;

    // Save back to extensionSettings
    chrome.storage.sync.set({ extensionSettings: settings }, () => {
        hotkeyEditorDiv.style.display = 'none';
        editHotkeysBtn.style.display = 'block';
        showStatus('✓ Custom hotkeys saved successfully!', 'success');
        setTimeout(() => statusDiv.style.display = 'none', 2000);
    });
});

// Cancel custom hotkeys editor
cancelHotkeysBtn.addEventListener('click', () => {
    hotkeyEditorDiv.style.display = 'none';
    editHotkeysBtn.style.display = 'block';
});

// ===============================================
// All Settings JSON Editor
// ===============================================

const viewAllSettingsBtn = document.getElementById("view-all-settings-btn");
const allSettingsEditor = document.getElementById("all-settings-editor");
const allSettingsJson = document.getElementById("all-settings-json");
const allSettingsLineNumbers = document.getElementById("all-settings-line-numbers");
const allSettingsError = document.getElementById("all-settings-error");
const saveAllSettingsBtn = document.getElementById("save-all-settings-btn");
const cancelAllSettingsBtn = document.getElementById("cancel-all-settings-btn");

// Update line numbers for all settings JSON
function updateAllSettingsLineNumbers() {
    const lines = allSettingsJson.value.split('\n');
    allSettingsLineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
}

// Show all settings editor
viewAllSettingsBtn.addEventListener('click', async () => {
    // Load all settings
    const [result, quickAccessLinks] = await Promise.all([
        syncGet(['githubToken', 'extensionSettings']),
        loadQuickAccessLinks(),
    ]);

    const allSettings = {
        githubToken: result.githubToken || '',
        quickAccessLinks,
        extensionSettings: result.extensionSettings || {}
    };

    allSettingsJson.value = JSON.stringify(allSettings, null, 2);
    updateAllSettingsLineNumbers();
    allSettingsEditor.style.display = 'block';
    viewAllSettingsBtn.style.display = 'none';
    allSettingsError.classList.remove('show');
});

// Save all settings from JSON
saveAllSettingsBtn.addEventListener('click', async () => {
    try {
        const allSettings = JSON.parse(allSettingsJson.value);

        // Validate structure
        if (typeof allSettings !== 'object') {
            throw new Error('Settings must be an object');
        }

        await saveQuickAccessLinks(allSettings.quickAccessLinks || []);
        await syncSet({
            githubToken: allSettings.githubToken || '',
            extensionSettings: allSettings.extensionSettings || {}
        });

        allSettingsEditor.style.display = 'none';
        viewAllSettingsBtn.style.display = 'block';
        showStatus('✓ All settings saved successfully!', 'success');
        setTimeout(() => {
            statusDiv.style.display = 'none';
            // Reload the page to show updated settings
            location.reload();
        }, 1500);
    } catch (e) {
        allSettingsError.textContent = `Error: ${e.message}`;
        allSettingsError.classList.add('show');
    }
});

// Cancel all settings editor
cancelAllSettingsBtn.addEventListener('click', () => {
    allSettingsEditor.style.display = 'none';
    viewAllSettingsBtn.style.display = 'block';
    allSettingsError.classList.remove('show');
});

// Update line numbers on input
allSettingsJson.addEventListener('input', updateAllSettingsLineNumbers);

// ===============================================
// Legacy Hotkey Management (Keep for compatibility)
// ===============================================

// Load hotkeys on page load
document.addEventListener('DOMContentLoaded', async () => {
    const settings = await new Promise((resolve) => {
        chrome.storage.sync.get(['extensionSettings'], (result) => {
            resolve(result.extensionSettings || {});
        });
    });
    if (configHotkeys) {
        configHotkeys.checked = settings.enableHotkeys !== false;
    }
    if (setupHotkeys) {
        setupHotkeys.checked = settings.enableHotkeys !== false;
    }
});
