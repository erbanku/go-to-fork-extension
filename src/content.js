// Run when page loads
init();

// Listen for GitHub's soft navigation (SPA-style page changes)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        init();
    }
}).observe(document, { subtree: true, childList: true });

async function init() {
    // Wait a bit for GitHub's dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Remove any existing buttons
    const existingFork = document.getElementById("go-to-fork-container");
    if (existingFork) existingFork.remove();
    const existingUpstream = document.getElementById(
        "back-to-upstream-container"
    );
    if (existingUpstream) existingUpstream.remove();

    const url = window.location.href;

    // Check if we're on a GitHub repo page (matches all repo pages including issues, PRs, files, etc.)
    const repoMatch = url.match(
        /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/|$)/
    );
    if (!repoMatch) return;

    const [, owner, repo] = repoMatch;

    // Don't run if missing owner/repo
    if (!owner || !repo) return;

    try {
        await injectButtons(owner, repo);
    } catch (error) {
        console.log("Go to Fork extension error:", error);
    }
}

async function injectButtons(owner, repo) {
    // Get stored GitHub token
    const { githubToken } = await chrome.storage.sync.get("githubToken");

    if (!githubToken) {
        console.log(
            "Go to Fork: No GitHub token configured. Please click the extension icon to set up."
        );
        return;
    }

    // Get current user info
    const userResp = await fetch("https://api.github.com/user", {
        headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${githubToken}`,
        },
    });

    if (!userResp.ok) {
        console.log(
            "Go to Fork: Authentication failed. Please check your token in the extension settings."
        );
        return;
    }

    const userData = await userResp.json();
    const currentUser = userData.login;

    // Get the current repo details
    const repoResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
            headers: {
                Accept: "application/vnd.github.v3+json",
                Authorization: `token ${githubToken}`,
            },
        }
    );

    if (!repoResp.ok) return;

    const repoData = await repoResp.json();

    // Check if current repo is a fork and show "Back to Upstream" button
    if (repoData.fork && repoData.parent) {
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

    // Don't show "Go to Fork" button if we're on our own repo
    if (owner === currentUser) return;

    // Find all forks owned by the user
    const forks = await findAllForks(
        currentUser,
        sourceOwner,
        sourceRepo,
        githubToken
    );

    if (forks.length > 0) {
        addForkButton(forks);
    }
}

async function findAllForks(currentUser, sourceOwner, sourceRepo, githubToken) {
    const forks = [];
    const userOrgs = new Set();
    userOrgs.add(currentUser);

    console.log(`Go to Fork: Searching forks for ${sourceOwner}/${sourceRepo}`);

    // Get user's organizations
    try {
        const orgsResp = await fetch(
            "https://api.github.com/user/orgs?per_page=100",
            {
                headers: {
                    Accept: "application/vnd.github.v3+json",
                    Authorization: `token ${githubToken}`,
                },
            }
        );

        if (orgsResp.ok) {
            const orgs = await orgsResp.json();
            orgs.forEach((org) => userOrgs.add(org.login));
        }
    } catch (e) {
        console.log("Go to Fork: Could not fetch organizations:", e);
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
                }
            );

            if (!forksResp.ok) {
                console.log(
                    `Go to Fork: Failed to fetch forks (status ${forksResp.status})`
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
        console.log("Go to Fork: Could not fetch forks:", e);
    }

    if (forks.length > 0) {
        console.log(`Go to Fork: Found ${forks.length} fork(s)`);
    }
    return forks;
}

function addForkButton(forks) {
    // Prevent duplicate buttons
    if (document.getElementById("go-to-fork-container")) return;

    // Simply append to the main repo header - fast and reliable
    const repoHeader =
        document.querySelector(".AppHeader-context-full") ||
        document.querySelector(".AppHeader") ||
        document.querySelector("header");

    if (!repoHeader) {
        console.log("Go to Fork: Could not find header");
        return;
    }

    const container = createForkButtonContainer(forks);

    // Add with some margin to separate from other elements
    container.style.marginLeft = "16px";
    container.style.display = "inline-block";

    repoHeader.appendChild(container);
    console.log("Go to Fork: Button added successfully");
}

function createForkButtonContainer(forks) {
    const container = document.createElement("div");
    container.id = "go-to-fork-container";
    container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0;
    position: relative;
    margin-right: 8px;
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
      gap: 4px;
      padding: 5px 12px;
      background-color: #238636;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
        button.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
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
      gap: 4px;
      padding: 5px 12px;
      background-color: #238636;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px 0 0 6px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
        mainBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path>
      </svg>
      Go to Fork
    `;

        const dropBtn = document.createElement("button");
        dropBtn.type = "button";
        dropBtn.className = "btn btn-sm";
        dropBtn.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 6px;
      background-color: #238636;
      color: white;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-left: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 0 6px 6px 0;
      cursor: pointer;
      font-size: 10px;
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

    const repoHeader =
        document.querySelector(".AppHeader-context-full") ||
        document.querySelector(".AppHeader") ||
        document.querySelector("header");

    if (!repoHeader) {
        console.log("Go to Fork: Could not find header for upstream button");
        return;
    }

    const container = createUpstreamButtonContainer(
        upstreamUrl,
        upstreamFullName
    );

    container.style.marginLeft = "16px";
    container.style.display = "inline-block";

    repoHeader.appendChild(container);
    console.log("Go to Fork: Upstream button added successfully");
}

function createUpstreamButtonContainer(upstreamUrl, upstreamFullName) {
    const container = document.createElement("div");
    container.id = "back-to-upstream-container";
    container.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0;
    position: relative;
    margin-right: 8px;
    vertical-align: middle;
  `;

    const button = document.createElement("a");
    button.href = upstreamUrl;
    button.className = "btn btn-sm";
    button.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      background-color: #0969da;
      color: white !important;
      border: 1px solid rgba(27, 31, 36, 0.15);
      border-radius: 6px;
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      line-height: 20px;
    `;
    button.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
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
