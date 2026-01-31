



let dashboardActive = window.location.hash.includes("/dashboard");
let navLock = false;
const prevKey = 'previous_close_data';
let autoSyncInProgress = false;
let lastAutoSyncTime = 0;
let currentUserKey = null;


const IN_IFRAME = window.self !== window.top;
if (IN_IFRAME) {
    console.log("[MS Iframe] Detected in iframe. Monitoring for sync task...");


    handleIframeScrapeTasks();


    window.addEventListener('hashchange', () => {
        console.log("[MS Iframe] Hash changed to:", window.location.hash);
        handleIframeScrapeTasks();
    });
}

async function handleIframeScrapeTasks() {
    const hash = window.location.hash;
    if (hash.includes("/portfolio")) {
        console.log("[MS Iframe] On Portfolio page. Waiting for table...");
        const tableFound = await waitForTableWithRetry(10000);
        if (tableFound) {
            const data = scrapePortfolioTable();
            if (data) {
                console.log("[MS Iframe] Scraped Portfolio, sending to parent.");
                window.parent.postMessage({ type: "MS_IFRAME_DATA", dataType: "PORTFOLIO", data }, "*");
            }
        }
    } else if (hash.includes("/purchase")) {
        console.log("[MS Iframe] On Purchase page. Waiting for table...");
        const tableFound = await waitForTableWithRetry(10000);
        if (tableFound) {

            const xpath = "//*[contains(text(), 'My WACC') or contains(text(), 'My Wacc')]";
            const matchingElement = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (matchingElement) matchingElement.click();

            await new Promise(resolve => setTimeout(resolve, 2000));
            const waccData = await scrapeWACCTable();
            if (waccData) {
                console.log("[MS Iframe] Scraped WACC, sending to parent.");
                window.parent.postMessage({ type: "MS_IFRAME_DATA", dataType: "WACC", data: waccData }, "*");
            }
        }
    }
}



function getCurrentUserKey() {

    const clientCode = sessionStorage.getItem('clientCode') ||
        sessionStorage.getItem('clientId') ||
        sessionStorage.getItem('demat') ||
        sessionStorage.getItem('boid');

    if (clientCode) {
        return clientCode;
    }


    const userInfoElements = document.querySelectorAll('.user-info, .profile-info, .client-code, [class*="boid"], [class*="client"]');
    for (const el of userInfoElements) {
        const text = el.innerText?.trim();
        if (text && /^\d{16}$/.test(text)) {
            return text;
        }
    }


    const localKeys = ['clientCode', 'clientId', 'demat', 'boid', 'currentUser'];
    for (const key of localKeys) {
        const val = localStorage.getItem(key);
        if (val) {
            return val;
        }
    }


    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const val = sessionStorage.getItem(key);

        if (val && /^\d{16}$/.test(val)) {
            return val;
        }
    }


    const profileDropdown = document.querySelector('.header-profile .dropdown-toggle, .user-profile');
    if (profileDropdown) {

        const text = profileDropdown.innerText;
        const match = text.match(/\d{16}/);
        if (match) {
            localStorage.setItem('currentUser', match[0]);
            return match[0];
        }
    }


    const dematInput = document.querySelector('input[name="demat"], input[name="boid"], input[id="demat"], input[id="boid"]');
    if (dematInput && dematInput.value) {
        if (/^\d{16}$/.test(dematInput.value)) {
            localStorage.setItem('currentUser', dematInput.value);
            return dematInput.value;
        }
    }


    const profileText = document.body.innerText;

    const boidMatch = profileText.match(/(?:BOID|Demat)\s*[:\-]?\s*(\d{16})/i);
    if (boidMatch) {
        localStorage.setItem('currentUser', boidMatch[1]);
        return boidMatch[1];
    }

    return 'default';
}


async function getUserStorage(keys) {
    const userKey = getCurrentUserKey();
    currentUserKey = userKey;

    const prefixedKeys = Array.isArray(keys)
        ? keys.map(k => `${userKey}_${k}`)
        : [`${userKey}_${keys}`];

    const result = await chrome.storage.local.get(prefixedKeys);


    const unprefixed = {};
    for (const key of (Array.isArray(keys) ? keys : [keys])) {
        unprefixed[key] = result[`${userKey}_${key}`];
    }
    return unprefixed;
}

async function setUserStorage(data) {
    const userKey = getCurrentUserKey();
    currentUserKey = userKey;

    const prefixed = {};
    for (const [key, val] of Object.entries(data)) {
        prefixed[`${userKey}_${key}`] = val;
    }


    prefixed['activeUserKey'] = userKey;

    return chrome.storage.local.set(prefixed);
}


function notifyActiveUser() {
    const userKey = getCurrentUserKey();
    currentUserKey = userKey;

    if (userKey && userKey !== 'default') {
        chrome.runtime.sendMessage({ type: "SET_ACTIVE_USER", userKey: userKey });
    }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TRIGGER_SYNC") {
        syncAllDataInstantly()
            .then(() => {
                sendResponse({ status: "Sync completed successfully!" });
            })
            .catch((err) => {
                sendResponse({ status: "Sync failed: " + err.message });
            });
        return true;
    }
});


const currencyStringToNumber = (currencyString) => parseFloat(currencyString.replace(/Rs\.|,/g, ''));

function roundedTenth(number, price) {
    const value = number * 0.2;
    let rounded;
    if (value < 100) {
        rounded = Math.round(value / 10) * 10;
    } else if (value < 1000) {
        rounded = Math.round(value / 100) * 100;
    } else if (value < 10000) {
        rounded = Math.round(value / 1000) * 1000;
    } else {
        rounded = Math.round(value / 10000) * 10000;
    }
    rounded = Math.max(price > 100 ? 10 : 100, rounded);
    return rounded;
}

const isWithinTradingHours = () => {
    const now = new Date();
    const nepalTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kathmandu" }));
    const dayOfWeek = nepalTime.getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6) return false;
    const time = nepalTime.getHours() * 100 + nepalTime.getMinutes();
    return (time >= 1029 && time <= 1046) || (time >= 1059 && time <= 1501);
};



const getAuthToken = () => {
    return sessionStorage.getItem('Authorization') ||
        sessionStorage.getItem('authorization') ||
        sessionStorage.getItem('token') ||
        sessionStorage.getItem('accessToken') ||
        localStorage.getItem('Authorization') ||
        localStorage.getItem('authorization') ||
        localStorage.getItem('token');
};

async function fetchMeroShare(endpoint, payload = {}) {
    const token = getAuthToken();
    if (!token) throw new Error("Not logged in or token expired.");

    const url = `https://webbackend.cdsc.com.np/api/meroShare/${endpoint}`;



    try {
        console.log(`[MS Sync] Attempting Direct Fetch for: ${endpoint}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`[MS Sync] Direct Fetch Successful: ${endpoint}`);
            return data;
        }

        const errText = await response.text();
        console.warn(`[MS Sync] Direct Fetch Status ${response.status} for ${endpoint}. Falling back to Background Proxy.`);

        if (errText.includes("Request Rejected")) {
            console.error("[MS Sync] Direct Fetch rejected by WAF. Support ID:", errText.match(/Support ID: (\d+)/)?.[1]);
        }
    } catch (err) {
        console.warn(`[MS Sync] Direct Fetch Error for ${endpoint}: ${err.message}. Falling back to Background Proxy.`);
    }


    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error("Request timed out (Background script unresponsive)"));
        }, 15000);

        try {
            chrome.runtime.sendMessage({
                type: "FETCH_MEROSHARE",
                url: url,
                options: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify(payload)
                }
            }, (response) => {
                clearTimeout(timeoutId);

                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (!response) {
                    return reject(new Error("No response from background script"));
                }
                if (!response.ok) {

                    console.error("[MS Sync] Background Proxy Rejected. Body:", response.text);
                    return reject(new Error(`Sync Error: HTTP ${response.status} - ${response.text.substring(0, 50)}...`));
                }
                try {
                    resolve(JSON.parse(response.text));
                } catch (e) {
                    console.error("[MS Sync] Background JSON Parse Error. Body:", response.text);
                    reject(new Error(`Invalid JSON response: ${response.text.substring(0, 100)}...`));
                }
            });
        } catch (err) {
            clearTimeout(timeoutId);
            reject(err);
        }
    });
}


function scrapePortfolioTable() {
    const table = document.querySelector("table");
    if (!table) return null;

    const rows = table.querySelectorAll("tbody tr");
    if (!rows || rows.length === 0) return null;

    let portfolio = [];
    rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 7) return;

        const symbol = cells[1]?.innerText?.trim();
        const units = parseFloat(cells[2]?.innerText?.replace(/,/g, '')) || 0;
        const prevClose = parseFloat(cells[3]?.innerText?.replace(/,/g, '')) || 0;
        const ltp = parseFloat(cells[5]?.innerText?.replace(/,/g, '')) || 0;
        const valueText = cells[6]?.innerText?.replace(/,/g, '') || '0';
        const value = parseFloat(valueText) || (units * ltp);

        if (!symbol || symbol.toLowerCase().includes('total') || symbol === 'S.N.') return;

        portfolio.push({ symbol, units, prevClose, ltp, value });
    });

    return portfolio.length > 0 ? portfolio : null;
}


async function scrapeWACCTable() {
    const table = document.querySelector("table");
    if (!table) return {};

    let waccMap = {};


    const showAllSelected = await selectShowAllEntries();
    if (showAllSelected) {
        await new Promise(resolve => setTimeout(resolve, 800));
    }


    const scrapeCurrentPage = () => {
        const rows = table.querySelectorAll("tbody tr");
        if (!rows || rows.length === 0) return;

        rows.forEach((row, idx) => {
            const cells = row.querySelectorAll("td");

            if (cells.length < 4) return;


            const symbol = cells[1]?.innerText?.trim();
            const waccText = cells[3]?.innerText?.trim();
            const wacc = parseFloat(waccText?.replace(/,/g, '')) || 0;

            if (!symbol || symbol.toLowerCase().includes('total') || symbol === 'S.N.' || symbol === 'Script') return;

            if (wacc > 0) {
                waccMap[symbol] = wacc;
            }
        });
    };


    scrapeCurrentPage();


    if (!showAllSelected) {
        let pageCount = 1;
        const maxPages = 10;

        while (pageCount < maxPages) {

            const nextBtn = findNextPageButton();
            if (!nextBtn) break;

            nextBtn.click();
            await new Promise(resolve => setTimeout(resolve, 600));
            pageCount++;

            const prevCount = Object.keys(waccMap).length;
            scrapeCurrentPage();
            const newCount = Object.keys(waccMap).length;



            if (newCount === prevCount) break;
        }
    }

    return waccMap;
}


async function selectShowAllEntries() {

    const selectors = [
        'select[name*="length"]',
        'select[aria-label*="entries"]',
        '.dataTables_length select',
        'select.form-control',
        'mat-select',
        'select'
    ];

    for (const selector of selectors) {
        const selects = document.querySelectorAll(selector);
        for (const select of selects) {

            const options = select.querySelectorAll('option');
            let hasAll = false;
            let maxOption = null;
            let maxValue = 0;

            for (const opt of options) {
                const text = opt.innerText.toLowerCase();
                const val = parseInt(opt.value);

                if (text.includes('all') || val === -1) {
                    hasAll = opt;
                } else if (!isNaN(val) && val > maxValue) {
                    maxValue = val;
                    maxOption = opt;
                }
            }


            if (hasAll) {
                select.value = hasAll.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            } else if (maxOption && maxValue >= 50) {
                select.value = maxOption.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
    }
    return false;
}


function findNextPageButton() {

    const selectors = [
        '.pagination .next:not(.disabled) a',
        '.pagination li:not(.disabled) a[aria-label="Next"]',
        '.paginate_button.next:not(.disabled)',
        'button[aria-label="Next page"]:not([disabled])',
        '.mat-paginator-navigation-next:not([disabled])',
        'a.page-link[aria-label="Next"]:not(.disabled)',
        '.pagination-next:not(.disabled)',
        'li.next:not(.disabled) a'
    ];

    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) return btn;
    }


    const allLinks = document.querySelectorAll('.pagination a, .pagination button, [class*="pagina"] a, [class*="pagina"] button');
    for (const link of allLinks) {
        const text = link.innerText.toLowerCase();
        const parent = link.parentElement;
        const isDisabled = parent?.classList.contains('disabled') || link.disabled || link.classList.contains('disabled');

        if (!isDisabled && (text.includes('next') || text === '>' || text === '»' || text === '›')) {
            return link;
        }
    }

    return null;
}


async function attemptAutoFetchBOID() {
    try {
        console.log("[MS Sync] Attempting to auto-fetch BOID via API...");
        const res = await fetchMeroShare('ownDetail/', {});

        // Extract and save DOB if available
        const dob = res.dob || res.dateOfBirth || res.birthDate || (res.object && (res.object.dob || res.object.dateOfBirth));
        if (dob) {
            console.log("[MS Sync] User DOB found:", dob);
            const userKey = getCurrentUserKey() || 'default';
            await new Promise((resolve) => {
                chrome.storage.local.get([userKey], (data) => {
                    const userData = data[userKey] || {};
                    userData.userDOB = dob;
                    chrome.storage.local.set({ [userKey]: userData }, resolve);
                });
            });
        }

        const returnedBoid = res.demat || res.boid || res.clientCode;

        if (returnedBoid && /^\d{16}$/.test(returnedBoid)) {
            console.log("[MS Sync] Auto-fetched BOID successfully:", returnedBoid);
            localStorage.setItem('currentUser', returnedBoid);
            return returnedBoid;
        }


        if (res.object && res.object.demat) {
            const b = res.object.demat;
            if (/^\d{16}$/.test(b)) {
                localStorage.setItem('currentUser', b);
                return b;
            }
        }

    } catch (e) {
        console.warn("[MS Sync] Failed to auto-fetch BOID:", e);
    }
    return null;
}


async function syncViaAPI() {
    let userKey = getCurrentUserKey();


    if (!userKey || userKey === 'default' || !/^\d{16}$/.test(userKey)) {
        userKey = await attemptAutoFetchBOID();
    }

    console.log("[MS Sync] Starting API Sync for user:", userKey);

    // Always try to fetch and save DOB
    try {
        const ownDetailRes = await fetchMeroShare('ownDetail/', {});
        console.log("[MS Sync] ownDetail response:", JSON.stringify(ownDetailRes).substring(0, 500));
        const dob = ownDetailRes.dob || ownDetailRes.dateOfBirth || ownDetailRes.birthDate ||
            (ownDetailRes.object && (ownDetailRes.object.dob || ownDetailRes.object.dateOfBirth || ownDetailRes.object.birthDate));
        if (dob) {
            console.log("[MS Sync] User DOB found:", dob);
            const dobUserKey = userKey || 'default';
            await new Promise((resolve) => {
                chrome.storage.local.get([dobUserKey], (data) => {
                    const userData = data[dobUserKey] || {};
                    userData.userDOB = dob;
                    chrome.storage.local.set({ [dobUserKey]: userData }, resolve);
                });
            });
        } else {
            console.log("[MS Sync] No DOB found in ownDetail response");
        }
    } catch (e) {
        console.warn("[MS Sync] Failed to fetch DOB:", e);
    }


    const portfolioPayload = {
        "sortBy": "script",
        "demat": [userKey],
        "clientCode": [userKey],
        "page": 1,
        "size": 500,
        "sortAsc": true,
        "searchSpec": [],
        "attributes": ["weight", "value", "sector", "total_cost"]
    };

    const portfolioRes = await fetchMeroShare('View/myPortfolio/', portfolioPayload);

    const rawPortfolio = portfolioRes.meroShareMyPortfolio || portfolioRes.content || [];

    if (!rawPortfolio || rawPortfolio.length === 0) throw new Error("API returned empty portfolio.");

    const portfolioData = rawPortfolio.map(p => ({
        symbol: p.script,
        units: parseFloat(p.currentBalance),
        ltp: parseFloat(p.lastTransactionPrice),
        value: parseFloat(p.valueOfLastTransPrice)
    }));



    const waccPayload = {
        "demat": [userKey],
        "clientCode": [userKey],
        "page": 1,
        "size": 500,
        "sortAsc": true,
        "searchSpec": []
    };

    const waccRes = await fetchMeroShare('View/myPurchase/', waccPayload);
    const rawWacc = waccRes.meroShareMyPurchase || waccRes.content || [];


    const waccMap = {};
    rawWacc.forEach(w => {

        const sym = w.scrip || w.script;
        const rate = parseFloat(w.userWacc || w.wacc || 0);
        if (sym && rate > 0) {
            waccMap[sym] = rate;
        }
    });

    return { portfolioData, waccData: waccMap };
}


async function syncAllDataInstantly() {
    if (!chrome.runtime?.id) {
        console.error("[MS Sync] Extension context lost. Please refresh the page.");
        return;
    }

    const syncBtn = document.getElementById('ms-sync-btn');
    const originalBtnContent = syncBtn ? syncBtn.innerHTML : '';

    console.log("[MS Sync] Triggering Market Data Refresh...");
    chrome.runtime.sendMessage({ type: "REFRESH_MARKET_DATA" });

    try {
        if (syncBtn) {
            syncBtn.innerText = ' Syncing...';
            const spinIcon = document.createElement('span');
            spinIcon.className = 'material-icons-round';
            spinIcon.style.animation = 'spin 1s linear infinite';
            spinIcon.innerText = 'sync';
            syncBtn.prepend(spinIcon);
            syncBtn.disabled = true;
        }

        console.log("[MS Sync] Starting Hidden Navigation Sync...");


        const shield = createStickySyncShield();
        autoSyncInProgress = true;

        let portfolioData = null;
        let waccData = {};
        const startHash = window.location.hash;


        if (!startHash.includes('/portfolio')) {
            window.location.hash = '#/portfolio';
            await new Promise(resolve => setTimeout(resolve, 2000));
        }


        await waitForTableWithRetry(8000);
        await new Promise(resolve => setTimeout(resolve, 500));

        portfolioData = scrapePortfolioTable();
        if (!portfolioData || portfolioData.length === 0) {
            throw new Error("Could not read portfolio. Please ensure you're logged in.");
        }


        window.location.hash = '#/purchase';
        await new Promise(resolve => setTimeout(resolve, 2000));

        const tabClicked = await clickTab('wacc', 4000);
        if (tabClicked) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }


        await waitForTableWithRetry(8000);
        await new Promise(resolve => setTimeout(resolve, 500));

        waccData = await scrapeWACCTable();


        const processedPortfolio = portfolioData.map(item => {
            const cost = waccData[item.symbol] || 0;
            const investment = item.units * cost;
            return {
                symbol: item.symbol,
                units: item.units,
                prevClose: item.prevClose,
                ltp: item.ltp,
                cost: cost,
                investment: investment,
                value: item.value,
                gainLoss: item.value - investment
            };
        });

        await setUserStorage({
            portfolio: processedPortfolio,
            waccData: waccData,
            lastUpdated: new Date().toISOString(),
            isSyncing: false,
            tempPortfolio: null
        });


        window.location.hash = '#/dashboard';
        autoSyncInProgress = false;

        if (shield) shield.remove();

        if (dashboardActive) {
            setTimeout(showDashboard, 1000);
        }

    } catch (err) {
        console.error("[MS Sync] Hidden Sync Failed:", err);
        alert("Sync failed: " + err.message);
        autoSyncInProgress = false;
        const s = document.getElementById('ms-sync-shield');
        if (s) s.remove();
    } finally {
        if (syncBtn) {
            syncBtn.innerHTML = originalBtnContent;
            syncBtn.disabled = false;
        }
    }
}

function createStickySyncShield() {
    let shield = document.getElementById('ms-sync-shield');
    if (shield) return shield;

    shield = document.createElement('div');
    shield.id = 'ms-sync-shield';


    const panel = document.getElementById('MS-PANEL');
    const target = panel || document.body;

    shield.style.cssText = `
        position: fixed !important;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.7);
        backdrop-filter: blur(8px);
        z-index: 9999999 !important;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        color: white; font-family: 'Inter', sans-serif;
        padding: 24px; text-align: center;
    `;

    shield.innerHTML = `
        <div style="width: 60px; height: 60px; border: 5px solid rgba(255,255,255,0.1); border-top: 5px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <h2 style="margin-top: 24px; font-weight: 700; font-size: 1.5rem; letter-spacing: -0.5px;">Syncing Portfolio...</h2>
        <p style="margin-top: 8px; color: #94a3b8; font-weight: 500;">Gathering your latest portfolio insights...</p>
        <style> @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } </style>
    `;

    target.appendChild(shield);
    return shield;
}

async function autoSyncOnLogin() {
    if (autoSyncInProgress) return;

    const now = Date.now();
    if (now - lastAutoSyncTime < 30000) return;

    const token = getAuthToken();
    if (!token) return;

    autoSyncInProgress = true;
    lastAutoSyncTime = now;

    try {
        await syncAllDataInstantly();
    } catch (err) {
    } finally {
        autoSyncInProgress = false;
    }
}





async function waitForTableWithRetry(maxWait = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const table = document.querySelector("table tbody tr");
        if (table) return true;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
}



let isDarkMode = false;
let numbersHidden = false;
let scripNamesHidden = false;


function exportToPDF(stocks, totalValue, totalInvestment, totalPL, totalPLPercent, sectorData) {
    const date = new Date().toLocaleString('en-NP', {
        dateStyle: 'full',
        timeStyle: 'short'
    });


    const theme = isDarkMode ? {
        bg: '#0f172a',
        cardBg: '#1e293b',
        text: '#f8fafc',
        textDim: '#94a3b8',
        border: '#334155'
    } : {
        bg: '#f8fafc',
        cardBg: '#ffffff',
        text: '#1e293b',
        textDim: '#64748b',
        border: '#e2e8f0'
    };

    const stockRows = stocks.map(s => {
        const returnAmt = s.value - s.investment;
        const returnPct = s.investment > 0 ? ((returnAmt / s.investment) * 100).toFixed(2) : 0;
        const sector = CONSTANTS.SECTORS[s.symbol] || 'Others';

        const maskNum = (val) => numbersHidden ? '••••' : val;
        const maskName = (val) => scripNamesHidden ? '••••' : val;

        return `
            <tr>
                <td style="font-weight: 600;">${maskName(s.symbol)}</td>
                <td style="color: ${theme.textDim};">${maskName(sector)}</td>
                <td style="text-align: right;">${maskNum(s.units.toLocaleString())}</td>
                <td style="text-align: right;">${maskName(s.ltp.toLocaleString())}</td>
                <td style="text-align: right;">${maskNum(s.cost ? s.cost.toFixed(2) : '0')}</td>
                <td style="text-align: right;">Rs. ${maskNum(Math.round(s.investment).toLocaleString())}</td>
                <td style="text-align: right;">Rs. ${maskNum(Math.round(s.value).toLocaleString())}</td>
                <td style="text-align: right; color: ${returnAmt >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
                    ${returnAmt >= 0 ? '+' : ''}Rs. ${maskNum(Math.round(returnAmt).toLocaleString())} (${returnAmt >= 0 ? '+' : ''}${returnPct}%)
                </td>
            </tr>
        `;
    }).join('');

    const sectorRows = sectorData.map(s => {
        const maskNum = (val) => numbersHidden ? '••••' : val;
        const maskName = (val) => scripNamesHidden ? '••••' : val;
        return `
            <tr>
                <td style="font-weight: 600;">${maskName(s.sector)}</td>
                <td style="text-align: right;">${maskNum(s.count)}</td>
                <td style="text-align: right;">Rs. ${maskNum(Math.round(s.value).toLocaleString())}</td>
                <td style="text-align: right; font-weight: 600;">${maskNum(s.pct)}%</td>
            </tr>
        `;
    }).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Portfolio Report - ${new Date().toLocaleDateString()}</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
                    padding: 40px; 
                    background: ${theme.bg}; 
                    color: ${theme.text};
                    line-height: 1.5;
                }
                h1 { font-size: 2rem; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.5px; }
                .subtitle { color: ${theme.textDim}; font-size: 0.875rem; margin-bottom: 32px; font-weight: 500; }
                .summary { display: flex; gap: 20px; margin-bottom: 32px; }
                .stat-card { 
                    flex: 1; 
                    padding: 24px; 
                    background: ${theme.cardBg}; 
                    border-radius: 16px; 
                    border: 1px solid ${theme.border}; 
                }
                .stat-label { 
                    font-size: 0.7rem; 
                    text-transform: uppercase; 
                    letter-spacing: 1.5px; 
                    color: ${theme.textDim}; 
                    margin-bottom: 8px; 
                    font-weight: 700;
                }
                .stat-value { font-size: 1.75rem; font-weight: 800; }
                .positive { color: #10b981; }
                .negative { color: #ef4444; }
                h2 { 
                    font-size: 0.9rem; 
                    font-weight: 700; 
                    margin: 32px 0 16px; 
                    color: ${theme.text};
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    font-size: 0.8rem; 
                    background: ${theme.cardBg};
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid ${theme.border};
                }
                th { 
                    background: ${isDarkMode ? '#334155' : '#f1f5f9'}; 
                    padding: 14px 12px; 
                    text-align: left; 
                    font-weight: 600; 
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: ${theme.textDim};
                }
                td { 
                    padding: 12px; 
                    border-bottom: 1px solid ${theme.border}; 
                    color: ${theme.text};
                }
                tr:last-child td { border-bottom: none; }
                .footer { 
                    margin-top: 40px; 
                    padding-top: 20px; 
                    border-top: 1px solid ${theme.border}; 
                    font-size: 0.75rem; 
                    color: ${theme.textDim}; 
                    text-align: center; 
                }
                .print-btn { 
                    display: block; 
                    margin: 0 auto 30px; 
                    padding: 14px 28px; 
                    background: #10b981; 
                    color: white; 
                    border: none; 
                    border-radius: 12px; 
                    font-size: 1rem; 
                    font-weight: 600;
                    cursor: pointer;
                    box-shadow: 0 8px 24px rgba(16,185,129,0.3);
                }
                .print-btn:hover { opacity: 0.9; }
                @media print {
                    .no-print { display: none !important; }
                    body { padding: 20px; background: white; color: #1e293b; }
                    .stat-card { background: #f8fafc; border-color: #e2e8f0; }
                    table { background: white; }
                    th { background: #f1f5f9; color: #64748b; }
                    td { color: #1e293b; border-color: #e2e8f0; }
                }
            </style>
        </head>
        <body>
            <div class="no-print" style="text-align: center;">
                <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
            </div>
            
            <h1>Portfolio Analytics</h1>
            <p class="subtitle">● ${stocks.length} Scrips • Generated on ${date}</p>
            
            <div class="summary">
                <div class="stat-card">
                    <div class="stat-label">Total Value</div>
                    <div class="stat-value">Rs. ${Math.round(totalValue).toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Investment</div>
                    <div class="stat-value">Rs. ${Math.round(totalInvestment).toLocaleString()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Profit/Loss</div>
                    <div class="stat-value ${totalPL >= 0 ? 'positive' : 'negative'}">
                        ${totalPL >= 0 ? '+' : ''}Rs. ${Math.round(totalPL).toLocaleString()} (${totalPL >= 0 ? '+' : ''}${totalPLPercent}%)
                    </div>
                </div>
            </div>

            <h2>📈 Holdings Detail</h2>
            <table>
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th>Sector</th>
                        <th style="text-align: right;">Units</th>
                        <th style="text-align: right;">LTP</th>
                        <th style="text-align: right;">WACC</th>
                        <th style="text-align: right;">Investment</th>
                        <th style="text-align: right;">Value</th>
                        <th style="text-align: right;">Return</th>
                    </tr>
                </thead>
                <tbody>
                    ${stockRows}
                </tbody>
            </table>

            <h2>🏢 Sector Distribution</h2>
            <table>
                <thead>
                    <tr>
                        <th>Sector</th>
                        <th style="text-align: right;">Scrips</th>
                        <th style="text-align: right;">Value</th>
                        <th style="text-align: right;">Weight</th>
                    </tr>
                </thead>
                <tbody>
                    ${sectorRows}
                </tbody>
            </table>

            <div class="footer">
                Generated by Mero Share Analytics Extension • github.com/shadowmonarchftw-star/meroshare-analytics
            </div>
        </body>
        </html>
    `;


    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}


function maskNum(value, prefix = '') {
    if (!numbersHidden) return prefix + (typeof value === 'number' ? value.toLocaleString() : value);
    return prefix + '•••••';
}

function showDashboard() {

    if (window.location.hash.includes("/login")) return;
    if (!dashboardActive && !window.location.hash.includes("/dashboard")) return;


    let panel = document.getElementById("MS-PANEL");





    let targetContainer = null;
    const sidebar = document.querySelector('.ms-side-nav, app-sidebar, .sidebar, .left-sidebar');


    if (sidebar && sidebar.parentElement) {
        const parent = sidebar.parentElement;

        for (const child of parent.children) {
            if (child !== sidebar &&
                !child.classList.contains('header') &&
                !child.classList.contains('nav') &&
                child.tagName !== 'APP-HEADER' &&
                child.offsetWidth > 0) {

                targetContainer = child;


                const innerOutlet = targetContainer.querySelector('router-outlet');
                if (innerOutlet && innerOutlet.nextElementSibling) {
                    targetContainer = innerOutlet.nextElementSibling;
                }
                break;
            }
        }
    }


    if (!targetContainer) {
        const candidates = ['app-dashboard', '.main-content', '.content-wrapper', '.container-fluid', '.right_col', '#main'];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && (!sidebar || !el.contains(sidebar))) {
                targetContainer = el;
                break;
            }
        }
    }


    if (!targetContainer) {
        const routerOutlet = document.querySelector('router-outlet');
        if (routerOutlet && routerOutlet.nextElementSibling) {
            targetContainer = routerOutlet.nextElementSibling;
        }
    }

    if (window.location.hash.includes("/dashboard") || (autoSyncInProgress)) {
        console.log("[MS Dashboard] Showing Sticky Dashboard Overlay...");


        if (!panel) {
            panel = document.createElement("div");
            panel.id = "MS-PANEL";
        }

        if (panel.parentElement !== document.body) {
            document.body.appendChild(panel);
        }


        const isMobile = window.innerWidth < 1024;
        const sidebar = document.querySelector('.ms-side-nav, app-sidebar, .sidebar, .left-sidebar');
        const header = document.querySelector('app-header, .header, .top-nav, .navbar');

        const sidebarWidth = (sidebar && !isMobile) ? sidebar.offsetWidth : 0;
        const headerHeight = (header && !isMobile) ? header.offsetHeight : 0;


        panel.style.cssText = `
            position: fixed !important; 
            top: ${headerHeight}px !important;
            left: ${sidebarWidth}px !important;
            right: 0 !important;
            bottom: 0 !important;
            display: block !important;
            z-index: 999999 !important; 
            background: ${isDarkMode ? '#0f172a' : '#f8fafc'};
            padding: ${isMobile ? '16px' : '24px'};
            overflow-y: auto !important;
            opacity: 1;
        `;

        panel.style.display = 'block';


        if (!panel.innerHTML || panel.innerHTML.trim() === '') {
            panel.innerHTML = `
                <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; font-family: 'Inter', sans-serif;">
                    <div style="width: 50px; height: 50px; border: 4px solid ${isDarkMode ? '#334155' : '#e2e8f0'}; border-top: 4px solid #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 20px; color: ${isDarkMode ? '#94a3b8' : '#64748b'}; font-weight: 500; font-size: 1rem; letter-spacing: 0.5px;">Loading Analytics...</p>
                    <style>
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </div>
            `;
        }

    } else {

        panel = document.getElementById("MS-PANEL");
        if (panel) panel.remove();


        if (targetContainer) {
            Array.from(targetContainer.children).forEach(c => {
                if (c.id !== 'MS-PANEL') c.style.display = '';
            });
        }
    }


    if (!document.getElementById('ms-fonts')) {
        const fontLink = document.createElement('link');
        fontLink.id = 'ms-fonts';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);

        const iconLink = document.createElement('link');
        iconLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons+Round';
        iconLink.rel = 'stylesheet';
        document.head.appendChild(iconLink);
    }



    Promise.all([
        getUserStorage(["portfolio", "lastUpdated", "dashboardTheme", "portfolioGoal", "priceAlerts", "scriptNotes", "netWorthHistory", "bonusShares", "userDOB"]),
        chrome.storage.local.get([prevKey, "corporateActions"])
    ]).then(([res, prevData]) => {
        if (res.dashboardTheme !== undefined) {
            isDarkMode = res.dashboardTheme === 'dark';
        }

        const stocks = res.portfolio || [];
        const portfolioGoal = parseFloat(res.portfolioGoal) || 5000000;
        const priceAlerts = res.priceAlerts || [];
        const scriptNotes = res.scriptNotes || {};
        const netWorthHistory = res.netWorthHistory || [];
        const bonusShares = res.bonusShares || {};
        const corporateActions = prevData.corporateActions || [];
        const portfolioActions = corporateActions.filter(a => stocks.some(s => s.symbol === a.symbol));


        let marketData = {};
        try {
            if (prevData[prevKey]) {
                const raw = JSON.parse(prevData[prevKey]);
                if (raw.data) {
                    marketData = raw.data;
                } else {
                    Object.keys(raw).forEach(k => {
                        marketData[k] = { price: raw[k], prev_close: raw[k] };
                    });
                }
            }
        } catch (e) { }

        const getMarketData = (sym) => {
            if (!sym) return null;
            const cleanSym = sym.trim().toUpperCase();
            let data = marketData[cleanSym];
            if (!data) {
                const key = Object.keys(marketData).find(k => k.trim().toUpperCase() === cleanSym);
                if (key) data = marketData[key];
            }
            return data;
        };

        const getLTP = (sym) => {
            const data = getMarketData(sym);
            if (!data) return 0;
            if (typeof data === 'object') return data.price || data.prev_close || 0;
            return parseFloat(data) || 0;
        };

        const getPrevClose = (sym) => {
            const data = getMarketData(sym);
            if (!data) return 0;
            if (typeof data === 'object') return data.prev_close || data.price || 0;
            return parseFloat(data) || 0;
        };

        // Cosmic Insights Helper Functions
        const getZodiacSign = (dateString) => {
            if (!dateString) return null;
            const date = new Date(dateString);
            if (isNaN(date)) return null;
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const zodiacData = [
                { sign: 'Capricorn', symbol: '♑', element: 'Earth', ruling: 'Saturn', start: [12, 22], end: [1, 19], traits: 'Disciplined, Patient, Ambitious', investStyle: 'Long-term value investor', lucky: '8, 10, 28', luckyDay: 'Saturday', compatible: 'Taurus, Virgo' },
                { sign: 'Aquarius', symbol: '♒', element: 'Air', ruling: 'Uranus', start: [1, 20], end: [2, 18], traits: 'Innovative, Independent, Visionary', investStyle: 'Tech & disruptive stocks', lucky: '4, 7, 11', luckyDay: 'Saturday', compatible: 'Gemini, Libra' },
                { sign: 'Pisces', symbol: '♓', element: 'Water', ruling: 'Neptune', start: [2, 19], end: [3, 20], traits: 'Intuitive, Creative, Empathetic', investStyle: 'Goes with gut feeling', lucky: '3, 9, 12', luckyDay: 'Thursday', compatible: 'Cancer, Scorpio' },
                { sign: 'Aries', symbol: '♈', element: 'Fire', ruling: 'Mars', start: [3, 21], end: [4, 19], traits: 'Bold, Energetic, Competitive', investStyle: 'Aggressive growth seeker', lucky: '1, 8, 17', luckyDay: 'Tuesday', compatible: 'Leo, Sagittarius' },
                { sign: 'Taurus', symbol: '♉', element: 'Earth', ruling: 'Venus', start: [4, 20], end: [5, 20], traits: 'Reliable, Patient, Stubborn', investStyle: 'Steady blue-chip holder', lucky: '2, 6, 9', luckyDay: 'Friday', compatible: 'Virgo, Capricorn' },
                { sign: 'Gemini', symbol: '♊', element: 'Air', ruling: 'Mercury', start: [5, 21], end: [6, 20], traits: 'Adaptable, Curious, Quick-witted', investStyle: 'Active trader, diversifier', lucky: '5, 7, 14', luckyDay: 'Wednesday', compatible: 'Libra, Aquarius' },
                { sign: 'Cancer', symbol: '♋', element: 'Water', ruling: 'Moon', start: [6, 21], end: [7, 22], traits: 'Nurturing, Protective, Emotional', investStyle: 'Safety-first defensive picks', lucky: '2, 7, 11', luckyDay: 'Monday', compatible: 'Scorpio, Pisces' },
                { sign: 'Leo', symbol: '♌', element: 'Fire', ruling: 'Sun', start: [7, 23], end: [8, 22], traits: 'Confident, Generous, Leader', investStyle: 'Bold high-visibility stocks', lucky: '1, 3, 10', luckyDay: 'Sunday', compatible: 'Aries, Sagittarius' },
                { sign: 'Virgo', symbol: '♍', element: 'Earth', ruling: 'Mercury', start: [8, 23], end: [9, 22], traits: 'Analytical, Detail-oriented, Practical', investStyle: 'Research-driven fundamentalist', lucky: '5, 14, 23', luckyDay: 'Wednesday', compatible: 'Taurus, Capricorn' },
                { sign: 'Libra', symbol: '♎', element: 'Air', ruling: 'Venus', start: [9, 23], end: [10, 22], traits: 'Balanced, Fair, Harmonious', investStyle: 'Perfectly balanced portfolio', lucky: '6, 15, 24', luckyDay: 'Friday', compatible: 'Gemini, Aquarius' },
                { sign: 'Scorpio', symbol: '♏', element: 'Water', ruling: 'Pluto', start: [10, 23], end: [11, 21], traits: 'Intense, Strategic, Resourceful', investStyle: 'Deep value hunter', lucky: '8, 11, 18', luckyDay: 'Tuesday', compatible: 'Cancer, Pisces' },
                { sign: 'Sagittarius', symbol: '♐', element: 'Fire', ruling: 'Jupiter', start: [11, 22], end: [12, 21], traits: 'Optimistic, Adventurous, Philosophical', investStyle: 'Global & emerging markets', lucky: '3, 7, 9', luckyDay: 'Thursday', compatible: 'Aries, Leo' }
            ];
            for (const z of zodiacData) {
                const [sM, sD] = z.start;
                const [eM, eD] = z.end;
                if (sM === 12 && eM === 1) {
                    if ((month === 12 && day >= sD) || (month === 1 && day <= eD)) return z;
                } else if ((month === sM && day >= sD) || (month === eM && day <= eD)) return z;
            }
            return zodiacData[0];
        };

        const getDailyHoroscope = (zodiac) => {
            if (!zodiac) return '';
            const horoscopes = {
                Aries: ["Bulls may charge, but you're born to ride the market wave!", "Impulsive trades might tempt you—take a breath before clicking.", "Mars fuels your portfolio fire today. Channel that energy wisely!"],
                Taurus: ["Slow and steady wins the portfolio game. Hold your ground!", "Venus smiles on value stocks today—look for hidden gems.", "Your stubbornness is your superpower in volatile markets."],
                Gemini: ["Diversification is your twin advantage today!", "Mercury brings mixed signals—research before you leap.", "Your adaptability helps you profit from market swings."],
                Cancer: ["Trust your gut on blue-chip picks today.", "The Moon guides your emotional investing—balance heart and data.", "Defensive stocks feel like home. Embrace your comfort zone."],
                Leo: ["Time to roar! Bold moves may pay off handsomely.", "The spotlight is on your portfolio—show off those winners!", "Leadership stocks align with your royal energy."],
                Virgo: ["Your analytical eye spots undervalued treasures today.", "Mercury rewards your research—the details matter!", "Perfectionism pays: review your portfolio health."],
                Libra: ["Balance your portfolio like the scales you are!", "Venus favors harmonious diversification today.", "Partnership investments may bring unexpected returns."],
                Scorpio: ["Your intuition about market depths is spot-on today.", "Pluto reveals hidden opportunities—dig deeper!", "High-risk, high-reward plays match your intensity."],
                Sagittarius: ["International stocks expand your horizon today!", "Jupiter brings luck—but wisdom should guide your arrows.", "Adventure in emerging markets awaits the bold."],
                Capricorn: ["Discipline builds empires. Your patience will be rewarded.", "Saturn tests your resolve—stay the course!", "Blue-chip stability matches your ambition."],
                Aquarius: ["Innovative sectors align with your visionary nature.", "Uranus disrupts—look for opportunities in chaos!", "Tech and green energy resonate with your values."],
                Pisces: ["Intuitive picks swim toward profit today.", "Neptune clouds some choices—stick to what you know.", "Creative industries might catch your dreamy attention."]
            };
            const fortunes = horoscopes[zodiac.sign] || ["The cosmos smiles on patient investors today."];
            const today = new Date().toISOString().split('T')[0];
            let hash = 0;
            for (let i = 0; i < (zodiac.sign + today).length; i++) {
                hash = (zodiac.sign + today).charCodeAt(i) + ((hash << 5) - hash);
            }
            return fortunes[Math.abs(hash) % fortunes.length];
        };

        const getStockCosmicAdvice = (symbol) => {
            const adviceList = [
                { advice: "Mercury retrograde suggests caution", emoji: "🔮", mood: "neutral" },
                { advice: "Jupiter aligns favorably—expansion ahead!", emoji: "✨", mood: "bullish" },
                { advice: "Saturn tests your patience here", emoji: "🪐", mood: "bearish" },
                { advice: "Venus brings beautiful gains", emoji: "💫", mood: "bullish" },
                { advice: "Mars energizes this position", emoji: "🔥", mood: "bullish" },
                { advice: "Neptune clouds the picture—clarity needed", emoji: "🌊", mood: "neutral" },
                { advice: "The stars whisper: accumulate slowly", emoji: "⭐", mood: "neutral" },
                { advice: "Pluto transforms losses into lessons", emoji: "🌙", mood: "bearish" },
                { advice: "Uranus sparks unexpected moves", emoji: "⚡", mood: "neutral" },
                { advice: "The Moon favors holding positions", emoji: "🌕", mood: "bullish" }
            ];
            const today = new Date().toISOString().split('T')[0];
            let hash = 0;
            for (let i = 0; i < (symbol + today).length; i++) {
                hash = (symbol + today).charCodeAt(i) + ((hash << 5) - hash);
            }
            return adviceList[Math.abs(hash) % adviceList.length];
        };

        // Chinese Zodiac based on birth year
        const getChineseZodiac = (dateString) => {
            if (!dateString) return null;
            const year = new Date(dateString).getFullYear();
            const animals = [
                { animal: 'Rat', emoji: '🐀', element: 'Water', traits: 'Quick-witted, resourceful' },
                { animal: 'Ox', emoji: '🐂', element: 'Earth', traits: 'Diligent, dependable' },
                { animal: 'Tiger', emoji: '🐅', element: 'Wood', traits: 'Brave, competitive' },
                { animal: 'Rabbit', emoji: '🐇', element: 'Wood', traits: 'Quiet, elegant' },
                { animal: 'Dragon', emoji: '🐉', element: 'Earth', traits: 'Confident, intelligent' },
                { animal: 'Snake', emoji: '🐍', element: 'Fire', traits: 'Enigmatic, intuitive' },
                { animal: 'Horse', emoji: '🐴', element: 'Fire', traits: 'Animated, active' },
                { animal: 'Goat', emoji: '🐐', element: 'Earth', traits: 'Calm, gentle, creative' },
                { animal: 'Monkey', emoji: '🐵', element: 'Metal', traits: 'Sharp, curious' },
                { animal: 'Rooster', emoji: '🐓', element: 'Metal', traits: 'Observant, hardworking' },
                { animal: 'Dog', emoji: '🐕', element: 'Earth', traits: 'Loyal, honest' },
                { animal: 'Pig', emoji: '🐷', element: 'Water', traits: 'Compassionate, generous' }
            ];
            return animals[(year - 4) % 12];
        };

        // Moon Phase Calculator
        const getMoonPhase = () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();

            // Simple moon phase calculation
            const c = Math.floor(365.25 * year);
            const e = Math.floor(30.6 * month);
            const jd = c + e + day - 694039.09;
            const phase = jd / 29.5305882;
            const phaseDay = Math.floor((phase - Math.floor(phase)) * 29.5);

            const phases = [
                { name: 'New Moon', emoji: '🌑', advice: 'Perfect for new investments', energy: 'Fresh starts' },
                { name: 'Waxing Crescent', emoji: '🌒', advice: 'Growth energy - add positions', energy: 'Building' },
                { name: 'First Quarter', emoji: '🌓', advice: 'Take decisive action', energy: 'Action' },
                { name: 'Waxing Gibbous', emoji: '🌔', advice: 'Refine your strategy', energy: 'Refining' },
                { name: 'Full Moon', emoji: '🌕', advice: 'Harvest gains carefully', energy: 'Peak power' },
                { name: 'Waning Gibbous', emoji: '🌖', advice: 'Share wisdom, review', energy: 'Gratitude' },
                { name: 'Last Quarter', emoji: '🌗', advice: 'Release underperformers', energy: 'Letting go' },
                { name: 'Waning Crescent', emoji: '🌘', advice: 'Rest and reflect', energy: 'Surrender' }
            ];
            return phases[Math.floor(phaseDay / 3.7)];
        };

        // Lucky Stock of the Day
        const getLuckyStock = (stocksList, dobString) => {
            if (!stocksList || stocksList.length === 0) return null;
            const today = new Date().toISOString().split('T')[0];
            const seed = (dobString || '') + today;
            let hash = 0;
            for (let i = 0; i < seed.length; i++) {
                hash = seed.charCodeAt(i) + ((hash << 5) - hash);
            }
            return stocksList[Math.abs(hash) % stocksList.length];
        };

        // Lucky Trading Time - personalized based on DOB + element + day
        const getLuckyTime = (zodiac, dobString) => {
            if (!zodiac) return { time: '10:00 - 11:00', period: 'Morning', reason: 'Default trading window' };
            const baseTimes = {
                Fire: { baseHour: 10, period: 'Morning' },
                Earth: { baseHour: 11, period: 'Late Morning' },
                Air: { baseHour: 14, period: 'Afternoon' },
                Water: { baseHour: 15, period: 'Late Afternoon' }
            };
            const base = baseTimes[zodiac.element] || baseTimes.Earth;
            // Add DOB-based offset (birth day affects the exact hour)
            const dobDay = dobString ? new Date(dobString).getDate() : 1;
            const todayOffset = new Date().getDay();
            const hourOffset = ((dobDay + todayOffset) % 3) - 1; // -1, 0, or +1 hour shift
            const startHour = base.baseHour + hourOffset;
            const startMin = (dobDay % 4) * 15; // 0, 15, 30, or 45 minutes
            const endHour = startHour + 1;
            const formatTime = (h, m) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            return {
                time: `${formatTime(startHour, startMin)} - ${formatTime(endHour, startMin)}`,
                period: base.period,
                reason: `Personalized for your birth energy`
            };
        };

        // Daily Energy Level - personalized with DOB
        const getEnergyLevel = (zodiac, dobString) => {
            const dayOfWeek = new Date().getDay();
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const luckyDays = { Sunday: 'Leo', Monday: 'Cancer', Tuesday: 'Aries,Scorpio', Wednesday: 'Gemini,Virgo', Thursday: 'Sagittarius,Pisces', Friday: 'Taurus,Libra', Saturday: 'Capricorn,Aquarius' };
            const todayDay = dayNames[dayOfWeek];
            const isLucky = zodiac && luckyDays[todayDay]?.includes(zodiac.sign);
            // DOB affects base energy
            const dobDay = dobString ? new Date(dobString).getDate() : 15;
            const dobMonth = dobString ? new Date(dobString).getMonth() : 6;
            const baseEnergy = [65, 70, 85, 75, 80, 90, 60][dayOfWeek];
            const dobBonus = ((dobDay + dobMonth) % 15); // 0-14 bonus
            const todayDate = new Date().getDate();
            const dateSync = Math.abs(todayDate - dobDay) < 5 ? 10 : 0; // Bonus if date is near birthday day
            return {
                level: Math.min(100, baseEnergy + (isLucky ? 20 : 0) + dobBonus + dateSync),
                isLucky,
                day: todayDay,
                dateSync: dateSync > 0
            };
        };

        // Lucky Color - personalized with DOB + Chinese Zodiac
        const getLuckyColor = (zodiac, chineseZodiac, dobString) => {
            const colors = [
                { name: 'Emerald Green', hex: '#10b981', meaning: 'Growth & prosperity' },
                { name: 'Royal Purple', hex: '#8b5cf6', meaning: 'Wisdom & intuition' },
                { name: 'Golden Yellow', hex: '#f59e0b', meaning: 'Success & confidence' },
                { name: 'Ocean Blue', hex: '#3b82f6', meaning: 'Calm & clarity' },
                { name: 'Ruby Red', hex: '#ef4444', meaning: 'Energy & action' },
                { name: 'Rose Pink', hex: '#ec4899', meaning: 'Harmony & balance' },
                { name: 'Silver Gray', hex: '#6b7280', meaning: 'Neutrality & patience' },
                { name: 'Teal', hex: '#14b8a6', meaning: 'Balance & renewal' },
                { name: 'Amber', hex: '#d97706', meaning: 'Warmth & courage' }
            ];
            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const dobDay = dobString ? new Date(dobString).getDate() : 1;
            const signOffset = zodiac ? zodiac.sign.charCodeAt(0) : 0;
            const chineseOffset = chineseZodiac ? chineseZodiac.animal.charCodeAt(0) : 0;
            const index = (dayOfYear + dobDay + signOffset + chineseOffset) % colors.length;
            return colors[index];
        };

        // Dynamic Lucky Numbers - changes daily based on DOB
        const getDynamicLuckyNumbers = (zodiac, dobString) => {
            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const dob = dobString ? new Date(dobString) : new Date();
            const dobDay = dob.getDate();
            const dobMonth = dob.getMonth() + 1;
            const dobYear = dob.getFullYear();

            // Generate 3 personalized lucky numbers
            const seed1 = (dayOfYear + dobDay) % 99 + 1;
            const seed2 = (dayOfYear + dobMonth + dobDay) % 99 + 1;
            const seed3 = ((dobYear % 100) + today.getDate()) % 99 + 1;

            // Sort and ensure unique
            const nums = [...new Set([seed1, seed2, seed3])].sort((a, b) => a - b);
            return nums.join(', ');
        };

        // Blended Traits - combines Western + Chinese zodiac
        const getBlendedTraits = (zodiac, chineseZodiac) => {
            if (!zodiac) return 'Mysterious';
            const westernTraits = zodiac.traits.split(', ').slice(0, 2);
            const chineseTraits = chineseZodiac ? chineseZodiac.traits.split(', ').slice(0, 1) : [];
            return [...westernTraits, ...chineseTraits].join(', ');
        };

        // Daily Lucky Quantity for trading
        const getDailyLuckyQuantity = (dobString) => {
            const today = new Date();
            const dob = dobString ? new Date(dobString) : new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
            const dobSum = dob.getDate() + (dob.getMonth() + 1);
            const base = ((dayOfYear * dobSum) % 90) + 10; // 10-99
            return base;
        };

        // ==========================================
        // VEDIC ASTROLOGY (JYOTISH) HELPER FUNCTIONS
        // ==========================================

        // All 12 Vedic Rashis data
        const vedicRashiData = [
            { rashi: 'Mesha', english: 'Aries', symbol: '♈', lord: 'Mangal (Mars)', element: 'Agni (Fire)', guna: 'Rajas', traits: 'Courageous, Energetic, Pioneer', gemstone: 'Red Coral', color: 'Red', mantra: 'Om Kram Kreem Kroum Sah Bhaumaya Namah' },
            { rashi: 'Vrishabha', english: 'Taurus', symbol: '♉', lord: 'Shukra (Venus)', element: 'Prithvi (Earth)', guna: 'Rajas', traits: 'Stable, Sensual, Determined', gemstone: 'Diamond', color: 'White', mantra: 'Om Dram Dreem Droum Sah Shukraya Namah' },
            { rashi: 'Mithuna', english: 'Gemini', symbol: '♊', lord: 'Budha (Mercury)', element: 'Vayu (Air)', guna: 'Rajas', traits: 'Intellectual, Communicative, Versatile', gemstone: 'Emerald', color: 'Green', mantra: 'Om Bram Breem Broum Sah Budhaya Namah' },
            { rashi: 'Karka', english: 'Cancer', symbol: '♋', lord: 'Chandra (Moon)', element: 'Jala (Water)', guna: 'Sattva', traits: 'Nurturing, Intuitive, Emotional', gemstone: 'Pearl', color: 'White', mantra: 'Om Shram Shreem Shroum Sah Chandraya Namah' },
            { rashi: 'Simha', english: 'Leo', symbol: '♌', lord: 'Surya (Sun)', element: 'Agni (Fire)', guna: 'Sattva', traits: 'Royal, Confident, Generous', gemstone: 'Ruby', color: 'Golden', mantra: 'Om Hram Hreem Hroum Sah Suryaya Namah' },
            { rashi: 'Kanya', english: 'Virgo', symbol: '♍', lord: 'Budha (Mercury)', element: 'Prithvi (Earth)', guna: 'Sattva', traits: 'Analytical, Pure, Service-oriented', gemstone: 'Emerald', color: 'Green', mantra: 'Om Bram Breem Broum Sah Budhaya Namah' },
            { rashi: 'Tula', english: 'Libra', symbol: '♎', lord: 'Shukra (Venus)', element: 'Vayu (Air)', guna: 'Tamas', traits: 'Balanced, Artistic, Diplomatic', gemstone: 'Diamond', color: 'White', mantra: 'Om Dram Dreem Droum Sah Shukraya Namah' },
            { rashi: 'Vrishchika', english: 'Scorpio', symbol: '♏', lord: 'Mangal (Mars)', element: 'Jala (Water)', guna: 'Tamas', traits: 'Intense, Transformative, Mysterious', gemstone: 'Red Coral', color: 'Red', mantra: 'Om Kram Kreem Kroum Sah Bhaumaya Namah' },
            { rashi: 'Dhanu', english: 'Sagittarius', symbol: '♐', lord: 'Guru (Jupiter)', element: 'Agni (Fire)', guna: 'Tamas', traits: 'Philosophical, Fortunate, Expansive', gemstone: 'Yellow Sapphire', color: 'Yellow', mantra: 'Om Gram Greem Groum Sah Gurave Namah' },
            { rashi: 'Makara', english: 'Capricorn', symbol: '♑', lord: 'Shani (Saturn)', element: 'Prithvi (Earth)', guna: 'Tamas', traits: 'Ambitious, Disciplined, Practical', gemstone: 'Blue Sapphire', color: 'Black/Blue', mantra: 'Om Pram Preem Proum Sah Shanaischaraya Namah' },
            { rashi: 'Kumbha', english: 'Aquarius', symbol: '♒', lord: 'Shani (Saturn)', element: 'Vayu (Air)', guna: 'Tamas', traits: 'Humanitarian, Innovative, Detached', gemstone: 'Blue Sapphire', color: 'Black/Blue', mantra: 'Om Pram Preem Proum Sah Shanaischaraya Namah' },
            { rashi: 'Meena', english: 'Pisces', symbol: '♓', lord: 'Guru (Jupiter)', element: 'Jala (Water)', guna: 'Sattva', traits: 'Spiritual, Compassionate, Intuitive', gemstone: 'Yellow Sapphire', color: 'Yellow', mantra: 'Om Gram Greem Groum Sah Gurave Namah' }
        ];

        // Calculate Lagna (Ascendant) using birth time and location
        const getVedicLagna = (dobString, birthTime, location) => {
            if (!dobString || !birthTime) return null;

            try {
                // 1. Julian Day Calculation
                const dob = new Date(dobString);
                const timeParts = birthTime.split(':');
                const hour = parseInt(timeParts[0]);
                const min = parseInt(timeParts[1]);
                const sec = parseInt(timeParts[2] || 0);

                // Precise coordinates for Nepal districts/cities
                const locationData = {
                    'Kathmandu': { offset: 5.75, lon: 85.32, lat: 27.71 },
                    'Lalitpur': { offset: 5.75, lon: 85.31, lat: 27.66 },
                    'Bhaktapur': { offset: 5.75, lon: 85.42, lat: 27.67 },
                    'Pokhara': { offset: 5.75, lon: 83.98, lat: 28.21 },
                    'Bharatpur': { offset: 5.75, lon: 84.43, lat: 27.68 },
                    'Biratnagar': { offset: 5.75, lon: 87.27, lat: 26.45 },
                    'Birgunj': { offset: 5.75, lon: 84.87, lat: 27.01 },
                    'Janakpur': { offset: 5.75, lon: 85.92, lat: 26.72 },
                    'Butwal': { offset: 5.75, lon: 83.44, lat: 27.70 },
                    'Dharan': { offset: 5.75, lon: 87.28, lat: 26.81 },
                    'Dhangadhi': { offset: 5.75, lon: 80.60, lat: 28.68 },
                    'Nepalgunj': { offset: 5.75, lon: 81.61, lat: 28.05 },
                    'Hetauda': { offset: 5.75, lon: 85.03, lat: 27.41 },
                    'Itahari': { offset: 5.75, lon: 87.28, lat: 26.66 },
                    'Bhairahawa': { offset: 5.75, lon: 83.45, lat: 27.50 },
                    'Birtamod': { offset: 5.75, lon: 87.98, lat: 26.63 },
                    'Damak': { offset: 5.75, lon: 87.68, lat: 26.66 },
                    'Ghorahi': { offset: 5.75, lon: 82.48, lat: 28.03 },
                    'Tulsipur': { offset: 5.75, lon: 82.30, lat: 28.13 },
                    'Kalaiya': { offset: 5.75, lon: 84.91, lat: 27.03 },
                    'Jaleshwar': { offset: 5.75, lon: 85.80, lat: 26.65 },
                    'Lahan': { offset: 5.75, lon: 86.48, lat: 26.71 },
                    'Rajbiraj': { offset: 5.75, lon: 86.75, lat: 26.53 },
                    'Mahendranagar': { offset: 5.75, lon: 80.18, lat: 28.91 },
                    'Gulariya': { offset: 5.75, lon: 81.33, lat: 28.23 }
                };
                const city = locationData[location] || locationData['Kathmandu'];
                const { offset, lon, lat } = city;

                // Adjust to UTC
                let utcTime = new Date(Date.UTC(dob.getFullYear(), dob.getMonth(), dob.getDate(), hour, min, sec));
                utcTime.setMinutes(utcTime.getMinutes() - (offset * 60));

                const Y = utcTime.getUTCFullYear();
                const M = utcTime.getUTCMonth() + 1;
                const D_base = utcTime.getUTCDate();
                const H_utc = utcTime.getUTCHours() + utcTime.getUTCMinutes() / 60 + utcTime.getUTCSeconds() / 3600;

                const getJD = (y, m, d) => {
                    if (m <= 2) { y -= 1; m += 12; }
                    const A = Math.floor(y / 100);
                    const B = 2 - A + Math.floor(A / 4);
                    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
                };

                const jd_midnight = getJD(Y, M, D_base);
                const T = (jd_midnight - 2451545.0) / 36525.0; // Centuries from J2000

                // 2. Sidereal Time
                let gmst_0h = 100.46061837 + 36000.770053608 * T + 0.000387933 * T * T - (T * T * T) / 38710000;
                let gmst = (gmst_0h + (1.00273790935 * H_utc * 15)) % 360;
                let lmst = (gmst + lon) % 360;
                if (lmst < 0) lmst += 360;

                // 3. Obliquity
                const eps = 23.4392911 - (46.8150 * T) / 3600;
                const eps_rad = eps * (Math.PI / 180);
                const lmst_rad = lmst * (Math.PI / 180);
                const lat_rad = lat * (Math.PI / 180);

                // 4. Calculate Ascendant (Sayana)
                // Reliable Trigonometric Ascendant Formula
                // tan(Asc) = cos(LST) / (-sin(LST)*cos(eps) - tan(phi)*sin(eps))
                const num = Math.cos(lmst_rad);
                const den = -Math.sin(lmst_rad) * Math.cos(eps_rad) - Math.tan(lat_rad) * Math.sin(eps_rad);
                const asc_rad = Math.atan2(num, den);

                let asc_sayana = (asc_rad * (180 / Math.PI)) % 360;
                if (asc_sayana < 0) asc_sayana += 360;

                // 5. Ayanamsa (Lahiri)
                const ayanamsa = 23.85 + (Y - 2000) * (50.3 / 3600);
                let siderealLagna = (asc_sayana - ayanamsa) % 360;
                if (siderealLagna < 0) siderealLagna += 360;

                const rashiIndex = Math.floor(siderealLagna / 30);
                const rashiNames = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];

                return {
                    rashi: rashiNames[rashiIndex],
                    longitude: siderealLagna
                };
            } catch (e) {
                console.error("[MS Vedic] Lagna Calculation error:", e);
                return null;
            }
        };

        // Get Lagna - manual or auto-calculatd
        const getLagna = (dateString) => {
            const manualLagna = localStorage.getItem('ms_user_lagna');
            if (manualLagna) {
                const found = vedicRashiData.find(r => r.rashi === manualLagna);
                if (found) return { ...found, isManual: true };
            }

            const birthTime = localStorage.getItem('ms_user_birth_time');
            const birthLoc = localStorage.getItem('ms_user_birth_location');
            if (dateString && birthTime && birthLoc) {
                const calculated = getVedicLagna(dateString, birthTime, birthLoc);
                if (calculated && calculated.rashi) {
                    const found = vedicRashiData.find(r => r.rashi === calculated.rashi);
                    if (found) return { ...found, isCalculated: true };
                }
            }
            return null;
        };

        // Calculate Moon details (Rashi, Nakshatra, Pada) using simplified astronomical formula
        const getVedicMoonDetails = (dobString, birthTime, location) => {
            if (!dobString || !birthTime) return null;

            try {
                // 1. Julian Day Calculation
                const dob = new Date(dobString);
                const timeParts = birthTime.split(':');
                const hour = parseInt(timeParts[0]);
                const min = parseInt(timeParts[1]);
                const sec = parseInt(timeParts[2] || 0);

                // Precise coordinates for Nepal districts/cities
                const locationData = {
                    'Kathmandu': { offset: 5.75, lon: 85.32, lat: 27.71 },
                    'Lalitpur': { offset: 5.75, lon: 85.31, lat: 27.66 },
                    'Bhaktapur': { offset: 5.75, lon: 85.42, lat: 27.67 },
                    'Pokhara': { offset: 5.75, lon: 83.98, lat: 28.21 },
                    'Bharatpur': { offset: 5.75, lon: 84.43, lat: 27.68 },
                    'Biratnagar': { offset: 5.75, lon: 87.27, lat: 26.45 },
                    'Birgunj': { offset: 5.75, lon: 84.87, lat: 27.01 },
                    'Janakpur': { offset: 5.75, lon: 85.92, lat: 26.72 },
                    'Butwal': { offset: 5.75, lon: 83.44, lat: 27.70 },
                    'Dharan': { offset: 5.75, lon: 87.28, lat: 26.81 },
                    'Dhangadhi': { offset: 5.75, lon: 80.60, lat: 28.68 },
                    'Nepalgunj': { offset: 5.75, lon: 81.61, lat: 28.05 },
                    'Hetauda': { offset: 5.75, lon: 85.03, lat: 27.41 },
                    'Itahari': { offset: 5.75, lon: 87.28, lat: 26.66 },
                    'Bhairahawa': { offset: 5.75, lon: 83.45, lat: 27.50 },
                    'Birtamod': { offset: 5.75, lon: 87.98, lat: 26.63 },
                    'Damak': { offset: 5.75, lon: 87.68, lat: 26.66 },
                    'Ghorahi': { offset: 5.75, lon: 82.48, lat: 28.03 },
                    'Tulsipur': { offset: 5.75, lon: 82.30, lat: 28.13 },
                    'Kalaiya': { offset: 5.75, lon: 84.91, lat: 27.03 },
                    'Jaleshwar': { offset: 5.75, lon: 85.80, lat: 26.65 },
                    'Lahan': { offset: 5.75, lon: 86.48, lat: 26.71 },
                    'Rajbiraj': { offset: 5.75, lon: 86.75, lat: 26.53 },
                    'Mahendranagar': { offset: 5.75, lon: 80.18, lat: 28.91 },
                    'Gulariya': { offset: 5.75, lon: 81.33, lat: 28.23 }
                };
                const city = locationData[location] || locationData['Kathmandu'];
                const { offset } = city;

                // Adjust to UTC
                let utcTime = new Date(Date.UTC(dob.getFullYear(), dob.getMonth(), dob.getDate(), hour, min, sec));
                utcTime.setMinutes(utcTime.getMinutes() - (offset * 60));

                const Y = utcTime.getUTCFullYear();
                const M = utcTime.getUTCMonth() + 1;
                const D = utcTime.getUTCDate() + (utcTime.getUTCHours() + utcTime.getUTCMinutes() / 60 + utcTime.getUTCSeconds() / 3600) / 24;

                const getJD = (y, m, d) => {
                    if (m <= 2) { y -= 1; m += 12; }
                    const A = Math.floor(y / 100);
                    const B = 2 - A + Math.floor(A / 4);
                    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
                };

                const jd = getJD(Y, M, D);
                const t = (jd - 2451545.0) / 36525.0; // Centuries from J2000

                // 2. Moon's Position (Simplified)
                // Mean longitude L'
                let L_prime = 218.316 + 13.176396 * (jd - 2451545.0);
                // Mean anomaly M'
                let M_prime = 134.963 + 13.064993 * (jd - 2451545.0);

                // Correct for periodicity
                L_prime = L_prime % 360;
                if (L_prime < 0) L_prime += 360;
                M_prime = (M_prime % 360) * (Math.PI / 180);

                // Simplified Geocentric Longitude (lambda)
                let lambda = L_prime + 6.289 * Math.sin(M_prime);
                // Add minor corrections for better accuracy (Evection, Variation)
                let D_mean = (297.85 + 12.190749 * (jd - 2451545.0)) % 360 * (Math.PI / 180); // Mean elongation
                let M_sun = (357.52 + 0.9856 * (jd - 2451545.0)) % 360 * (Math.PI / 180); // Sun's mean anomaly
                lambda += 1.274 * Math.sin(2 * D_mean - M_prime); // Evection
                lambda += 0.658 * Math.sin(2 * D_mean); // Variation
                lambda -= 0.186 * Math.sin(M_sun); // Annual equation

                // 3. Ayanamsa (Lahiri)
                // Lahiri Ayanamsa is approx 23.85 degrees in 2000, changes 50.3" per year
                const ayanamsa = 23.85 + (Y - 2000) * (50.3 / 3600);

                // 4. Sidereal Longitude (Nirayana)
                let siderealLon = (lambda - ayanamsa) % 360;
                if (siderealLon < 0) siderealLon += 360;

                // 5. Determine Rashi, Nakshatra, Pada
                const rashiIndex = Math.floor(siderealLon / 30);
                const nakshatraIndex = Math.floor(siderealLon / (360 / 27));
                const pada = Math.floor((siderealLon % (360 / 27)) / (360 / 108)) + 1;

                const rashiNames = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];

                return {
                    rashi: rashiNames[rashiIndex],
                    nakshatra: nakshatraData[nakshatraIndex].name,
                    pada: pada,
                    longitude: siderealLon
                };
            } catch (e) {
                console.error("[MS Vedic] Calculation error:", e);
                return null;
            }
        };

        // Get Stock Guidance based on Rashi Lord
        // Simplified Planetary Transit Calculator (Geocentric Mean Longitudes)
        const getPlanetaryTransits = () => {
            const now = new Date();
            const Y = now.getUTCFullYear();
            const M = now.getUTCMonth() + 1;
            const D = now.getUTCDate() + (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24;

            const getJD = (y, m, d) => {
                if (m <= 2) { y -= 1; m += 12; }
                const A = Math.floor(y / 100);
                const B = 2 - A + Math.floor(A / 4);
                return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
            };

            const jd = getJD(Y, M, D);
            const d = jd - 2451545.0; // Days from J2000

            // Mean Longitudes (Simplified approximations)
            const transits = {
                Sun: (280.466 + 0.985647 * d) % 360,
                Mars: (355.433 + 0.524071 * d) % 360,
                Jupiter: (34.351 + 0.083091 * d) % 360,
                Saturn: (50.077 + 0.033459 * d) % 360,
                Mercury: (252.250 + 4.092334 * d) % 360
            };

            // Fix negatives
            Object.keys(transits).forEach(k => { if (transits[k] < 0) transits[k] += 360; });
            return transits;
        };

        const getVedicStockGuidance = (rashi, nakshatra, lagna, transits) => {
            if (!rashi) return null;

            const lagnaLord = lagna ? lagna.lord.split(' ')[0] : 'Jupiter';
            const nakLord = nakshatra ? nakshatra.lord : 'Mercury';

            const sectorData = {
                'Sun': { sectors: ['Government', 'Power', 'Energy', 'Gold'], trait: 'Boldness & Authority' },
                'Moon': { sectors: ['Pharma', 'FMCG', 'Liquid Assets', 'Shipping'], trait: 'Intuition & Flow' },
                'Mars': { sectors: ['Energy', 'Defense', 'Technology', 'Metals'], trait: 'High-Risk & Momentum' },
                'Mercury': { sectors: ['Banking', 'IT', 'Telecomm', 'Trade'], trait: 'Analysis & Communication' },
                'Jupiter': { sectors: ['Finance', 'Banking', 'Investment', 'Education'], trait: 'Growth & Wisdom' },
                'Venus': { sectors: ['Auto', 'Luxury', 'Hospitality', 'Textiles'], trait: 'Lifestyle & Value' },
                'Saturn': { sectors: ['Real Estate', 'Infrastructure', 'Utilities', 'Cements'], trait: 'Stability & Patience' }
            };

            // 1. Lagna-based Sector (Primary)
            const primary = sectorData[lagnaLord] || sectorData['Jupiter'];

            // 2. Nakshatra-based Attributes
            const secondary = sectorData[nakLord] || sectorData['Mercury'];

            // 3. Transit Influence (Dynamic)
            let transitAdvice = "The planets favor a balanced approach today.";
            let strategy = "Balanced Allocation";

            if (transits) {
                // Simplified Transit Analysis
                const jupiterPos = transits.Jupiter;
                const marsPos = transits.Mars;
                const sunPos = transits.Sun;

                if (jupiterPos > 120 && jupiterPos < 240) { // Positive arc
                    transitAdvice = "Jupiter transits positively: Focus on long-term growth and stable fundamentals.";
                    strategy = "Long-term Growh";
                } else if (marsPos > 0 && marsPos < 60) { // High Energy
                    transitAdvice = "Mars shows aggressive momentum: High-risk strategies in Energy & Tech may reward.";
                    strategy = "Short-term Momentum";
                } else if (sunPos > 300) {
                    transitAdvice = "Auspicious Surya transit: A great time for bold trades and opening new positions.";
                    strategy = "New Ventures";
                }
            }

            return {
                sectors: Array.from(new Set([...primary.sectors, ...secondary.sectors])),
                description: `Focus on ${primary.sectors[0]} and ${secondary.sectors[0]}. ${transitAdvice}`,
                strategy: strategy,
                lagnaTrait: primary.trait,
                nakshatraTrait: secondary.trait
            };
        };

        // Map NEPSE Sectors to Vedic Planetries
        const mapPortfolioToVedic = (stocks, guidance) => {
            if (!stocks || !guidance) return [];

            // Simplified mapping of NEPSE sectors to our planet sectors
            return stocks.filter(s => {
                const sector = s.sector || '';
                return guidance.sectors.some(gs => sector.toLowerCase().includes(gs.toLowerCase()));
            }).slice(0, 3); // Top 3 matching scrips
        };

        // Get Vedic Rashi - prioritizes user's manually entered Rashi from their kundali
        const getVedicRashi = (dateString) => {
            // Priority 1: Manual Rashi from storage
            const manualRashi = localStorage.getItem('ms_user_vedic_rashi');
            if (manualRashi) {
                const found = vedicRashiData.find(r => r.rashi === manualRashi);
                if (found) return { ...found, isManual: true };
            }

            // Priority 2: Auto-calculate if Birth Time + Location available
            const birthTime = localStorage.getItem('ms_user_birth_time');
            const birthLoc = localStorage.getItem('ms_user_birth_location');
            if (dateString && birthTime && birthLoc) {
                const calculated = getVedicMoonDetails(dateString, birthTime, birthLoc);
                if (calculated && calculated.rashi) {
                    const found = vedicRashiData.find(r => r.rashi === calculated.rashi);
                    if (found) return { ...found, isCalculated: true };
                }
            }

            return null;
        };

        // Get Rashi by name (for manual selection)
        const getRashiByName = (rashiName) => {
            return vedicRashiData.find(r => r.rashi === rashiName || r.english === rashiName) || null;
        };

        // All 27 Nakshatras data
        const nakshatraData = [
            { name: 'Ashwini', deity: 'Ashwini Kumaras', symbol: '🐴', lord: 'Ketu', nature: 'Swift, Healing', qualities: 'Speed, Initiative, Healing powers' },
            { name: 'Bharani', deity: 'Yama', symbol: '🔺', lord: 'Shukra', nature: 'Fierce, Creative', qualities: 'Transformation, Restraint, Fertility' },
            { name: 'Krittika', deity: 'Agni', symbol: '🔥', lord: 'Surya', nature: 'Sharp, Purifying', qualities: 'Cutting, Burning, Purification' },
            { name: 'Rohini', deity: 'Brahma', symbol: '🐂', lord: 'Chandra', nature: 'Soft, Creative', qualities: 'Growth, Fertility, Beauty' },
            { name: 'Mrigashira', deity: 'Soma', symbol: '🦌', lord: 'Mangal', nature: 'Soft, Searching', qualities: 'Seeking, Gentle, Curious' },
            { name: 'Ardra', deity: 'Rudra', symbol: '💧', lord: 'Rahu', nature: 'Sharp, Fierce', qualities: 'Storm, Transformation, Effort' },
            { name: 'Punarvasu', deity: 'Aditi', symbol: '🏠', lord: 'Guru', nature: 'Movable, Light', qualities: 'Return, Renewal, Restoration' },
            { name: 'Pushya', deity: 'Brihaspati', symbol: '🌸', lord: 'Shani', nature: 'Light, Nourishing', qualities: 'Nourishment, Most auspicious, Prosperity' },
            { name: 'Ashlesha', deity: 'Nagas', symbol: '🐍', lord: 'Budha', nature: 'Sharp, Clinging', qualities: 'Mystical, Embracing, Kundalini' },
            { name: 'Magha', deity: 'Pitris', symbol: '👑', lord: 'Ketu', nature: 'Fierce, Royal', qualities: 'Ancestors, Throne, Authority' },
            { name: 'Purva Phalguni', deity: 'Bhaga', symbol: '🛏️', lord: 'Shukra', nature: 'Fierce, Creative', qualities: 'Enjoyment, Relaxation, Creativity' },
            { name: 'Uttara Phalguni', deity: 'Aryaman', symbol: '🌅', lord: 'Surya', nature: 'Fixed, Gentle', qualities: 'Patronage, Friendship, Contracts' },
            { name: 'Hasta', deity: 'Savitar', symbol: '✋', lord: 'Chandra', nature: 'Light, Swift', qualities: 'Skill, Craftsmanship, Dexterity' },
            { name: 'Chitra', deity: 'Vishwakarma', symbol: '💎', lord: 'Mangal', nature: 'Soft, Bright', qualities: 'Brilliance, Creativity, Architecture' },
            { name: 'Swati', deity: 'Vayu', symbol: '🌬️', lord: 'Rahu', nature: 'Movable, Soft', qualities: 'Independence, Self-going, Flexibility' },
            { name: 'Vishakha', deity: 'Indra-Agni', symbol: '🎯', lord: 'Guru', nature: 'Mixed, Sharp', qualities: 'Determination, Purpose, Triumph' },
            { name: 'Anuradha', deity: 'Mitra', symbol: '🌺', lord: 'Shani', nature: 'Soft, Friendly', qualities: 'Devotion, Friendship, Success in foreign lands' },
            { name: 'Jyeshtha', deity: 'Indra', symbol: '☂️', lord: 'Budha', nature: 'Sharp, Senior', qualities: 'Seniority, Protection, Chief' },
            { name: 'Mula', deity: 'Nirriti', symbol: '🌿', lord: 'Ketu', nature: 'Sharp, Root', qualities: 'Roots, Investigation, Destruction of old' },
            { name: 'Purva Ashadha', deity: 'Apas', symbol: '🌊', lord: 'Shukra', nature: 'Fierce, Invincible', qualities: 'Invincibility, Purification, Declaration' },
            { name: 'Uttara Ashadha', deity: 'Vishve Devas', symbol: '⚔️', lord: 'Surya', nature: 'Fixed, Final Victory', qualities: 'Final victory, Unchallengeable, Introspection' },
            { name: 'Shravana', deity: 'Vishnu', symbol: '👂', lord: 'Chandra', nature: 'Movable, Learning', qualities: 'Listening, Learning, Connection' },
            { name: 'Dhanishtha', deity: 'Vasus', symbol: '🥁', lord: 'Mangal', nature: 'Movable, Wealthy', qualities: 'Wealth, Fame, Symphony' },
            { name: 'Shatabhisha', deity: 'Varuna', symbol: '💫', lord: 'Rahu', nature: 'Movable, Healing', qualities: 'Healing, Mystical, 100 physicians' },
            { name: 'Purva Bhadrapada', deity: 'Aja Ekapada', symbol: '⚡', lord: 'Guru', nature: 'Fierce, Scorching', qualities: 'Fire, Purification, Transformation' },
            { name: 'Uttara Bhadrapada', deity: 'Ahir Budhnya', symbol: '🌊', lord: 'Shani', nature: 'Fixed, Deep', qualities: 'Depth, Kundalini, Wisdom' },
            { name: 'Revati', deity: 'Pushan', symbol: '🐟', lord: 'Budha', nature: 'Soft, Nourishing', qualities: 'Journey, Nourishment, Wealth' }
        ];

        // Mapping of Rashis to their Nakshatras (each Rashi spans ~2.25 Nakshatras = 9 padas)
        // Format: { rashi: [{ nakshatraIndex, padas: [which padas fall in this rashi] }] }
        const rashiNakshatraMap = {
            'Mesha': [
                { index: 0, padas: [1, 2, 3, 4] },      // Ashwini (all 4 padas)
                { index: 1, padas: [1, 2, 3, 4] },      // Bharani (all 4 padas)
                { index: 2, padas: [1] }                // Krittika (pada 1 only)
            ],
            'Vrishabha': [
                { index: 2, padas: [2, 3, 4] },         // Krittika (padas 2-4)
                { index: 3, padas: [1, 2, 3, 4] },      // Rohini (all 4 padas)
                { index: 4, padas: [1, 2] }             // Mrigashira (padas 1-2)
            ],
            'Mithuna': [
                { index: 4, padas: [3, 4] },            // Mrigashira (padas 3-4)
                { index: 5, padas: [1, 2, 3, 4] },      // Ardra (all 4 padas)
                { index: 6, padas: [1, 2, 3] }          // Punarvasu (padas 1-3)
            ],
            'Karka': [
                { index: 6, padas: [4] },               // Punarvasu (pada 4 only)
                { index: 7, padas: [1, 2, 3, 4] },      // Pushya (all 4 padas)
                { index: 8, padas: [1, 2, 3, 4] }       // Ashlesha (all 4 padas)
            ],
            'Simha': [
                { index: 9, padas: [1, 2, 3, 4] },      // Magha (all 4 padas)
                { index: 10, padas: [1, 2, 3, 4] },     // Purva Phalguni (all 4 padas)
                { index: 11, padas: [1] }               // Uttara Phalguni (pada 1 only)
            ],
            'Kanya': [
                { index: 11, padas: [2, 3, 4] },        // Uttara Phalguni (padas 2-4)
                { index: 12, padas: [1, 2, 3, 4] },     // Hasta (all 4 padas)
                { index: 13, padas: [1, 2] }            // Chitra (padas 1-2)
            ],
            'Tula': [
                { index: 13, padas: [3, 4] },           // Chitra (padas 3-4)
                { index: 14, padas: [1, 2, 3, 4] },     // Swati (all 4 padas)
                { index: 15, padas: [1, 2, 3] }         // Vishakha (padas 1-3)
            ],
            'Vrishchika': [
                { index: 15, padas: [4] },              // Vishakha (pada 4 only)
                { index: 16, padas: [1, 2, 3, 4] },     // Anuradha (all 4 padas)
                { index: 17, padas: [1, 2, 3, 4] }      // Jyeshtha (all 4 padas)
            ],
            'Dhanu': [
                { index: 18, padas: [1, 2, 3, 4] },     // Mula (all 4 padas)
                { index: 19, padas: [1, 2, 3, 4] },     // Purva Ashadha (all 4 padas)
                { index: 20, padas: [1] }               // Uttara Ashadha (pada 1 only)
            ],
            'Makara': [
                { index: 20, padas: [2, 3, 4] },        // Uttara Ashadha (padas 2-4)
                { index: 21, padas: [1, 2, 3, 4] },     // Shravana (all 4 padas)
                { index: 22, padas: [1, 2] }            // Dhanishtha (padas 1-2)
            ],
            'Kumbha': [
                { index: 22, padas: [3, 4] },           // Dhanishtha (padas 3-4)
                { index: 23, padas: [1, 2, 3, 4] },     // Shatabhisha (all 4 padas)
                { index: 24, padas: [1, 2, 3] }         // Purva Bhadrapada (padas 1-3)
            ],
            'Meena': [
                { index: 24, padas: [4] },              // Purva Bhadrapada (pada 4 only)
                { index: 25, padas: [1, 2, 3, 4] },     // Uttara Bhadrapada (all 4 padas)
                { index: 26, padas: [1, 2, 3, 4] }      // Revati (all 4 padas)
            ]
        };

        // Get Nakshatra from user's kundali (manual entry for accuracy)
        // Note: Accurate Nakshatra calculation requires ephemeris data, so manual entry from kundali is most accurate
        const getNakshatra = (dateString) => {
            // Priority 1: Manual Nakshatra from storage
            const manualNakshatra = localStorage.getItem('ms_user_nakshatra');
            const manualPada = localStorage.getItem('ms_user_nakshatra_pada');

            if (manualNakshatra) {
                const found = nakshatraData.find(n => n.name === manualNakshatra);
                if (found) {
                    const nakIndex = nakshatraData.findIndex(n => n.name === manualNakshatra);
                    return {
                        ...found,
                        pada: parseInt(manualPada) || 1,
                        longitude: (nakIndex >= 0) ? nakIndex * (360 / 27) : null,
                        isFromKundali: true
                    };
                }
            }

            // Priority 2: Auto-calculate if Birth Time + Location available
            const birthTime = localStorage.getItem('ms_user_birth_time');
            const birthLoc = localStorage.getItem('ms_user_birth_location');
            if (dateString && birthTime && birthLoc) {
                const calculated = getVedicMoonDetails(dateString, birthTime, birthLoc);
                if (calculated && calculated.nakshatra) {
                    const found = nakshatraData.find(n => n.name === calculated.nakshatra);
                    if (found) {
                        return {
                            ...found,
                            pada: calculated.pada,
                            longitude: calculated.longitude,
                            isCalculated: true
                        };
                    }
                }
            }

            return null;
        };

        // Vedic Daily Prediction based on Rashi

        // Vedic Daily Prediction based on Rashi
        const getVedicDailyPrediction = (rashi) => {
            if (!rashi) return '';
            const predictions = {
                Mesha: ["Mangal blesses your ventures today—take bold action!", "Mars energy favors new beginnings in your portfolio.", "Your warrior spirit attracts prosperity. Be decisive!"],
                Vrishabha: ["Shukra brings beauty and value to your investments today.", "Patience is your superpower—let your holdings mature.", "Venus smiles on stable, long-term wealth building."],
                Mithuna: ["Budha sharpens your trading instincts today!", "Communication with advisors brings valuable insights.", "Mercury favors diversification and quick decisions."],
                Karka: ["Chandra enhances your intuition about market tides.", "Trust your gut feelings on defensive positions.", "Moon energy supports nurturing your portfolio health."],
                Simha: ["Surya illuminates profitable opportunities today!", "Your leadership attracts collaborative investments.", "Sun's radiance favors bold, confident moves."],
                Kanya: ["Budha rewards your analytical approach today.", "Detailed research reveals hidden gems.", "Mercury blesses methodical portfolio management."],
                Tula: ["Shukra harmonizes your investment decisions today.", "Balance and fairness in trades bring rewards.", "Venus favors partnerships and balanced portfolios."],
                Vrishchika: ["Mangal intensifies your market intuition today.", "Deep research uncovers transformative opportunities.", "Mars energy supports strategic, powerful moves."],
                Dhanu: ["Guru expands your investment horizons today!", "Optimism and wisdom guide profitable decisions.", "Jupiter blesses international and growth stocks."],
                Makara: ["Shani rewards patience and discipline today.", "Your methodical approach builds lasting wealth.", "Saturn favors structured, long-term investments."],
                Kumbha: ["Shani supports innovative investment thinking today.", "Unconventional opportunities may prove fruitful.", "Saturn blesses technology and humanitarian sectors."],
                Meena: ["Guru deepens your spiritual wealth today.", "Intuition guides you toward meaningful investments.", "Jupiter favors compassionate and ethical choices."]
            };
            const fortunes = predictions[rashi.rashi] || ["The planets align for patient investors today."];
            const today = new Date().toISOString().split('T')[0];
            let hash = 0;
            for (let i = 0; i < (rashi.rashi + today).length; i++) {
                hash = (rashi.rashi + today).charCodeAt(i) + ((hash << 5) - hash);
            }
            return fortunes[Math.abs(hash) % fortunes.length];
        };

        // Tithi (Lunar Day) Calculator - Accurate astronomical version
        const getTithi = (dateOverride = null) => {
            const now = dateOverride ? new Date(dateOverride) : new Date();

            // 1. Julian Day for current moment (UTC)
            const Y = now.getUTCFullYear();
            const M = now.getUTCMonth() + 1;
            const D = now.getUTCDate() + (now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24;

            const getJD = (y, m, d) => {
                if (m <= 2) { y -= 1; m += 12; }
                const A = Math.floor(y / 100);
                const B = 2 - A + Math.floor(A / 4);
                return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
            };

            const jd = getJD(Y, M, D);
            const d = jd - 2451545.0; // Days from J2000

            // 2. Moon Longitude (Simplified formula)
            let L_moon = (218.316 + 13.176396 * d) % 360;
            let M_moon = (134.963 + 13.064993 * d) % 360 * (Math.PI / 180);
            let lon_moon = L_moon + 6.289 * Math.sin(M_moon);

            // 3. Sun Longitude (Simplified formula)
            let L_sun = (280.466 + 0.985647 * d) % 360;
            let M_sun = (357.529 + 0.985600 * d) % 360 * (Math.PI / 180);
            let lon_sun = L_sun + 1.915 * Math.sin(M_sun);

            // 4. Calculate Distance
            let diff = (lon_moon - lon_sun) % 360;
            if (diff < 0) diff += 360;

            // 5. Determine Tithi (each Tithi is 12 degrees)
            const tithiIndex = Math.floor(diff / 12);

            const tithis = [
                { name: 'Pratipada', paksha: 'Shukla', meaning: 'New beginnings', auspicious: 'Starting ventures' },
                { name: 'Dwitiya', paksha: 'Shukla', meaning: 'Duality, Partnerships', auspicious: 'Collaborations' },
                { name: 'Tritiya', paksha: 'Shukla', meaning: 'Trinity, Creation', auspicious: 'Creative work' },
                { name: 'Chaturthi', paksha: 'Shukla', meaning: 'Stability', auspicious: 'Ganesh blessings' },
                { name: 'Panchami', paksha: 'Shukla', meaning: 'Five elements', auspicious: 'Learning, Knowledge' },
                { name: 'Shashthi', paksha: 'Shukla', meaning: 'Victory', auspicious: 'Overcoming obstacles' },
                { name: 'Saptami', paksha: 'Shukla', meaning: 'Seven rays', auspicious: 'Travel, Movement' },
                { name: 'Ashtami', paksha: 'Shukla', meaning: 'Eight forms', auspicious: 'Durga blessings' },
                { name: 'Navami', paksha: 'Shukla', meaning: 'Completion', auspicious: 'Spiritual activities' },
                { name: 'Dashami', paksha: 'Shukla', meaning: 'Ten directions', auspicious: 'Auspicious work' },
                { name: 'Ekadashi', paksha: 'Shukla', meaning: 'Eleven Rudras', auspicious: 'Vishnu worship, Fasting' },
                { name: 'Dwadashi', paksha: 'Shukla', meaning: 'Twelve Adityas', auspicious: 'Charity, Donations' },
                { name: 'Trayodashi', paksha: 'Shukla', meaning: 'Thirteen', auspicious: 'Shiva worship' },
                { name: 'Chaturdashi', paksha: 'Shukla', meaning: 'Fourteen', auspicious: 'Hanuman blessings' },
                { name: 'Purnima', paksha: 'Shukla', meaning: 'Full Moon', auspicious: 'Harvest gains, Completion' },
                { name: 'Pratipada', paksha: 'Krishna', meaning: 'Release begins', auspicious: 'Letting go' },
                { name: 'Dwitiya', paksha: 'Krishna', meaning: 'Reflection', auspicious: 'Review decisions' },
                { name: 'Tritiya', paksha: 'Krishna', meaning: 'Dissolution', auspicious: 'Remove obstacles' },
                { name: 'Chaturthi', paksha: 'Krishna', meaning: 'Sankashti', auspicious: 'Ganesh worship' },
                { name: 'Panchami', paksha: 'Krishna', meaning: 'Release knowledge', auspicious: 'Teaching others' },
                { name: 'Shashthi', paksha: 'Krishna', meaning: 'Surrender', auspicious: 'Reduce holdings' },
                { name: 'Saptami', paksha: 'Krishna', meaning: 'Simplify', auspicious: 'Streamline portfolio' },
                { name: 'Ashtami', paksha: 'Krishna', meaning: 'Transformation', auspicious: 'Major changes' },
                { name: 'Navami', paksha: 'Krishna', meaning: 'Completion cycle', auspicious: 'Close positions' },
                { name: 'Dashami', paksha: 'Krishna', meaning: 'Direction change', auspicious: 'Strategy review' },
                { name: 'Ekadashi', paksha: 'Krishna', meaning: 'Fasting', auspicious: 'Avoid new trades' },
                { name: 'Dwadashi', paksha: 'Krishna', meaning: 'Charity', auspicious: 'Give back' },
                { name: 'Trayodashi', paksha: 'Krishna', meaning: 'Pradosh', auspicious: 'Evening prayers' },
                { name: 'Chaturdashi', paksha: 'Krishna', meaning: 'Shivaratri energy', auspicious: 'Deep meditation' },
                { name: 'Amavasya', paksha: 'Krishna', meaning: 'New Moon', auspicious: 'Rest, Plan ahead' }
            ];

            return tithis[tithiIndex % 30];
        };

        // Vara (Day of Week) with Vedic significance
        const getVara = () => {
            const dayOfWeek = new Date().getDay();
            const varas = [
                { name: 'Ravivara', english: 'Sunday', lord: 'Surya (Sun)', color: 'Red/Orange', favorable: 'Leadership, Government matters', avoid: 'Starting journeys' },
                { name: 'Somavara', english: 'Monday', lord: 'Chandra (Moon)', color: 'White', favorable: 'New beginnings, Agriculture', avoid: 'Conflicts' },
                { name: 'Mangalavara', english: 'Tuesday', lord: 'Mangal (Mars)', color: 'Red', favorable: 'Property, Machinery', avoid: 'Marriages, Journeys' },
                { name: 'Budhavara', english: 'Wednesday', lord: 'Budha (Mercury)', color: 'Green', favorable: 'Business, Communication, Trading', avoid: 'Heavy investments' },
                { name: 'Guruvara', english: 'Thursday', lord: 'Guru (Jupiter)', color: 'Yellow', favorable: 'Education, Wealth, Expansion', avoid: 'Nothing - highly auspicious' },
                { name: 'Shukravara', english: 'Friday', lord: 'Shukra (Venus)', color: 'White/Pink', favorable: 'Luxury, Arts, Relationships', avoid: 'Harsh actions' },
                { name: 'Shanivara', english: 'Saturday', lord: 'Shani (Saturn)', color: 'Black/Blue', favorable: 'Long-term investments, Discipline', avoid: 'New ventures' }
            ];
            return varas[dayOfWeek];
        };

        // Vedic Lucky Numbers based on Rashi Lord
        const getVedicLuckyNumbers = (rashi, dobString) => {
            if (!rashi) return '1, 9, 18';
            const lordNumbers = {
                'Surya': [1, 10, 19],
                'Chandra': [2, 11, 20],
                'Mangal': [9, 18, 27],
                'Budha': [5, 14, 23],
                'Guru': [3, 12, 21],
                'Shukra': [6, 15, 24],
                'Shani': [8, 17, 26],
                'Rahu': [4, 13, 22],
                'Ketu': [7, 16, 25]
            };
            const lordName = rashi.lord.split(' ')[0];
            const baseNums = lordNumbers[lordName] || [1, 9, 18];

            // Add DOB personalization
            const dob = dobString ? new Date(dobString) : new Date();
            const dobDay = dob.getDate();
            const personalNum = ((dobDay % 9) + 1);

            return [...new Set([personalNum, ...baseNums.slice(0, 2)])].sort((a, b) => a - b).join(', ');
        };

        // Vedic Auspicious Time (Shubh Muhurat) approximation
        const getVedicAuspiciousTime = (rashi, dobString) => {
            if (!rashi) return { time: '10:30 - 12:00', reason: 'Abhijit Muhurat' };

            const vara = getVara();
            const tithi = getTithi();

            // Abhijit Muhurat is around midday (approximately 11:36 AM to 12:24 PM)
            // Adjust based on rashi element
            const elementTimes = {
                'Agni (Fire)': { base: 10, label: 'Morning fire energy' },
                'Prithvi (Earth)': { base: 11, label: 'Stable midday' },
                'Vayu (Air)': { base: 14, label: 'Afternoon movement' },
                'Jala (Water)': { base: 15, label: 'Flowing afternoon' }
            };

            const elementTime = elementTimes[rashi.element] || elementTimes['Prithvi (Earth)'];
            const dobDay = dobString ? new Date(dobString).getDate() : 15;
            const offset = (dobDay % 3) - 1;
            const startHour = elementTime.base + offset;
            const startMin = (dobDay % 4) * 15;

            return {
                time: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')} - ${(startHour + 1).toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`,
                reason: `${vara.name} • ${tithi.name} ${tithi.paksha}`,
                element: elementTime.label
            };
        };

        // Dasha Period (simplified - actual requires exact birth time)
        // Vimshottari Dasha Calculation (Full 120-year system)
        const getVimshottariDasha = (moonLonParam, dobString) => {
            const moonLongitude = parseFloat(moonLonParam);
            if (isNaN(moonLongitude) || !dobString) return null;

            const dashaPlanets = [
                { name: 'Ketu', years: 7, theme: 'Detachment & Spirituality' },
                { name: 'Shukra', years: 20, theme: 'Luxury & Relationships' },
                { name: 'Surya', years: 6, theme: 'Authority & Recognition' },
                { name: 'Chandra', years: 10, theme: 'Emotions & Nurturing' },
                { name: 'Mangal', years: 7, theme: 'Action & Courage' },
                { name: 'Rahu', years: 18, theme: 'Material Pursuits & Ambition' },
                { name: 'Guru', years: 16, theme: 'Wisdom & Expansion' },
                { name: 'Shani', years: 19, theme: 'Discipline & Karma' },
                { name: 'Budha', years: 17, theme: 'Intelligence & Communication' }
            ];

            const nakDuration = 360 / 27; // 13.3333 degrees
            const nakIndex = Math.floor(moonLongitude / nakDuration);
            const moonInNak = moonLongitude % nakDuration;
            const remainingPortion = (nakDuration - moonInNak) / nakDuration;

            const startPlanetIdx = nakIndex % 9;
            const birthDate = new Date(dobString);

            let timeline = [];
            let currentPointer = new Date(birthDate);

            // Calculate first dasha (pro-rated)
            const firstPlanet = dashaPlanets[startPlanetIdx];
            const firstDurationDays = (firstPlanet.years * 365.25) * remainingPortion;
            currentPointer.setDate(currentPointer.getDate() + firstDurationDays);

            timeline.push({
                planet: firstPlanet.name,
                end: new Date(currentPointer),
                theme: firstPlanet.theme,
                isFirst: true
            });

            // Calculate subsequent dashas (Full periods)
            for (let i = 1; i < 9; i++) {
                const planetIdx = (startPlanetIdx + i) % 9;
                const planet = dashaPlanets[planetIdx];
                currentPointer.setDate(currentPointer.getDate() + (planet.years * 365.25));
                timeline.push({
                    planet: planet.name,
                    end: new Date(currentPointer),
                    theme: planet.theme
                });
            }

            const now = new Date();
            const currentDasha = timeline.find(d => d.end > now) || timeline[timeline.length - 1];

            return {
                current: currentDasha,
                timeline: timeline
            };
        };

        // Vedic Compatibility (different from Western)
        const getVedicCompatibility = (rashi) => {
            if (!rashi) return [];
            const compatibility = {
                Mesha: ['Simha', 'Dhanu', 'Mithuna'],
                Vrishabha: ['Kanya', 'Makara', 'Karka'],
                Mithuna: ['Tula', 'Kumbha', 'Mesha'],
                Karka: ['Vrishchika', 'Meena', 'Vrishabha'],
                Simha: ['Mesha', 'Dhanu', 'Mithuna'],
                Kanya: ['Vrishabha', 'Makara', 'Karka'],
                Tula: ['Mithuna', 'Kumbha', 'Simha'],
                Vrishchika: ['Karka', 'Meena', 'Kanya'],
                Dhanu: ['Mesha', 'Simha', 'Tula'],
                Makara: ['Vrishabha', 'Kanya', 'Tula'],
                Kumbha: ['Mithuna', 'Tula', 'Dhanu'],
                Meena: ['Karka', 'Vrishchika', 'Makara']
            };
            return compatibility[rashi.rashi] || [];
        };

        // Planetary Transit Advice (simplified daily)
        const getPlanetaryAdvice = (rashi) => {
            if (!rashi) return { advice: 'Seek planetary guidance', planet: 'General' };

            const today = new Date();
            const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));

            const advices = [
                { advice: 'Surya transits favor bold decisions', planet: 'Surya', emoji: '☀️' },
                { advice: 'Chandra enhances intuition today', planet: 'Chandra', emoji: '🌙' },
                { advice: 'Mangal brings energy for action', planet: 'Mangal', emoji: '🔴' },
                { advice: 'Budha sharpens analytical thinking', planet: 'Budha', emoji: '💚' },
                { advice: 'Guru expands opportunities', planet: 'Guru', emoji: '💛' },
                { advice: 'Shukra attracts prosperity', planet: 'Shukra', emoji: '💎' },
                { advice: 'Shani rewards patience', planet: 'Shani', emoji: '🔵' },
                { advice: 'Rahu pushes boundaries', planet: 'Rahu', emoji: '🌑' },
                { advice: 'Ketu brings spiritual insights', planet: 'Ketu', emoji: '🔮' }
            ];

            const index = (dayOfYear + rashi.rashi.charCodeAt(0)) % advices.length;
            return advices[index];
        };


        const totalValue = stocks.reduce((sum, s) => {
            const currentUnits = parseFloat(s.units) || 0;
            const livePrice = getLTP(s.symbol);

            const currentValue = livePrice > 0 ? (livePrice * currentUnits) : (parseFloat(s.value) || 0);
            return sum + currentValue;
        }, 0);
        const totalInvestment = stocks.reduce((sum, s) => sum + (parseFloat(s.investment) || 0), 0);
        const totalPL = totalValue - totalInvestment;
        const totalPLPercent = totalInvestment > 0 ? ((totalPL / totalInvestment) * 100).toFixed(2) : 0;

        const goalProgress = Math.min(100, (totalValue / portfolioGoal) * 100).toFixed(1);



        const now = new Date();
        const nepalTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kathmandu" }));
        const dayOfWeek = nepalTime.getDay();
        const isTradingDay = dayOfWeek >= 0 && dayOfWeek <= 4;
        const dailyChanges = stocks.map(s => {
            const apiPrevClose = getPrevClose(s.symbol);
            const prevClose = apiPrevClose > 0 ? apiPrevClose : (s.prevClose || 0);
            const currentPrice = s.ltp || 0;
            const dailyChange = (prevClose > 0 && currentPrice > 0) ? (currentPrice - prevClose) : 0;
            const dailyChangePct = prevClose > 0 ? ((dailyChange / prevClose) * 100) : 0;
            return {
                ...s,
                prevClose,
                ltp: currentPrice,
                dailyChange,
                dailyChangePct
            };
        });

        const hasPrevCloseData = Object.keys(marketData).length > 0 || stocks.some(s => s.prevClose > 0);

        let dailyGainers = [], dailyLosers = [], dailyChartTitle = "Today's";

        if (hasPrevCloseData) {
            dailyChartTitle = isTradingDay ? "Today's" : "Latest Session";

            const actualChanges = dailyChanges.filter(s => Math.abs(s.dailyChange) > 0.01);

            dailyGainers = [...actualChanges]
                .filter(s => s.dailyChange > 0)
                .sort((a, b) => b.dailyChangePct - a.dailyChangePct)
                .slice(0, 5);

            dailyLosers = [...actualChanges]
                .filter(s => s.dailyChange < 0)
                .sort((a, b) => a.dailyChangePct - b.dailyChangePct)
                .slice(0, 5);
        } else {
            dailyChartTitle = "Daily";

        }

        const maxDailyGain = dailyGainers.length > 0 ? dailyGainers[0].dailyChangePct : 1;
        const maxDailyLoss = dailyLosers.length > 0 ? Math.abs(dailyLosers[0].dailyChangePct) : 1;


        const sectorData = {};
        stocks.forEach(s => {
            const sector = CONSTANTS.SECTORS[s.symbol] || 'Others';
            if (!sectorData[sector]) {
                sectorData[sector] = { value: 0, count: 0, investment: 0, profit: 0 };
            }
            sectorData[sector].value += s.value || 0;
            sectorData[sector].count += 1;
            sectorData[sector].investment += s.investment || 0;
            sectorData[sector].profit += (s.value - s.investment);
        });


        const stocksWithReturn = stocks.map(s => ({
            ...s,
            returnAmt: s.value - s.investment,
            returnPct: s.investment > 0 ? ((s.value - s.investment) / s.investment) * 100 : 0
        }));

        const top5Gainers = [...stocksWithReturn]
            .filter(s => s.returnAmt > 0)
            .sort((a, b) => b.returnAmt - a.returnAmt)
            .slice(0, 5);

        const top5Losers = [...stocksWithReturn]
            .filter(s => s.returnAmt < 0)
            .sort((a, b) => a.returnAmt - b.returnAmt)
            .slice(0, 5);

        const maxGain = top5Gainers.length > 0 ? top5Gainers[0].returnAmt : 1;
        const maxLoss = top5Losers.length > 0 ? Math.abs(top5Losers[0].returnAmt) : 1;




        const stocksInProfit = stocksWithReturn.filter(s => s.returnAmt > 0).length;
        const stocksInLoss = stocksWithReturn.filter(s => s.returnAmt < 0).length;
        const stocksBreakeven = stocksWithReturn.filter(s => s.returnAmt === 0).length;
        const profitAmount = stocksWithReturn.filter(s => s.returnAmt > 0).reduce((sum, s) => sum + s.returnAmt, 0);
        const lossAmount = Math.abs(stocksWithReturn.filter(s => s.returnAmt < 0).reduce((sum, s) => sum + s.returnAmt, 0));


        const capitalAtRisk = stocksWithReturn.filter(s => s.returnAmt < 0).reduce((sum, s) => sum + s.value, 0);


        const heavyweights = [...stocks]
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
            .map(s => ({
                ...s,
                weight: totalValue > 0 ? ((s.value / totalValue) * 100).toFixed(1) : 0
            }));
        const maxWeight = heavyweights.length > 0 ? parseFloat(heavyweights[0].weight) : 1;


        const concentrationThreshold = 15;
        const concentratedStocks = stocks
            .filter(s => totalValue > 0 && ((s.value / totalValue) * 100) > concentrationThreshold)
            .map(s => ({
                symbol: s.symbol,
                weight: ((s.value / totalValue) * 100).toFixed(1)
            }));


        const returns = stocksWithReturn.map(s => s.returnPct);
        const avgReturn = returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) : 0;
        const sortedReturns = [...returns].sort((a, b) => a - b);
        const medianReturn = sortedReturns.length > 0 ? sortedReturns[Math.floor(sortedReturns.length / 2)] : 0;
        const bestPerformer = stocksWithReturn.length > 0 ? [...stocksWithReturn].sort((a, b) => b.returnPct - a.returnPct)[0] : null;
        const worstPerformer = stocksWithReturn.length > 0 ? [...stocksWithReturn].sort((a, b) => a.returnPct - b.returnPct)[0] : null;


        const profitRatio = stocks.length > 0 ? (stocksInProfit / stocks.length) : 0;
        const diversificationScore = Math.min(100, (Object.keys(sectorData).length / 8) * 100);
        const concentrationPenalty = concentratedStocks.length * 10;
        const returnBonus = Math.min(30, Math.max(0, avgReturn));
        const healthScore = Math.round(Math.max(0, Math.min(100,
            (profitRatio * 40) + (diversificationScore * 0.3) + returnBonus - concentrationPenalty
        )));

        const topSector = Object.entries(sectorData).sort((a, b) => b[1].value - a[1].value)[0];
        const sectorConcentrationPct = topSector && totalValue > 0 ? ((topSector[1].value / totalValue) * 100).toFixed(1) : 0;
        const isOverConcentrated = sectorConcentrationPct > 40;


        const returnBuckets = {
            'Below -20%': stocksWithReturn.filter(s => s.returnPct < -20).length,
            '-20% to -10%': stocksWithReturn.filter(s => s.returnPct >= -20 && s.returnPct < -10).length,
            '-10% to 0%': stocksWithReturn.filter(s => s.returnPct >= -10 && s.returnPct < 0).length,
            '0% to 10%': stocksWithReturn.filter(s => s.returnPct >= 0 && s.returnPct < 10).length,
            '10% to 25%': stocksWithReturn.filter(s => s.returnPct >= 10 && s.returnPct < 25).length,
            'Above 25%': stocksWithReturn.filter(s => s.returnPct >= 25).length,
        };
        const maxBucket = Math.max(...Object.values(returnBuckets), 1);


        const valueRanges = {
            'Under 25K': stocks.filter(s => s.value < 25000).length,
            '25K - 50K': stocks.filter(s => s.value >= 25000 && s.value < 50000).length,
            '50K - 100K': stocks.filter(s => s.value >= 50000 && s.value < 100000).length,
            '100K - 250K': stocks.filter(s => s.value >= 100000 && s.value < 250000).length,
            'Above 250K': stocks.filter(s => s.value >= 250000).length,
        };
        const maxValueRange = Math.max(...Object.values(valueRanges), 1);


        const sortedSectors = Object.entries(sectorData)
            .sort((a, b) => b[1].value - a[1].value);


        const maxSectorValue = sortedSectors.length > 0 ? sortedSectors[0][1].value : 1;
        const sectorChartBars = sortedSectors.map(([sector, data]) => {
            const color = CONSTANTS.SECTOR_COLORS[sector] || '#64748b';
            const pct = totalValue > 0 ? ((data.value / totalValue) * 100).toFixed(1) : 0;
            const barWidth = (data.value / maxSectorValue) * 100;
            return { sector, color, pct, barWidth, value: data.value, count: data.count };
        });


        const theme = isDarkMode ? {
            bg: '#0f172a',
            cardBg: '#1e293b',
            cardBorder: 'rgba(51,65,85,0.5)',
            text: '#f1f5f9',
            textMuted: '#94a3b8',
            textDim: '#64748b',
            tableBorder: '#1e293b',
            tableHeaderBg: 'rgba(15,23,42,0.6)',
            tableHover: 'rgba(30,41,59,0.5)',
            footerBg: 'rgba(15,23,42,0.4)'
        } : {
            bg: '#f8fafc',
            cardBg: '#ffffff',
            cardBorder: '#e2e8f0',
            text: '#0f172a',
            textMuted: '#475569',
            textDim: '#64748b',
            tableBorder: '#e2e8f0',
            tableHeaderBg: '#f1f5f9',
            tableHover: '#f8fafc',
            footerBg: '#f1f5f9'
        };


        const generateTableRows = (stockList) => stockList.map(s => {
            const returnAmt = s.value - s.investment;
            const returnPct = s.investment > 0 ? ((returnAmt / s.investment) * 100).toFixed(2) : 0;
            const isProfit = returnAmt >= 0;


            const breakevenAmt = returnAmt < 0 ? Math.abs(returnAmt) : 0;
            const breakevenPct = returnAmt < 0 && s.value > 0 ? ((breakevenAmt / s.value) * 100).toFixed(2) : 0;



            const targetPrice = s.units > 0 ? ((s.investment + 25) / (s.units * 0.99585)).toFixed(2) : 0;
            const goalPrice = s.units > 0 ? ((s.investment * 1.20 + 25) / (s.units * 0.99585)).toFixed(2) : 0;


            const journeyPct = isProfit ? 100 : Math.min(100, Math.max(0, (s.ltp / (s.cost || 1)) * 100));

            const returnColor = isProfit ? '#10b981' : '#ef4444';
            const returnBg = isProfit ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';


            const sector = CONSTANTS.SECTORS[s.symbol] || 'Others';
            const sectorColor = CONSTANTS.SECTOR_COLORS[sector] || '#64748b';


            const hasAlert = priceAlerts.some(a => a.symbol === s.symbol && !a.triggered);
            const hasNote = scriptNotes[s.symbol] && scriptNotes[s.symbol].trim().length > 0;


            const bonusUnits = bonusShares[s.symbol] || 0;
            const adjWACC = bonusUnits > 0 ? (s.investment / (s.units + bonusUnits)) : (s.cost || 0);

            const mask = (val) => numbersHidden ? '•••••' : val;

            return `
            <tr class="ms-table-row" style="border-bottom: 1px solid ${theme.tableBorder}; transition: all 0.2s;"
                data-symbol="${s.symbol}"
                data-sector="${sector}"
                data-units="${s.units}"
                data-ltp="${s.ltp}"
                data-cost="${s.cost || 0}"
                data-investment="${s.investment}"
                data-value="${s.value}"
                data-returnamt="${returnAmt}"
                data-returnpct="${returnPct}"
                data-weight="${totalValue > 0 ? ((s.value / totalValue) * 100).toFixed(1) : 0}">

                    <td style="padding: 10px 4px 10px 20px; font-weight: 700; color: ${theme.text}; white-space: nowrap;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${scripNamesHidden ? '••••' : s.symbol}
                            ${corporateActions.filter(a => a.symbol === s.symbol).map(a => `
                                <span title="${a.type}: ${a.bonus || a.ratio}" style="padding: 2px 4px; border-radius: 4px; background: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}20; color: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}; font-size: 0.55rem; font-weight: 800; border: 1px solid ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}40;">
                                    ${a.type === 'Dividend' ? 'DIV' : 'RIGHT'}
                                </span>
                            `).join('')}
                        </div>
                    </td>
                    <td style="padding: 10px 4px;">
                        <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; background: ${sectorColor}20; color: ${sectorColor}; font-weight: 600; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer;">${scripNamesHidden ? '••••' : sector}</span>
                    </td>
                    <td style="padding: 10px 4px; text-align: right; font-weight: 500; color: ${theme.text};">${mask(s.units.toLocaleString())}</td>
                    <td style="padding: 10px 4px; text-align: right; font-weight: 600; color: #0ea5e9;">${scripNamesHidden ? '••••' : s.ltp.toLocaleString()}</td>
                    <td style="padding: 10px 4px; text-align: right; color: ${theme.textDim};">${numbersHidden ? '•••' : (s.cost ? s.cost.toFixed(2) : '0')}</td>
                    <td style="padding: 10px 4px; text-align: right; font-weight: 500; color: ${theme.text};">${mask(Math.round(s.investment).toLocaleString())}</td>
                    <td style="padding: 10px 4px; text-align: right; font-weight: 600; color: ${theme.text};">${mask(Math.round(s.value).toLocaleString())}</td>
                    <td style="padding: 10px 4px; text-align: right; font-weight: 700; color: ${totalValue > 0 && ((s.value / totalValue) * 100) > concentrationThreshold ? '#ef4444' : '#8b5cf6'};">${numbersHidden ? '••' : (totalValue > 0 ? ((s.value / totalValue) * 100).toFixed(1) : '0')}%</td>
                    <td style="padding: 10px 4px; text-align: right;">
                        <span style="display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border-radius: 8px; background: ${returnBg}; color: ${returnColor}; font-weight: 700; font-size: 0.75rem; white-space: nowrap;">
                            ${numbersHidden ? '••••' : ((isProfit ? '+' : '') + Math.round(returnAmt).toLocaleString())}
                            <span style="opacity: 0.8; font-size: 0.7rem;">(${numbersHidden ? '••' : (isProfit ? '+' : '') + returnPct}%)</span>
                        </span>
                    </td>
                    <td style="padding: 10px 4px; text-align: right;">
                        ${!isProfit ? `
                            <div style="width: 100%; display: flex; flex-direction: column; align-items: flex-end;">
                                <div style="width: 100%; height: 6px; background: ${isDarkMode ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)'}; border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
                                    <div style="width: ${journeyPct}%; height: 100%; background: #f59e0b; border-radius: 3px;"></div>
                                </div>
                                <span style="font-size: 0.65rem; font-weight: 800; color: #f59e0b; margin-bottom: 2px;">Target: Rs. ${numbersHidden ? '••••' : targetPrice}</span>
                                <span style="font-size: 0.55rem; font-weight: 700; color: ${theme.textDim}; opacity: 0.8;">Goal (20%): Rs. ${numbersHidden ? '••••' : goalPrice}</span>
                            </div>
                        ` : `
                            <div style="width: 100%; display: flex; flex-direction: column; align-items: flex-end;">
                                <span style="color: #10b981; font-weight: 800; font-size: 0.7rem; display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
                                    <span class="material-icons-round" style="font-size: 14px;">verified</span>
                                    Profitable
                                </span>
                                <span style="font-size: 0.55rem; font-weight: 700; color: ${theme.textDim}; opacity: 0.8;">Goal (20%): Rs. ${numbersHidden ? '••••' : goalPrice}</span>
                            </div>
                        `}
                    </td>
                    <td style="padding: 10px 20px 10px 4px; text-align: center;">
                        <div style="display: flex; justify-content: center; gap: 4px;">
                            <button class="ms-tool-btn ms-bonus-btn" data-symbol="${s.symbol}" title="Add/Edit Pending Bonus Shares" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${res.bonusShares?.[s.symbol] ? '#f59e0b' : theme.cardBorder}; background: ${res.bonusShares?.[s.symbol] ? 'rgba(245,158,11,0.1)' : 'transparent'}; color: ${res.bonusShares?.[s.symbol] ? '#f59e0b' : theme.textDim}; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">card_giftcard</span>
                            </button>
                            <button class="ms-tool-btn ms-simulator-btn" data-symbol="${s.symbol}" title="Exit Planner / Profit Simulator" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${theme.cardBorder}; background: transparent; color: #10b981; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">calculate</span>
                            </button>
                            <button class="ms-tool-btn ms-alert-btn" data-symbol="${s.symbol}" title="Manage Price Alerts" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${hasAlert ? '#3b82f6' : theme.cardBorder}; background: ${hasAlert ? 'rgba(59,130,246,0.1)' : 'transparent'}; color: ${hasAlert ? '#3b82f6' : theme.textDim}; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">${hasAlert ? 'notifications_active' : 'notifications_none'}</span>
                            </button>
                            <button class="ms-tool-btn ms-note-btn" data-symbol="${s.symbol}" title="View/Edit Script Notes" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${hasNote ? '#8b5cf6' : theme.cardBorder}; background: ${hasNote ? 'rgba(139,92,246,0.1)' : 'transparent'}; color: ${hasNote ? '#8b5cf6' : theme.textDim}; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">${hasNote ? 'sticky_note_2' : 'note_add'}</span>
                            </button>
                            <button class="ms-tool-btn ms-row-sizing-btn" data-symbol="${s.symbol}" data-ltp="${s.ltp}" title="Calculate Position Size for ${s.symbol}" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${theme.cardBorder}; background: transparent; color: #8b5cf6; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">straighten</span>
                            </button>
                            <button class="ms-tool-btn ms-row-wacc-btn" data-symbol="${s.symbol}" data-units="${s.units}" data-cost="${s.cost || 0}" data-ltp="${s.ltp}" title="WACC Simulator (Average Down) for ${s.symbol}" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${theme.cardBorder}; background: transparent; color: #3b82f6; cursor: pointer; transition: all 0.2s;">
                                <span class="material-icons-round" style="font-size: 16px;">trending_down</span>
                            </button>
                            <a href="https://nepsense.com/charts/${s.symbol}" target="_blank" class="ms-tool-btn" title="View ${s.symbol} on Nepsense Chart" style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; border: 1px solid ${theme.cardBorder}; background: transparent; color: #0ea5e9; cursor: pointer; transition: all 0.2s; text-decoration: none;">
                                <span class="material-icons-round" style="font-size: 16px;">show_chart</span>
                            </a>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');


        let growthTrend = 0;
        let trendColor = theme.textDim;
        let trendIcon = 'summarize';
        if (netWorthHistory && netWorthHistory.length > 1) {
            const current = totalValue;
            const weekAgoEntry = netWorthHistory[netWorthHistory.length - 7] || netWorthHistory[0];
            const prevValue = weekAgoEntry.value;
            growthTrend = (((current - prevValue) / Math.max(1, prevValue)) * 100).toFixed(1);
            trendColor = growthTrend >= 0 ? '#10b981' : '#ef4444';
            trendIcon = growthTrend >= 0 ? 'trending_up' : 'trending_down';
        }

        const tableRows = generateTableRows(stocks);



        panel.style.backgroundColor = theme.bg;

        panel.textContent = '';
        const build = (html) => document.createRange().createContextualFragment(html);


        const headerHTML = `
            <div style="max-width: 1600px; margin: 0 auto; padding: 24px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; min-height: 100%; box-sizing: border-box;">
                <header class="ms-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; gap: 20px;">
                    <div>
                        <h1 style="margin: 0 0 8px 0; font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; color: ${theme.text};">Portfolio Analytics</h1>
                        <p style="margin: 0; color: ${theme.textDim}; font-size: 0.875rem; font-weight: 500; display: flex; align-items: center; gap: 8px;">
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; animation: pulse 2s infinite;"></span>
                            ${stocks.length} Scrips • Updated ${res.lastUpdated ? new Date(res.lastUpdated).toLocaleTimeString() : 'Just Now'}
                        </p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <button id="ms-hide-btn" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="${numbersHidden ? 'Show Numbers' : 'Hide Numbers'}">
                            <span class="material-icons-round" style="font-size: 20px;">${numbersHidden ? 'visibility_off' : 'visibility'}</span>
                        </button>
                        <button id="ms-hide-names-btn" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="${scripNamesHidden ? 'Show Scrip Names' : 'Hide Scrip Names'}">
                            <span class="material-icons-round" style="font-size: 20px;">${scripNamesHidden ? 'font_download' : 'font_download_off'}</span>
                        </button>
                        <button id="ms-pdf-btn" style="display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 12px; font-weight: 600; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Export Portfolio to PDF">
                            <span class="material-icons-round" style="font-size: 18px;">picture_as_pdf</span>
                            PDF
                        </button>
                        <button id="ms-csv-btn" style="display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 12px; font-weight: 600; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Export Portfolio to CSV">
                            <span class="material-icons-round" style="font-size: 18px;">table_view</span>
                            CSV
                        </button>
                        <div style="width: 1px; height: 24px; background: ${theme.cardBorder}; margin: 0 4px;"></div>
                        <button id="ms-backup-btn" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Backup All Data (Notes, Alerts, History)">
                            <span class="material-icons-round" style="font-size: 20px;">save</span>
                        </button>
                        <button id="ms-restore-btn" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Restore Data from Backup">
                            <span class="material-icons-round" style="font-size: 20px;">upload_file</span>
                        </button>
                        <button id="ms-theme-btn" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;">
                            <span class="material-icons-round" style="font-size: 20px;">${isDarkMode ? 'light_mode' : 'dark_mode'}</span>
                        </button>
                        <button id="ms-sync-btn" style="display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 0.875rem; border: none; background: #10b981; color: white; cursor: pointer; box-shadow: 0 8px 24px rgba(16,185,129,0.25); transition: all 0.2s;">
                            <span class="material-icons-round" style="font-size: 18px;">sync</span>
                            Sync
                        </button>
                        <button id="ms-notifications-btn" style="position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: ${portfolioActions.length > 0 ? '#f59e0b' : theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Corporate Action Notifications">
                            <span class="material-icons-round" style="font-size: 20px;">notifications</span>
                            ${portfolioActions.length > 0 ? `
                                <span style="position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; border-radius: 9px; background: #ef4444; color: white; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid ${theme.cardBg};">
                                    ${portfolioActions.length}
                                </span>
                            ` : ''}
                        </button>
                        <button id="ms-size-btn" style="display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 12px; font-weight: 700; font-size: 0.875rem; border: none; background: #8b5cf6; color: white; cursor: pointer; box-shadow: 0 8px 24px rgba(139,92,246,0.25); transition: all 0.2s;">
                            <span class="material-icons-round" style="font-size: 18px;">straighten</span>
                            Size
                        </button>
                        <button id="ms-close-btn" onclick="window.location.hash='#/portfolio'" style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; font-size: 0.875rem; border: 1px solid ${theme.cardBorder}; background: transparent; color: ${theme.textMuted}; cursor: pointer; transition: all 0.2s;" title="Exit Dashboard">
                            <span class="material-icons-round" style="font-size: 20px;">close</span>
                        </button>
                    </div>
                </header>

                <div class="ms-stat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 32px;">
                    <div style="background: ${theme.cardBg}; padding: 24px; border-radius: 16px; border: 1px solid ${theme.cardBorder}; background: linear-gradient(135deg, ${isDarkMode ? '#0f172a' : '#ffffff'}, ${isDarkMode ? '#1e293b' : '#f8fafc'});">
                        <p style="margin: 0 0 8px 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${theme.textDim};">Portfolio Value</p>
                        <div style="display: flex; align-items: baseline; gap: 6px;">
                            <span style="font-size: 1rem; font-weight: 600; color: #3b82f6;">Rs.</span>
                            <span style="font-size: 1.75rem; font-weight: 800; color: ${theme.text};">${numbersHidden ? '•••••••' : Math.round(totalValue).toLocaleString()}</span>
                        </div>
                    </div>
                    <div style="background: ${theme.cardBg}; padding: 24px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                        <p style="margin: 0 0 8px 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${theme.textDim};">Investment</p>
                        <div style="display: flex; align-items: baseline; gap: 6px;">
                            <span style="font-size: 1rem; font-weight: 600; color: ${theme.textDim};">Rs.</span>
                            <span style="font-size: 1.75rem; font-weight: 800; color: ${theme.text};">${numbersHidden ? '•••••••' : Math.round(totalInvestment).toLocaleString()}</span>
                        </div>
                    </div>
                    <div style="background: ${theme.cardBg}; padding: 24px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                        <p style="margin: 0 0 8px 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${theme.textDim};">Profit/Loss</p>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 800; color: ${totalPL >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '•••••••' : ((totalPL > 0 ? '+' : '') + Math.round(totalPL).toLocaleString())}</span>
                            <span style="display: flex; align-items: center; font-size: 0.875rem; font-weight: 700; color: ${totalPL >= 0 ? '#10b981' : '#ef4444'};">
                                <span class="material-icons-round" style="font-size: 18px;">${totalPL >= 0 ? 'trending_up' : 'trending_down'}</span>
                                ${numbersHidden ? '••' : Math.abs(totalPLPercent)}%
                            </span>
                        </div>
                    </div>
                    <div style="background: ${theme.cardBg}; padding: 24px; border-radius: 16px; border: 1px solid ${theme.cardBorder}; cursor: pointer;" onclick="document.getElementById('ms-health-modal').style.display='flex'">
                        <p style="margin: 0 0 8px 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${theme.textDim};">Portfolio Health</p>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-size: 1.75rem; font-weight: 800; color: ${healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444'};">${healthScore}</span>
                            <span class="material-icons-round" style="font-size: 24px; color: ${healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444'};">health_and_safety</span>
                        </div>
                    </div>
                    <div id="ms-goal-card" style="background: ${theme.cardBg}; padding: 24px; border-radius: 16px; border: 1px solid ${theme.cardBorder}; cursor: pointer; position: relative; overflow: hidden;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                            <p style="margin: 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${theme.textDim};">Goal Progress</p>
                            <span class="material-icons-round" style="font-size: 16px; color: ${theme.textDim};">edit</span>
                        </div>
                        <div style="display: flex; align-items: baseline; gap: 6px;">
                            <span style="font-size: 1.75rem; font-weight: 800; color: ${theme.text};">${numbersHidden ? '••' : goalProgress}%</span>
                            <span style="font-size: 0.8rem; font-weight: 600; color: ${theme.textDim};">to Rs. ${numbersHidden ? '••••' : (portfolioGoal / 100000).toFixed(1) + 'L'}</span>
                        </div>
                        <div style="position: absolute; bottom: 0; left: 0; width: 100%; height: 6px; background: ${isDarkMode ? '#334155' : '#e2e8f0'};">
                            <div style="width: ${goalProgress}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 1s ease-out;"></div>
                        </div>
                    </div>
                    </div>
        `;


        const allHTML = headerHTML;


        const analyticsRowsHTML = `
            <div class="ms-stat-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
                <div style="background: ${theme.cardBg}; padding: 20px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(16,185,129,0.15); display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 20px; color: #10b981;">trending_up</span>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${theme.textDim};">In Profit</p>
                            <p style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #10b981;">${numbersHidden ? '••' : stocksInProfit} <span style="font-size: 0.7rem; font-weight: 600;">stocks</span></p>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">Gain: <span style="color: #10b981; font-weight: 600;">${numbersHidden ? '•••••' : ('Rs. ' + Math.round(profitAmount).toLocaleString())}</span></p>
                </div>
                <div style="background: ${theme.cardBg}; padding: 20px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(239,68,68,0.15); display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 20px; color: #ef4444;">trending_down</span>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${theme.textDim};">In Loss</p>
                            <p style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #ef4444;">${numbersHidden ? '••' : stocksInLoss} <span style="font-size: 0.7rem; font-weight: 600;">stocks</span></p>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">Loss: <span style="color: #ef4444; font-weight: 600;">${numbersHidden ? '•••••' : ('Rs. ' + Math.round(lossAmount).toLocaleString())}</span></p>
                </div>
                <div style="background: ${theme.cardBg}; padding: 20px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(251,191,36,0.15); display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 20px; color: #f59e0b;">warning</span>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${theme.textDim};">Capital at Risk</p>
                            <p style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #f59e0b;">${numbersHidden ? '•••••' : ('Rs. ' + Math.round(capitalAtRisk).toLocaleString())}</p>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">In loss-making stocks</p>
                </div>
                <div style="background: ${theme.cardBg}; padding: 20px; border-radius: 16px; border: 1px solid ${theme.cardBorder};">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(139,92,246,0.15); display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 20px; color: #8b5cf6;">analytics</span>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: ${theme.textDim};">Avg Return</p>
                            <p style="margin: 0; font-size: 1.25rem; font-weight: 800; color: ${avgReturn >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '••' : (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1)}%</p>
                        </div>
                    </div>
                    <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">Median: <span style="color: ${medianReturn >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">${numbersHidden ? '••' : (medianReturn >= 0 ? '+' : '') + medianReturn.toFixed(1)}%</span></p>
                </div>
            </div>

            ${concentratedStocks.length > 0 ? `
                <div style="background: linear-gradient(135deg, rgba(251,191,36,0.1), rgba(245,158,11,0.05)); padding: 16px 20px; border-radius: 12px; border: 1px solid rgba(251,191,36,0.3); margin-bottom: 24px; display: flex; align-items: center; gap: 16px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(251,191,36,0.2); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <span class="material-icons-round" style="font-size: 24px; color: #f59e0b;">warning_amber</span>
                    </div>
                    <div style="flex: 1;">
                        <p style="margin: 0 0 4px 0; font-size: 0.85rem; font-weight: 700; color: #f59e0b;">Concentration Risk Detected</p>
                        <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">${concentratedStocks.map(s => `<strong>${scripNamesHidden ? '••••' : s.symbol}</strong> (${s.weight}%)`).join(', ')} ${concentratedStocks.length === 1 ? 'is' : 'are'} above ${concentrationThreshold}% of your portfolio. Consider diversifying.</p>
                    </div>
                </div>
            ` : ''
            }
        `;
        const allHTML2 = allHTML + analyticsRowsHTML;


        const performersHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <div style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: #8b5cf6; display: flex; align-items: center; gap: 8px;">
                        <span class="material-icons-round" style="font-size: 18px;">account_balance_wallet</span>
                        Top 5 Heavyweights
                    </h3>
                    ${heavyweights.map((s, i) => `
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${i < 4 ? '12px' : '0'};">
                            <span style="width: 20px; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim};">#${i + 1}</span>
                            <span style="width: 60px; font-size: 0.8rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : s.symbol}</span>
                            <div style="flex: 1; height: 24px; background: ${isDarkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.08)'}; border-radius: 6px; position: relative; display: flex; align-items: center;">
                                ${(() => {
                const pct = (parseFloat(s.weight) / maxWeight) * 100;
                const label = numbersHidden ? '•••••' : ('Rs. ' + Math.round(s.value).toLocaleString());
                return `
                                        <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #8b5cf6, #a78bfa); border-radius: 6px;"></div>
                                        <span style="position: absolute; left: ${Math.max(pct, 2)}%; transform: translateX(${pct > 35 ? 'calc(-100% - 8px)' : '8px'}); font-size: 0.7rem; font-weight: 700; color: ${pct > 35 ? 'white' : theme.text}; text-shadow: ${pct > 35 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'}; white-space: nowrap; pointer-events: none;">
                                            ${label}
                                        </span>
                                    `;
            })()}
                            </div>
                            <span style="width: 50px; text-align: right; font-size: 0.7rem; font-weight: 600; color: #8b5cf6;">${numbersHidden ? '••' : s.weight}%</span>
                        </div>
                    `).join('')}
                </div>

                <div style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                        <span class="material-icons-round" style="font-size: 18px; color: ${theme.textDim};">emoji_events</span>
                        Best & Worst Performers
                    </h3>
                    ${bestPerformer ? `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: rgba(16,185,129,0.1); border-radius: 10px; margin-bottom: 12px;">
                        <div style="width: 36px; height: 36px; border-radius: 8px; background: #10b981; display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 18px; color: white;">arrow_upward</span>
                        </div>
                        <div style="flex: 1;">
                            <p style="margin: 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : bestPerformer.symbol}</p>
                            <p style="margin: 0; font-size: 0.7rem; color: ${theme.textDim};">Best performer</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="margin: 0; font-size: 0.9rem; font-weight: 700; color: ${bestPerformer.returnPct >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '••' : (bestPerformer.returnPct > 0 ? '+' : '') + bestPerformer.returnPct.toFixed(1)}%</p>
                            <p style="margin: 0; font-size: 0.7rem; color: ${bestPerformer.returnPct >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '••••' : ((bestPerformer.returnAmt > 0 ? '+Rs. ' : 'Rs. ') + Math.round(bestPerformer.returnAmt).toLocaleString())}</p>
                        </div>
                    </div>
                    ` : ''}
                    ${worstPerformer ? `
                    <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: rgba(239,68,68,0.1); border-radius: 10px;">
                        <div style="width: 36px; height: 36px; border-radius: 8px; background: #ef4444; display: flex; align-items: center; justify-content: center;">
                            <span class="material-icons-round" style="font-size: 18px; color: white;">arrow_downward</span>
                        </div>
                        <div style="flex: 1;">
                            <p style="margin: 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : worstPerformer.symbol}</p>
                            <p style="margin: 0; font-size: 0.7rem; color: ${theme.textDim};">Worst performer</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="margin: 0; font-size: 0.9rem; font-weight: 700; color: ${worstPerformer.returnPct >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '••' : (worstPerformer.returnPct > 0 ? '+' : '') + worstPerformer.returnPct.toFixed(1)}%</p>
                            <p style="margin: 0; font-size: 0.7rem; color: ${worstPerformer.returnPct >= 0 ? '#10b981' : '#ef4444'};">${numbersHidden ? '••••' : ((worstPerformer.returnAmt > 0 ? '+Rs. ' : 'Rs. ') + Math.round(worstPerformer.returnAmt).toLocaleString())}</p>
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
            `;
        const allHTML3 = allHTML2 + performersHTML;


        const remainingHTML = `
            <div style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 24px; margin-bottom: 24px;">
                    <h3 style="margin: 0 0 20px 0; font-size: 0.9rem; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                        <span class="material-icons-round" style="font-size: 20px; color: ${theme.textDim};">pie_chart</span>
                        Sector Distribution
                    </h3>
                    <div style="display: flex; gap: 40px; align-items: center; flex-wrap: wrap;">
                        <!-- Donut Chart -->
                        <div style="position: relative; width: 200px; height: 200px; flex-shrink: 0;">
                            <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                                ${(() => {
                let offset = 0;
                return sectorChartBars.map(s => {
                    const pctNum = parseFloat(s.pct);
                    const dashArray = `${pctNum} ${100 - pctNum}`;
                    const currentOffset = offset;
                    offset += pctNum;
                    return `<circle cx="50" cy="50" r="40" fill="none" stroke="${s.color}" stroke-width="20" stroke-dasharray="${dashArray}" stroke-dashoffset="-${currentOffset}" pathLength="100" />`;
                }).join('');
            })()}
                            </svg>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: 800; color: ${theme.text};">${sectorChartBars.length}</div>
                                <div style="font-size: 0.65rem; color: ${theme.textDim}; text-transform: uppercase; letter-spacing: 1px;">Sectors</div>
                            </div>
                        </div>
                        <!-- Legend -->
                        <div style="flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; min-width: 280px;">
                            ${sectorChartBars.map(s => `
                                <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px; background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; cursor: pointer; transition: all 0.2s;" onclick="document.getElementById('ms-sector-filter').value='${s.sector}'; document.getElementById('ms-sector-filter').dispatchEvent(new Event('change'));">
                                    <div style="width: 12px; height: 12px; border-radius: 3px; background: ${s.color}; flex-shrink: 0;"></div>
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <span style="font-size: 0.75rem; font-weight: 600; color: ${theme.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${scripNamesHidden ? '••••' : s.sector}</span>
                                            <span style="font-size: 0.7rem; font-weight: 700; color: ${s.color}; margin-left: 8px;">${numbersHidden ? '••' : s.pct}%</span>
                                        </div>
                                        <div style="font-size: 0.65rem; color: ${theme.textDim}; margin-top: 2px;">${numbersHidden ? '••' : s.count} scrip${s.count > 1 ? 's' : ''} • ${numbersHidden ? 'Rs. ••••' : ('Rs. ' + Math.round(s.value).toLocaleString())}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!--Top Gainers & Losers-->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-bottom: 24px; width: 100%; box-sizing: border-box;">
                    <!-- Top 5 Gainers -->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px;">trending_up</span>
                            Top 5 Gainers
                        </h3>
                        ${top5Gainers.length > 0 ? top5Gainers.map((s, i) => `
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${i < 4 ? '12px' : '0'};">
                                <span style="width: 20px; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim};">#${i + 1}</span>
                                <span style="width: 60px; font-size: 0.8rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : s.symbol}</span>
                                <div style="flex: 1; height: 24px; background: ${isDarkMode ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)'}; border-radius: 6px; position: relative; display: flex; align-items: center;">
                                    ${(() => {
                    const pct = (s.returnAmt / maxGain) * 100;
                    const label = numbersHidden ? '•••••' : ('+' + Math.round(s.returnAmt).toLocaleString());
                    return `
                                            <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399); border-radius: 6px;"></div>
                                            <span style="position: absolute; left: ${Math.max(pct, 2)}%; transform: translateX(${pct > 35 ? 'calc(-100% - 8px)' : '8px'}); font-size: 0.7rem; font-weight: 700; color: ${pct > 35 ? 'white' : theme.text}; text-shadow: ${pct > 35 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'}; white-space: nowrap; pointer-events: none;">
                                                ${label}
                                            </span>
                                        `;
                })()}
                                </div>
                                <span style="width: 55px; text-align: right; font-size: 0.7rem; font-weight: 600; color: #10b981;">${numbersHidden ? '••' : '+' + s.returnPct.toFixed(1)}%</span>
                            </div>
                        `).join('') : `<p style="color: ${theme.textDim}; font-size: 0.8rem; margin: 0;">No profitable stocks</p>`}
                    </div>

                    <!-- Top 5 Losers -->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: #ef4444; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px;">trending_down</span>
                            Top 5 Losers
                        </h3>
                        ${top5Losers.length > 0 ? top5Losers.map((s, i) => `
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${i < 4 ? '12px' : '0'};">
                                <span style="width: 20px; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim};">#${i + 1}</span>
                                <span style="width: 60px; font-size: 0.8rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : s.symbol}</span>
                                <div style="flex: 1; height: 24px; background: ${isDarkMode ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.08)'}; border-radius: 6px; position: relative; display: flex; align-items: center;">
                                    ${(() => {
                        const pct = (Math.abs(s.returnAmt) / maxLoss) * 100;
                        const label = numbersHidden ? '•••••' : Math.round(s.returnAmt).toLocaleString();
                        return `
                                            <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #ef4444, #f87171); border-radius: 6px;"></div>
                                            <span style="position: absolute; left: ${Math.max(pct, 2)}%; transform: translateX(${pct > 35 ? 'calc(-100% - 8px)' : '8px'}); font-size: 0.7rem; font-weight: 700; color: ${pct > 35 ? 'white' : theme.text}; text-shadow: ${pct > 35 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'}; white-space: nowrap; pointer-events: none;">
                                                ${label}
                                            </span>
                                        `;
                    })()}
                                </div>
                                <span style="width: 55px; text-align: right; font-size: 0.7rem; font-weight: 600; color: #ef4444;">${numbersHidden ? '••' : s.returnPct.toFixed(1)}%</span>
                            </div>
                        `).join('') : `<p style="color: ${theme.textDim}; font-size: 0.8rem; margin: 0;">No losing stocks</p>`}
                    </div>
                </div>

                <!--Daily Top 5 Gainers & Losers(Price Change)-->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-bottom: 24px; width: 100%; box-sizing: border-box;">
                    <!-- Daily Top 5 Gainers -->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: #0ea5e9; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px;">show_chart</span>
                            ${dailyChartTitle} Top 5 Gainers
                        </h3>
                        ${dailyGainers.length > 0 ? dailyGainers.map((s, i) => `
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${i < 4 ? '12px' : '0'};">
                                <span style="width: 20px; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim};">#${i + 1}</span>
                                <span style="width: 60px; font-size: 0.8rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : s.symbol}</span>
                                <div style="flex: 1; height: 24px; background: ${isDarkMode ? 'rgba(14,165,233,0.1)' : 'rgba(14,165,233,0.08)'}; border-radius: 6px; position: relative; display: flex; align-items: center;">
                                    ${(() => {
                            const pct = (s.dailyChangePct / maxDailyGain) * 100;
                            const label = numbersHidden ? '•••' : ('+' + s.dailyChange.toFixed(2));
                            return `
                                            <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); border-radius: 6px;"></div>
                                            <span style="position: absolute; left: ${Math.max(pct, 2)}%; transform: translateX(${pct > 35 ? 'calc(-100% - 8px)' : '8px'}); font-size: 0.7rem; font-weight: 700; color: ${pct > 35 ? 'white' : theme.text}; text-shadow: ${pct > 35 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'}; white-space: nowrap; pointer-events: none;">
                                                ${label}
                                            </span>
                                        `;
                        })()}
                                </div>
                                <span style="width: 55px; text-align: right; font-size: 0.7rem; font-weight: 600; color: #0ea5e9;">${numbersHidden ? '••' : '+' + s.dailyChangePct.toFixed(2)}%</span>
                            </div>
                        `).join('') : `<p style="color: ${theme.textDim}; font-size: 0.8rem; margin: 0;">No gainers recorded</p>`}
                    </div>

                    <!-- Daily Top 5 Losers -->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: #f97316; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px;">show_chart</span>
                            ${dailyChartTitle} Top 5 Losers
                        </h3>
                        ${dailyLosers.length > 0 ? dailyLosers.map((s, i) => `
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: ${i < 4 ? '12px' : '0'};">
                                <span style="width: 20px; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim};">#${i + 1}</span>
                                <span style="width: 60px; font-size: 0.8rem; font-weight: 700; color: ${theme.text};">${scripNamesHidden ? '••••' : s.symbol}</span>
                                <div style="flex: 1; height: 24px; background: ${isDarkMode ? 'rgba(249,115,22,0.1)' : 'rgba(249,115,22,0.08)'}; border-radius: 6px; position: relative; display: flex; align-items: center;">
                                    ${(() => {
                                const pct = (Math.abs(s.dailyChangePct) / maxDailyLoss) * 100;
                                const label = numbersHidden ? '•••' : s.dailyChange.toFixed(2);
                                return `
                                            <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #f97316, #fb923c); border-radius: 6px;"></div>
                                            <span style="position: absolute; left: ${Math.max(pct, 2)}%; transform: translateX(${pct > 35 ? 'calc(-100% - 8px)' : '8px'}); font-size: 0.7rem; font-weight: 700; color: ${pct > 35 ? 'white' : theme.text}; text-shadow: ${pct > 35 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'}; white-space: nowrap; pointer-events: none;">
                                                ${label}
                                            </span>
                                        `;
                            })()}
                                </div>
                                <span style="width: 55px; text-align: right; font-size: 0.7rem; font-weight: 600; color: #f97316;">${numbersHidden ? '••' : s.dailyChangePct.toFixed(2) + '%'}</span>
                            </div>
                        `).join('') : `<p style="color: ${theme.textDim}; font-size: 0.8rem; margin: 0;">No losers recorded</p>`}
                    </div>
                </div>

                <!--Sector Profit & Return Distribution-->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; margin-bottom: 24px; width: 100%; box-sizing: border-box;">
                    
                    <!-- Sector Profit Contribution -->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 24px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px; color: ${theme.textDim};">monetization_on</span>
                            Sector Profit Contribution
                        </h3>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${Object.entries(sectorData)
                .sort((a, b) => b[1].profit - a[1].profit)
                .slice(0, 5)
                .map(([sector, data]) => {
                    const maxProfit = Math.max(...Object.values(sectorData).map(d => Math.abs(d.profit)));
                    const width = (Math.abs(data.profit) / (maxProfit || 1)) * 100;
                    const color = data.profit >= 0 ? '#10b981' : '#ef4444';
                    return `
                                    <div style="display: flex; align-items: center; gap: 12px; cursor: pointer;" onclick="document.getElementById('ms-sector-filter').value='${sector}'; document.getElementById('ms-sector-filter').dispatchEvent(new Event('change'));">
                                        <span style="display: inline-block; width: 120px; font-size: 0.65rem; font-weight: 700; color: ${theme.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${scripNamesHidden ? '••••' : sector}">${scripNamesHidden ? '••••' : sector}</span>
                                        <div style="flex: 1; height: 16px; background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; border-radius: 4px; overflow: hidden; position: relative;">
                                            <div style="position: absolute; left: 0; width: ${width}%; height: 100%; background: ${color}; border-radius: 4px; opacity: 0.8;"></div>
                                        </div>
                                        <span style="width: 70px; text-align: right; font-size: 0.7rem; font-weight: 700; color: ${color};">${numbersHidden ? '•••' : (data.profit >= 0 ? '+' : '') + Math.round(data.profit).toLocaleString()}</span>
                                    </div>
                                `;
                }).join('')}
                        </div>
                    </div>

                    <!--Return Distribution-->
                    <div style="width: 100%; background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 24px;">
                        <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                            <span class="material-icons-round" style="font-size: 18px; color: ${theme.textDim};">bar_chart</span>
                            Return Distribution
                        </h3>
                        <div style="display: flex; gap: 8px; align-items: flex-end; height: 100px;">
                            ${Object.entries(returnBuckets).map(([label, count]) => {
                    const height = (count / maxBucket) * 100;
                    const isNegative = label.includes('-') || label.includes('Below');
                    const color = isNegative ? '#ef4444' : '#10b981';
                    return `
                                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer;" title="Filter by ${label}" onclick="document.getElementById('ms-search').value='${label.includes('Above') ? '>10' : label.includes('Below') ? '<-10' : ''}'; document.querySelector('.ms-filter-btn[data-filter=all]').click();">
                                        <div style="width: 100%; height: ${height}%; min-height: ${count > 0 ? '8px' : '2px'}; background: ${count > 0 ? color : (isDarkMode ? '#334155' : '#e2e8f0')}; border-radius: 4px; transition: height 0.3s; opacity: 0.8; hover: {opacity: 1};"></div>
                                        <span style="font-size: 0.6rem; color: ${theme.textDim}; text-align: center; white-space: nowrap;">${count}</span>
                                    </div>
                                `;
                }).join('')}
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            ${Object.keys(returnBuckets).map(label => `
                                <div style="flex: 1; font-size: 0.55rem; color: ${theme.textDim}; text-align: center; white-space: nowrap;">${label}</div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!--Value Ranges-->
                <div style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 20px; margin-bottom: 24px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 0.85rem; font-weight: 700; color: ${theme.text}; display: flex; align-items: center; gap: 8px;">
                        <span class="material-icons-round" style="font-size: 18px; color: ${theme.textDim};">account_balance</span>
                        Value Distribution
                    </h3>
                    <div style="display: flex; gap: 12px;">
                        ${Object.entries(valueRanges).map(([label, count]) => {
                    const width = (count / maxValueRange) * 100;
                    return `
                                <div style="flex: 1; background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; border-radius: 10px; padding: 12px; text-align: center; cursor: pointer; border: 1px solid transparent; transition: all 0.2s;" title="Filter by ${label}" onclick="document.getElementById('ms-search').value='${label}'; document.querySelector('.ms-filter-btn[data-filter=all]').click();">
                                    <div style="font-size: 1.25rem; font-weight: 800; color: #8b5cf6;">${count}</div>
                                    <div style="font-size: 0.65rem; color: ${theme.textDim}; margin-top: 4px;">${label}</div>
                                    <div style="width: 100%; height: 4px; background: ${isDarkMode ? '#334155' : '#e2e8f0'}; border-radius: 2px; margin-top: 8px; overflow: hidden;">
                                        <div style="width: ${width}%; height: 100%; background: linear-gradient(90deg, #8b5cf6, #a78bfa); border-radius: 2px;"></div>
                                    </div>
                                </div>
                            `;
                }).join('')}
                    </div>
                </div>

                <!--Search & Filter Bar-->
                <div class="ms-filter-bar" style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; padding: 16px 20px; margin-bottom: 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                    <!-- Search -->
                    <div style="flex: 1; min-width: 200px; position: relative;">
                        <span class="material-icons-round" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 18px; color: ${theme.textDim};">search</span>
                        <input id="ms-search" type="text" placeholder="Search stocks..." style="width: 100%; padding: 10px 12px 10px 40px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.85rem; outline: none;">
                    </div>
                    <!-- Filter Buttons -->
                    <div style="display: flex; gap: 8px;">
                        <button class="ms-filter-btn" data-filter="all" style="padding: 8px 16px; border-radius: 8px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#334155' : '#e2e8f0'}; color: ${theme.text}; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">All</button>
                        <button class="ms-filter-btn" data-filter="profit" style="padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">📈 Profit</button>
                        <button class="ms-filter-btn" data-filter="loss" style="padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; background: rgba(239,68,68,0.15); color: #ef4444; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">📉 Loss</button>
                    </div>
                    <!-- Sector Filter -->
                    <select id="ms-sector-filter" style="padding: 10px 12px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.85rem; cursor: pointer; outline: none;">
                        <option value="all">All Sectors</option>
                        ${Object.keys(sectorData).sort().map(s => `<option value="${s}">${scripNamesHidden ? '••••' : s}</option>`).join('')}
                    </select>
                </div>

                <!--Table -->
                <div class="ms-table-wrapper" style="background: ${theme.cardBg}; border-radius: 16px; border: 1px solid ${theme.cardBorder}; overflow: hidden; box-sizing: border-box; box-shadow: 0 4px 24px rgba(0,0,0,${isDarkMode ? '0.25' : '0.08'});">
                    <div style="overflow-x: auto;">
                        <table id="ms-portfolio-table" class="ms-portfolio-table" style="width: 100%; table-layout: fixed; border-collapse: collapse; text-align: left; font-size: 0.75rem;">
                            <thead>
                                <tr style="background: ${theme.tableHeaderBg};">
                                    <th class="ms-sortable" data-sort="symbol" style="padding: 10px 4px 10px 20px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; cursor: pointer; user-select: none; width: 90px;">Scrip Name <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="sector" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; cursor: pointer; user-select: none; width: 110px;">Sector <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="units" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 70px;">Units <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="ltp" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 70px;">LTP <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="cost" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 70px;">WACC <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="investment" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 100px;">Investment <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="value" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 100px;">Value <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="weight" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 70px;">Weight <span class="ms-sort-icon">↕</span></th>
                                    <th class="ms-sortable" data-sort="returnAmt" style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; cursor: pointer; user-select: none; width: 140px;">Total Return <span class="ms-sort-icon">↕</span></th>
                                    <th style="padding: 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: right; width: 170px;">Breakeven</th>
                                    <th style="padding: 10px 20px 10px 4px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${theme.textDim}; text-align: center; width: 250px;">Tools</th>
                                </tr>
                            </thead>
                            <tbody id="ms-table-body">
                                ${tableRows}
                                <tr id="ms-no-results" style="display: none;">
                                    <td colspan="10" style="padding: 60px 40px; text-align: center; color: ${theme.textDim};">
                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                                            <span class="material-icons-round" style="font-size: 48px; opacity: 0.2;">search_off</span>
                                            <span style="font-size: 0.9rem; font-weight: 500;">No matching stocks found.</span>
                                            <button onclick="document.getElementById('ms-search').value=''; document.getElementById('ms-sector-filter').value='all'; activeFilter='all'; applyFilters();" style="margin-top: 8px; padding: 6px 16px; border-radius: 6px; border: 1px solid ${theme.cardBorder}; background: ${theme.cardBg}; color: #8b5cf6; font-size: 0.7rem; font-weight: 700; cursor: pointer;">Clear all filters</button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="ms-simulator-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2147483647; align-items: center; justify-content: center;">
                    <div style="width: 100%; max-width: 450px; background: ${theme.cardBg}; border-radius: 24px; border: 1px solid ${theme.cardBorder}; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                            <div>
                                <h2 id="ms-sim-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: ${theme.text};">Exit Planner</h2>
                                <p style="margin: 4px 0 0 0; font-size: 0.75rem; color: ${theme.textDim};" id="ms-sim-subtitle"></p>
                            </div>
                            <button id="ms-close-sim" style="background: none; border: none; color: ${theme.textDim}; cursor: pointer;">
                                <span class="material-icons-round">close</span>
                            </button>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 20px;">
                            <div>
                                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Sell Price (Per Unit)</label>
                                <input id="ms-sim-price" type="number" step="0.1" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 1.1rem; font-weight: 700; outline: none; border-color: #3b82f6;">
                            </div>
                            
                            <div style="background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; border-radius: 16px; padding: 20px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                    <span style="font-size: 0.8rem; color: ${theme.textDim};">Total Turnover</span>
                                    <span id="ms-sim-turnover" style="font-size: 0.85rem; font-weight: 700; color: ${theme.text};">Rs. 0</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 0.75rem; color: ${theme.textDim};">Broker Commission</span>
                                    <span id="ms-sim-broker" style="font-size: 0.75rem; color: #ef4444;">- Rs. 0</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 0.75rem; color: ${theme.textDim};">SEBON Fee</span>
                                    <span id="ms-sim-sebon" style="font-size: 0.75rem; color: #ef4444;">- Rs. 0</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                                    <span style="font-size: 0.75rem; color: ${theme.textDim};">DP Fee</span>
                                    <span id="ms-sim-dp" style="font-size: 0.75rem; color: #ef4444;">- Rs. 25</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-top: 12px; border-top: 1px solid ${theme.cardBorder};">
                                    <span style="font-size: 0.8rem; color: ${theme.textDim};">Taxable Profit</span>
                                    <span id="ms-sim-taxable" style="font-size: 0.85rem; font-weight: 700; color: #10b981;">Rs. 0</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                                    <span style="font-size: 0.75rem; color: ${theme.textDim};">Cap. Gains Tax (7.5%)</span>
                                    <span id="ms-sim-tax" style="font-size: 0.75rem; color: #ef4444;">- Rs. 0</span>
                                </div>
                                
                                <div style="text-align: center; border-top: 2px dashed ${theme.cardBorder}; padding-top: 20px;">
                                    <div style="font-size: 0.7rem; font-weight: 700; color: ${theme.textDim}; text-transform: uppercase; margin-bottom: 4px;">Net Final Profit</div>
                                    <div id="ms-sim-net" style="font-size: 1.75rem; font-weight: 900; color: #10b981;">Rs. 0</div>
                                    <div id="ms-sim-net-pct" style="font-size: 0.8rem; font-weight: 700; color: #10b981; opacity: 0.8;">(+0.0%)</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div id="ms-health-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2147483647; align-items: center; justify-content: center;">
                    <div style="width: 100%; max-width: 500px; background: ${theme.cardBg}; border-radius: 24px; border: 1px solid ${theme.cardBorder}; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                            <div>
                                <h2 style="margin: 0; font-size: 1.5rem; font-weight: 800; color: ${theme.text};">Portfolio Health</h2>
                                <p style="margin: 4px 0 0 0; font-size: 0.875rem; color: ${theme.textDim};">Insights based on current allocation and performance.</p>
                            </div>
                            <button onclick="document.getElementById('ms-health-modal').style.display='none'" style="background: none; border: none; color: ${theme.textDim}; cursor: pointer;">
                                <span class="material-icons-round">close</span>
                            </button>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 24px;">
                            <div style="display: flex; align-items: center; gap: 20px; padding: 20px; background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; border-radius: 16px;">
                                <div style="width: 64px; height: 64px; border-radius: 32px; border: 4px solid ${healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444'}; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 900; color: ${healthScore >= 70 ? '#10b981' : healthScore >= 40 ? '#f59e0b' : '#ef4444'};">
                                    ${healthScore}
                                </div>
                                <div>
                                    <p style="margin: 0; font-weight: 700; color: ${theme.text};">Overall Score</p>
                                    <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: ${theme.textDim};">${healthScore >= 70 ? 'Your portfolio is in excellent shape.' : healthScore >= 40 ? 'Fair health, but room for improvement.' : 'High risk detected. Review your allocation.'}</p>
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 12px;">
                                <h3 style="margin: 0; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: ${theme.textDim};">Key Insights</h3>
                                
                                <div style="display: flex; align-items: flex-start; gap: 12px;">
                                    <span class="material-icons-round" style="font-size: 20px; color: ${isOverConcentrated ? '#ef4444' : '#10b981'};">${isOverConcentrated ? 'warning' : 'check_circle'}</span>
                                    <div>
                                        <p style="margin: 0; font-size: 0.9rem; font-weight: 600; color: ${theme.text};">Sector Diversification</p>
                                        <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: ${theme.textDim};">${isOverConcentrated ? `Concentration risk! **${topSector[0]}** makes up **${sectorConcentrationPct}%** of your portfolio.` : 'Well diversified across multiple sectors.'}</p>
                                    </div>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 12px;">
                                    <span class="material-icons-round" style="font-size: 20px; color: ${concentratedStocks.length > 0 ? '#ef4444' : '#10b981'};">${concentratedStocks.length > 0 ? 'warning' : 'check_circle'}</span>
                                    <div>
                                        <p style="margin: 0; font-size: 0.9rem; font-weight: 600; color: ${theme.text};">Individual Position Risk</p>
                                        <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: ${theme.textDim};">${concentratedStocks.length > 0 ? `You have **${concentratedStocks.length}** scrips with >15% weight.` : 'All individual positions are within safe limits.'}</p>
                                    </div>
                                </div>

                                <div style="display: flex; align-items: flex-start; gap: 12px;">
                                    <span class="material-icons-round" style="font-size: 20px; color: ${profitRatio > 0.6 ? '#10b981' : '#f59e0b'};">stars</span>
                                    <div>
                                        <p style="margin: 0; font-size: 0.9rem; font-weight: 600; color: ${theme.text};">Profitability</p>
                                        <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: ${theme.textDim};">${Math.round(profitRatio * 100)}% of your scrips are currently in profit.</p>
                                    </div>
                                </div>
                            </div>

                            <p style="margin: 0; padding: 16px; background: rgba(59,130,246,0.1); border-radius: 12px; font-size: 0.75rem; color: #3b82f6; line-height: 1.5;">
                                <strong>Tip:</strong> Aim for a health score above 70 by diversifying across at least 5-8 sectors and keeping individual weights below 15%.
                            </p>
                        </div>
                    </div>
                </div>

                <div id="ms-notification-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 2147483647; align-items: center; justify-content: center; font-family: 'Outfit', sans-serif;">
                    <div style="background: ${theme.cardBg}; width: 90%; max-width: 600px; border-radius: 24px; border: 1px solid ${theme.cardBorder}; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="padding: 24px; border-bottom: 1px solid ${theme.cardBorder}; display: flex; align-items: center; justify-content: space-between; background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'};">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <span class="material-icons-round" style="color: #f59e0b; font-size: 24px;">notifications_active</span>
                                <h2 style="margin: 0; color: ${theme.text}; font-size: 1.25rem; font-weight: 700;">Corporate Actions</h2>
                            </div>
                            <button id="ms-notif-close" style="background: transparent; border: none; color: ${theme.textDim}; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; transition: all 0.2s;" onmouseover="this.style.background='${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}'" onmouseout="this.style.background='transparent'">
                                <span class="material-icons-round">close</span>
                            </button>
                        </div>
                        <div style="padding: 24px; max-height: 60vh; overflow-y: auto;">
                            ${portfolioActions.length === 0 ? `
                                <div style="text-align: center; padding: 40px 20px;">
                                    <span class="material-icons-round" style="font-size: 48px; color: ${theme.textDim}; opacity: 0.3; margin-bottom: 16px;">notifications_none</span>
                                    <p style="margin: 0; color: ${theme.textDim}; font-size: 0.9rem;">No active corporate actions for your holdings.</p>
                                </div>
                            ` : `
                                <div style="display: flex; flex-direction: column; gap: 12px;">
                                    ${portfolioActions.map(a => `
                                        <div style="padding: 16px; border-radius: 16px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)'}; display: flex; align-items: center; gap: 16px;">
                                            <div style="width: 48px; height: 48px; border-radius: 12px; background: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}20; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                                <span class="material-icons-round" style="color: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'};">${a.type === 'Dividend' ? 'celebration' : 'account_balance_wallet'}</span>
                                            </div>
                                            <div style="flex-grow: 1;">
                                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                                                    <span style="font-weight: 700; color: ${theme.text}; font-size: 1rem;">${a.symbol}</span>
                                                    <span style="font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 20px; background: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}20; color: ${a.type === 'Dividend' ? '#10b981' : '#f59e0b'}; text-transform: uppercase;">${a.type}</span>
                                                </div>
                                                <p style="margin: 0; color: ${theme.textMuted}; font-size: 0.85rem;">
                                                    ${a.type === 'Dividend' ? `Bonus: <b>${a.bonus}</b> | Cash: <b>${a.cash}</b>` : `Ratio: <b>${a.ratio}</b> | Status: <b>${a.status}</b>`}
                                                </p>
                                                ${a.bookClosure ? `<p style="margin: 4px 0 0 0; color: ${theme.textDim}; font-size: 0.75rem;">Book Closure: ${a.bookClosure}</p>` : ''}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            `}
                        </div>
                        <div style="padding: 16px 24px; border-top: 1px solid ${theme.cardBorder}; text-align: center; background: ${isDarkMode ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'};">
                            <p style="margin: 0; font-size: 0.7rem; color: ${theme.textDim};">Source: ShareSansar. Use for reference only.</p>
                        </div>
                    </div>
                </div>

                <div id="ms-sizing-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2147483647; align-items: center; justify-content: center;">
                    <div style="width: 100%; max-width: 450px; background: ${theme.cardBg}; border-radius: 24px; border: 1px solid ${theme.cardBorder}; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                            <div>
                                <h2 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: ${theme.text};">Position Sizing Calculator</h2>
                                <p style="margin: 4px 0 0 0; font-size: 0.75rem; color: ${theme.textDim};">Calculate how many shares to buy based on risk.</p>
                            </div>
                            <button id="ms-close-sizing" style="background: none; border: none; color: ${theme.textDim}; cursor: pointer;">
                                <span class="material-icons-round">close</span>
                            </button>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 20px;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Total Capital</label>
                                    <input id="ms-sizing-capital" type="number" value="${Math.round(totalValue)}" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Risk %</label>
                                    <input id="ms-sizing-risk" type="number" value="1" step="0.1" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                            </div>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Entry Price</label>
                                    <input id="ms-sizing-entry" type="number" placeholder="LTP" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Stop Loss</label>
                                    <input id="ms-sizing-stop" type="number" placeholder="Price" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                            </div>
                            
                            <div style="background: ${isDarkMode ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)'}; border-radius: 16px; padding: 24px; text-align: center; border: 2px dashed rgba(139,92,246,0.3);">
                                <div style="font-size: 0.7rem; font-weight: 700; color: #8b5cf6; text-transform: uppercase; margin-bottom: 8px;">Units to Buy</div>
                                <div id="ms-sizing-units" style="font-size: 2.25rem; font-weight: 900; color: #8b5cf6;">0</div>
                                <div id="ms-sizing-invest" style="font-size: 0.85rem; font-weight: 600; color: ${theme.textDim}; margin-top: 8px;">Investment: Rs. 0</div>
                                <div id="ms-sizing-risk-amt" style="font-size: 0.75rem; font-weight: 600; color: #ef4444; margin-top: 4px;">Total Risk: Rs. 0</div>
                            </div>
                            
                            <p style="margin: 0; font-size: 0.65rem; color: ${theme.textDim}; line-height: 1.4; text-align: center;">
                                <strong>Rule:</strong> Never risk more than 1-2% of your total capital on a single trade. Position size is limited by your stop loss distance.
                            </p>
                        </div>
                    </div>
                </div>

                <div id="ms-wacc-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2147483647; align-items: center; justify-content: center;">
                    <div style="width: 100%; max-width: 450px; background: ${theme.cardBg}; border-radius: 24px; border: 1px solid ${theme.cardBorder}; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                            <div>
                                <h2 id="ms-wacc-sim-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: ${theme.text};">WACC Simulator</h2>
                                <p style="margin: 4px 0 0 0; font-size: 0.75rem; color: ${theme.textDim};" id="ms-wacc-sim-subtitle">Simulate how a new buy affects your WACC.</p>
                            </div>
                            <button id="ms-close-wacc" style="background: none; border: none; color: ${theme.textDim}; cursor: pointer;">
                                <span class="material-icons-round">close</span>
                            </button>
                        </div>
                        
                        <div style="display: flex; flex-direction: column; gap: 20px;">
                            <div style="background: ${isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'}; border-radius: 12px; padding: 12px; border: 1px solid ${theme.cardBorder};">
                                <p style="margin: 0 0 4px 0; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; text-transform: uppercase;">Current Holding</p>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="font-size: 0.85rem; font-weight: 600; color: ${theme.text};" id="ms-wacc-current-units">0 Units</span>
                                    <span style="font-size: 0.85rem; font-weight: 700; color: #3b82f6;" id="ms-wacc-current-wacc">Rs. 0.00</span>
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Buy Price</label>
                                    <input id="ms-wacc-buy-price" type="number" step="0.1" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 0.65rem; font-weight: 700; color: ${theme.textDim}; margin-bottom: 8px; text-transform: uppercase;">Buy Units</label>
                                    <input id="ms-wacc-buy-units" type="number" value="100" style="width: 100%; padding: 10px; border-radius: 10px; border: 1px solid ${theme.cardBorder}; background: ${isDarkMode ? '#0f172a' : '#f8fafc'}; color: ${theme.text}; font-size: 0.9rem; font-weight: 700; outline: none;">
                                </div>
                            </div>
                            
                            <div style="background: ${isDarkMode ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)'}; border-radius: 16px; padding: 24px; text-align: center; border: 2px dashed rgba(59,130,246,0.3);">
                                <div style="font-size: 0.7rem; font-weight: 700; color: #3b82f6; text-transform: uppercase; margin-bottom: 8px;">New Simulated WACC</div>
                                <div id="ms-wacc-new-val" style="font-size: 2.25rem; font-weight: 900; color: #3b82f6;">Rs. 0.00</div>
                                <div id="ms-wacc-change" style="font-size: 0.9rem; font-weight: 700; margin-top: 8px;">Change: 0.00%</div>
                                <div id="ms-wacc-fees" style="font-size: 0.7rem; color: ${theme.textDim}; margin-top: 8px;">Incl. Buy Fees: Rs. 0</div>
                            </div>
                            
                            <p style="margin: 0; font-size: 0.65rem; color: ${theme.textDim}; line-height: 1.4; text-align: center;">
                                Includes standard NEPSE fees: Broker Commission (0.24%-0.36%), SEBON fee (0.015%), and DP Fee (Rs. 25).
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Cosmic Insights Section -->
                <div style="background: linear-gradient(135deg, ${isDarkMode ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.04)'}, ${isDarkMode ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.04)'}); border-radius: 20px; padding: 28px; margin-top: 40px; margin-bottom: 24px; border: 1px solid ${isDarkMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.15)'};">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
                        <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #8b5cf6, #6366f1); display: flex; align-items: center; justify-content: center;">
                            <span style="font-size: 22px;">✨</span>
                        </div>
                        <div>
                            <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: ${theme.text};">Cosmic Insights</h3>
                            <p style="margin: 0; font-size: 0.7rem; color: ${theme.textDim};">Just for fun • Not financial advice</p>
                        </div>
                    </div>
                    
                    ${(() => {
                const userDOB = localStorage.getItem('ms_user_dob') || res.userDOB || null;
                const zodiac = getZodiacSign(userDOB);
                const horoscope = getDailyHoroscope(zodiac);
                const elementColors = { Fire: '#ef4444', Earth: '#84cc16', Air: '#06b6d4', Water: '#3b82f6' };

                if (!zodiac) {
                    return '<div id="ms-dob-prompt" style="background: ' + (isDarkMode ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.08)') + '; padding: 24px; border-radius: 16px; text-align: center; margin-bottom: 20px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform=\'scale(1.01)\'" onmouseout="this.style.transform=\'scale(1)\'">' +
                        '<p style="margin: 0 0 8px 0; font-size: 2rem;">🔮</p>' +
                        '<p style="margin: 0 0 8px 0; color: ' + theme.text + '; font-size: 0.95rem; font-weight: 600;">Unlock Your Cosmic Profile</p>' +
                        '<p style="margin: 0; color: ' + theme.textDim + '; font-size: 0.8rem;">Click here to enter your Date of Birth</p>' +
                        '</div>';
                }
                const elementColor = elementColors[zodiac.element] || '#a78bfa';
                const chineseZodiac = getChineseZodiac(userDOB);
                const moonPhase = getMoonPhase();
                const luckyStock = getLuckyStock(stocks, userDOB);
                const luckyTime = getLuckyTime(zodiac, userDOB);
                const energy = getEnergyLevel(zodiac, userDOB);
                const luckyColor = getLuckyColor(zodiac, chineseZodiac, userDOB);
                const dynamicLuckyNumbers = getDynamicLuckyNumbers(zodiac, userDOB);
                const blendedTraits = getBlendedTraits(zodiac, chineseZodiac);
                const luckyQuantity = getDailyLuckyQuantity(userDOB);

                return '<div style="background: ' + (isDarkMode ? 'rgba(139, 92, 246, 0.12)' : 'rgba(139, 92, 246, 0.08)') + '; padding: 24px; border-radius: 16px; margin-bottom: 20px;">' +
                    // Row 1: Western Zodiac + Chinese Zodiac + Today's Fortune
                    '<div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">' +
                    '<div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 200px;">' +
                    '<div style="width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(99, 102, 241, 0.3)); display: flex; align-items: center; justify-content: center; font-size: 36px;">' + zodiac.symbol + '</div>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #a78bfa;">Western Zodiac</p>' +
                    '<p style="margin: 0; font-size: 1.3rem; font-weight: 800; color: ' + theme.text + ';">' + zodiac.sign + '</p>' +
                    '<p style="margin: 2px 0 0 0; font-size: 0.7rem; color: ' + theme.textDim + ';"><span style="color: ' + elementColor + '; font-weight: 600;">' + zodiac.element + '</span> • ' + zodiac.ruling + '</p>' +
                    '</div>' +
                    '</div>' +
                    (chineseZodiac ? '<div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 180px;">' +
                        '<div style="width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(249, 115, 22, 0.2)); display: flex; align-items: center; justify-content: center; font-size: 36px;">' + chineseZodiac.emoji + '</div>' +
                        '<div>' +
                        '<p style="margin: 0 0 2px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b;">Chinese Zodiac</p>' +
                        '<p style="margin: 0; font-size: 1.3rem; font-weight: 800; color: ' + theme.text + ';">Year of ' + chineseZodiac.animal + '</p>' +
                        '<p style="margin: 2px 0 0 0; font-size: 0.7rem; color: ' + theme.textDim + ';">' + chineseZodiac.traits + '</p>' +
                        '</div>' +
                        '</div>' : '') +
                    '<div style="flex: 2; min-width: 280px;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #a78bfa;">Today\'s Trading Fortune</p>' +
                    '<p style="margin: 0; font-size: 1rem; color: ' + theme.text + '; line-height: 1.5; font-style: italic;">"' + horoscope + '"</p>' +
                    '</div>' +
                    '</div>' +
                    // Row 2: Moon Phase + Lucky Stock + Energy Level
                    '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px;">' +
                    '<span style="font-size: 32px;">' + moonPhase.emoji + '</span>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Moon Phase</p>' +
                    '<p style="margin: 0; font-size: 0.85rem; font-weight: 700; color: ' + theme.text + ';">' + moonPhase.name + '</p>' +
                    '<p style="margin: 2px 0 0 0; font-size: 0.7rem; color: #a78bfa;">' + moonPhase.advice + '</p>' +
                    '</div>' +
                    '</div>' +
                    (luckyStock ? '<div style="background: linear-gradient(135deg, ' + (isDarkMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.1)') + ', ' + (isDarkMode ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.1)') + '); padding: 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px; border: 1px solid rgba(16, 185, 129, 0.3);">' +
                        '<span style="font-size: 32px;">⭐</span>' +
                        '<div>' +
                        '<p style="margin: 0 0 2px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Stock Today</p>' +
                        '<p style="margin: 0; font-size: 1rem; font-weight: 800; color: #10b981;">' + (scripNamesHidden ? '••••' : luckyStock.symbol) + '</p>' +
                        '<p style="margin: 2px 0 0 0; font-size: 0.7rem; color: ' + theme.textDim + ';">Cosmically favored ✨</p>' +
                        '</div>' +
                        '</div>' : '') +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px;">' +
                    '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
                    '<p style="margin: 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Energy Level</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 800; color: ' + (energy.level >= 80 ? '#10b981' : energy.level >= 60 ? '#f59e0b' : '#ef4444') + ';">' + energy.level + '%' + (energy.isLucky ? ' 🔥' : '') + '</p>' +
                    '</div>' +
                    '<div style="height: 8px; background: ' + (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)') + '; border-radius: 4px; overflow: hidden;">' +
                    '<div style="width: ' + energy.level + '%; height: 100%; background: linear-gradient(90deg, #8b5cf6, ' + (energy.level >= 80 ? '#10b981' : '#f59e0b') + '); border-radius: 4px;"></div>' +
                    '</div>' +
                    '<p style="margin: 6px 0 0 0; font-size: 0.7rem; color: ' + theme.textDim + ';">' + (energy.isLucky ? '🍀 ' + energy.day + ' is your lucky day!' : energy.day + ' trading vibes') + '</p>' +
                    '</div>' +
                    '</div>' +
                    // Row 3: Quick Stats Grid
                    '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Blended Traits</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 600; color: ' + theme.text + ';">' + blendedTraits + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Time</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 600; color: #10b981;">⏰ ' + luckyTime.time + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Color</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 600; color: ' + luckyColor.hex + ';">● ' + luckyColor.name + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Today\'s Lucky #s</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 600; color: #f59e0b;">🔢 ' + dynamicLuckyNumbers + '</p>' +
                    '</div>' +
                    '<div style="background: linear-gradient(135deg, ' + (isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)') + ', ' + (isDarkMode ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)') + '); padding: 12px; border-radius: 10px; text-align: center; border: 1px solid rgba(139, 92, 246, 0.3);">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Qty</p>' +
                    '<p style="margin: 0; font-size: 0.9rem; font-weight: 800; color: #a78bfa;">📊 ' + luckyQuantity + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Compatible</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 600; color: #ec4899;">' + zodiac.compatible + '</p>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            })()}
                    
                    <p style="margin: 0 0 16px 0; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #a78bfa;">🪐 Cosmic Vibes for Your Holdings</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
                        ${stocks.slice(0, 6).map(s => {
                const cosmic = getStockCosmicAdvice(s.symbol);
                const moodColors = { bullish: '#10b981', bearish: '#ef4444', neutral: '#f59e0b' };
                const moodColor = moodColors[cosmic.mood] || '#a78bfa';
                return '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px; border: 1px solid ' + (isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') + ';">' +
                    '<span style="font-size: 24px;">' + cosmic.emoji + '</span>' +
                    '<div style="flex: 1; min-width: 0;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.8rem; font-weight: 700; color: ' + theme.text + ';">' + (scripNamesHidden ? '••••' : s.symbol) + '</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; color: ' + theme.textDim + ';">' + cosmic.advice + '</p>' +
                    '</div>' +
                    '<div style="width: 8px; height: 8px; border-radius: 50%; background: ' + moodColor + '; flex-shrink: 0;" title="' + cosmic.mood + '"></div>' +
                    '</div>';
            }).join('')}
                    </div>
                    ${stocks.length > 6 ? '<p style="margin: 16px 0 0 0; font-size: 0.7rem; color: ' + theme.textDim + '; text-align: center;">Showing cosmic vibes for top 6 holdings</p>' : ''}
                </div>

                <!-- Vedic Astrology (Jyotish) Section -->
                <div style="background: linear-gradient(135deg, ${isDarkMode ? 'rgba(249, 115, 22, 0.08)' : 'rgba(249, 115, 22, 0.04)'}, ${isDarkMode ? 'rgba(234, 179, 8, 0.08)' : 'rgba(234, 179, 8, 0.04)'}); border-radius: 20px; padding: 28px; margin-bottom: 24px; border: 1px solid ${isDarkMode ? 'rgba(249, 115, 22, 0.2)' : 'rgba(249, 115, 22, 0.15)'};">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 24px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #f97316, #eab308); display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 22px;">🕉️</span>
                            </div>
                            <div>
                                <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: ${theme.text};">Vedic Jyotish</h3>
                                <p style="margin: 0; font-size: 0.7rem; color: ${theme.textDim};">Ancient wisdom • Sidereal astrology</p>
                            </div>
                        </div>
                        <div id="ms-edit-birth-details-btn" style="background: #f97316; color: white; padding: 8px 16px; border-radius: 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(249, 115, 22, 0.2);" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 16px rgba(249, 115, 22, 0.3)'" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 12px rgba(249, 115, 22, 0.2)'">
                            Update Profile
                        </div>
                    </div>

                    ${(() => {
                const userDOB = localStorage.getItem('ms_user_dob') || res.userDOB || null;
                const vedicRashi = getVedicRashi(userDOB);
                const nakshatra = getNakshatra(userDOB);
                const tithi = getTithi();
                const vara = getVara();

                const birthTime = localStorage.getItem('ms_user_birth_time') || null;

                if (!vedicRashi || !birthTime) {
                    // Show prompt to enter birth details for auto-calculation
                    return '<div id="ms-set-birth-time-prompt" style="background: ' + (isDarkMode ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)') + '; padding: 32px; border-radius: 20px; text-align: center; margin-bottom: 20px; cursor: pointer; border: 2px dashed ' + (isDarkMode ? 'rgba(249, 115, 22, 0.3)' : 'rgba(249, 115, 22, 0.2)') + '; transition: all 0.2s;" onmouseover="this.style.background=\'rgba(249, 115, 22, 0.15)\'; this.style.borderColor=\'rgba(249, 115, 22, 0.5)\'" onmouseout="this.style.background=\'' + (isDarkMode ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)') + '\'; this.style.borderColor=\'' + (isDarkMode ? 'rgba(249, 115, 22, 0.3)' : 'rgba(249, 115, 22, 0.2)') + '\'">' +
                        '<p style="margin: 0 0 12px 0; font-size: 2.5rem;">🌌</p>' +
                        '<p style="margin: 0 0 8px 0; color: ' + theme.text + '; font-size: 1.1rem; font-weight: 800; letter-spacing: 0.5px;">Unlock Your Vedic Chart</p>' +
                        '<p style="margin: 0 0 16px 0; color: ' + theme.textDim + '; font-size: 0.85rem; max-width: 400px; margin-left: auto; margin-right: auto; line-height: 1.4;">Enter your Birth Date, Time, and Location. We will auto-calculate your <b>Rashi</b>, <b>Nakshatra</b>, and <b>Lagna</b> instantly.</p>' +
                        '<div style="background: #f97316; color: white; display: inline-block; padding: 10px 24px; border-radius: 10px; font-size: 0.85rem; font-weight: 700;">Setup My Chart</div>' +
                        '</div>';
                }

                const vedicPrediction = getVedicDailyPrediction(vedicRashi);
                const vedicLuckyNums = getVedicLuckyNumbers(vedicRashi, userDOB);
                const shubhMuhurat = getVedicAuspiciousTime(vedicRashi, userDOB);
                const lagna = getLagna(userDOB);
                const dasha = getVimshottariDasha(nakshatra ? nakshatra.longitude : null, userDOB);
                const vedicCompatible = getVedicCompatibility(vedicRashi);
                const gunaColors = { Sattva: '#10b981', Rajas: '#f59e0b', Tamas: '#6366f1' };
                const gunaColor = gunaColors[vedicRashi.guna] || '#a78bfa';

                const lagnaLord = lagna ? lagna.lord.split(' ')[0] : 'Unknown';
                const nakLord = nakshatra ? nakshatra.lord : 'Unknown';

                const transits = getPlanetaryTransits();
                const vedicStock = getVedicStockGuidance(vedicRashi, nakshatra, lagna, transits);
                const portfolioMatches = mapPortfolioToVedic(stocks, vedicStock);

                return '<div style="background: ' + (isDarkMode ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)') + '; padding: 24px; border-radius: 16px; margin-bottom: 20px;">' +
                    // Row 1: Vedic Identity
                    '<div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 24px; border-bottom: 1px solid ' + (isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') + '; padding-bottom: 20px;">' +
                    // Rashi
                    '<div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 180px;">' +
                    '<div style="width: 54px; height: 54px; border-radius: 14px; background: linear-gradient(135deg, rgba(249, 115, 22, 0.3), rgba(234, 179, 8, 0.3)); display: flex; align-items: center; justify-content: center; font-size: 28px;">' + vedicRashi.symbol + '</div>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f97316;">RASHI</p>' +
                    '<p style="margin: 0; font-size: 1.1rem; font-weight: 800; color: ' + theme.text + ';">' + vedicRashi.rashi + '</p>' +
                    '<p style="margin: 1px 0 0 0; font-size: 0.65rem; color: ' + theme.textDim + ';">' + vedicRashi.lord.split(' ')[0] + '</p>' +
                    '<p id="ms-change-vedic-rashi" style="margin: 4px 0 0 0; font-size: 0.65rem; color: #f97316; cursor: pointer; text-decoration: underline;">Change Rashi</p>' +
                    '</div>' +
                    '</div>' +
                    // Nakshatra
                    (nakshatra ? '<div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 180px;">' +
                        '<div style="width: 54px; height: 54px; border-radius: 14px; background: linear-gradient(135deg, rgba(234, 179, 8, 0.3), rgba(251, 191, 36, 0.3)); display: flex; align-items: center; justify-content: center; font-size: 28px;">' + (nakshatra.symbol || '🏹') + '</div>' +
                        '<div>' +
                        '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #eab308;">NAKSHATRA</p>' +
                        '<p style="margin: 0; font-size: 1.1rem; font-weight: 800; color: ' + theme.text + ';">' + nakshatra.name + '</p>' +
                        '<p style="margin: 1px 0 0 0; font-size: 0.65rem; color: ' + theme.textDim + ';">' + nakshatra.lord + '</p>' +
                        '</div>' +
                        '</div>' : '') +
                    // Lagna
                    (lagna ? '<div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 180px;">' +
                        '<div style="width: 54px; height: 54px; border-radius: 14px; background: linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(59, 130, 246, 0.3)); display: flex; align-items: center; justify-content: center; font-size: 28px;">🌅</div>' +
                        '<div>' +
                        '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #06b6d4;">LAGNA</p>' +
                        '<p style="margin: 0; font-size: 1.1rem; font-weight: 800; color: ' + theme.text + ';">' + lagna.rashi + '</p>' +
                        '<p style="margin: 1px 0 0 0; font-size: 0.65rem; color: ' + theme.textDim + ';">' + lagna.lord.split(' ')[0] + '</p>' +
                        '</div>' +
                        '</div>' : '') +
                    '</div>' +

                    // Row 2: Vedic Stock Guidance
                    '<div style="background: ' + (isDarkMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.4)') + '; padding: 16px; border-radius: 14px; margin-bottom: 16px; border: 1px solid ' + (isDarkMode ? 'rgba(249, 115, 22, 0.2)' : 'rgba(249, 115, 22, 0.1)') + ';">' +
                    '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">' +
                    '<span style="font-size: 18px;">📈</span>' +
                    '<p style="margin: 0; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #f97316;">Vedic Stock Guidance</p>' +
                    '</div>' +
                    '<p style="margin: 0 0 10px 0; font-size: 0.85rem; color: ' + theme.text + '; font-weight: 500;">' + vedicStock.description + '</p>' +
                    '<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">' +
                    vedicStock.sectors.map(s => '<span style="background: ' + (isDarkMode ? 'rgba(249, 115, 22, 0.2)' : 'rgba(249, 115, 22, 0.1)') + '; color: #f97316; padding: 4px 10px; border-radius: 6px; font-size: 0.65rem; font-weight: 600;">' + s + '</span>').join('') +
                    '</div>' +
                    (portfolioMatches.length > 0 ?
                        '<p style="margin: 8px 0 4px 0; font-size: 0.65rem; font-weight: 700; color: ' + theme.textDim + ';">COSMIC ALIGNMENT IN YOUR PORTFOLIO:</p>' +
                        '<div style="display: flex; gap: 8px;">' +
                        portfolioMatches.map(m => '<div style="background: #10b981; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 700;">' + m.symbol + '</div>').join('') +
                        '</div>' : '') +
                    '</div>' +

                    // Row 3: Daily Guidance
                    '<div style="margin-bottom: 24px;">' +
                    '<p style="margin: 0 0 6px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f97316; opacity: 0.8;">DAILY JYOTISH GUIDANCE</p>' +
                    '<p style="margin: 0; font-size: 1.05rem; color: ' + theme.text + '; line-height: 1.5; font-style: italic; font-weight: 500;">"' + vedicPrediction + '"</p>' +
                    '</div>' +

                    // Row 3: Daily Panchang Tiles
                    '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px;">' +
                    // Tithi
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 14px; border-radius: 12px; display: flex; align-items: center; gap: 10px;">' +
                    '<span style="font-size: 28px;">🌙</span>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">TITHI</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 700; color: ' + theme.text + ';">' + tithi.name + '</p>' +
                    '<p style="margin: 1px 0 0 0; font-size: 0.65rem; color: #f97316;">' + tithi.paksha + '</p>' +
                    '</div>' +
                    '</div>' +
                    // Vara
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 14px; border-radius: 12px; display: flex; align-items: center; gap: 10px;">' +
                    '<span style="font-size: 28px;">📅</span>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">VARA</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 700; color: ' + theme.text + ';">' + vara.name + '</p>' +
                    '<p style="margin: 1px 0 0 0; font-size: 0.65rem; color: #f97316;">' + vara.lord.split(' ')[0] + '</p>' +
                    '</div>' +
                    '</div>' +
                    // Ruling Planets Tile
                    '<div style="background: linear-gradient(135deg, ' + (isDarkMode ? 'rgba(167, 139, 250, 0.15)' : 'rgba(167, 139, 250, 0.1)') + ', ' + (isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)') + '); padding: 14px; border-radius: 12px; display: flex; align-items: center; gap: 10px; border: 1px solid rgba(167, 139, 250, 0.3);">' +
                    '<span style="font-size: 28px;">🪐</span>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">RULING PLANETS</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 800; color: #a78bfa;">' + lagnaLord + ' & ' + nakLord + '</p>' +
                    '<p style="margin: 1px 0 0 0; font-size: 0.6rem; color: ' + theme.textDim + ';">Lagna & Nakshatra Lords</p>' +
                    '</div>' +
                    '</div>' +
                    '</div>' + '</div>' +
                    '<div style="background: linear-gradient(135deg, ' + (isDarkMode ? 'rgba(249, 115, 22, 0.15)' : 'rgba(249, 115, 22, 0.1)') + ', ' + (isDarkMode ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)') + '); padding: 16px; border-radius: 12px; display: flex; align-items: center; gap: 12px; border: 1px solid rgba(249, 115, 22, 0.3); margin-bottom: 20px;">' +
                    '<span style="font-size: 32px;">🪐</span>' +
                    '<div>' +
                    '<p style="margin: 0 0 2px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">PERSONALIZED TRANSIT STRATEGY</p>' +
                    '<p style="margin: 0; font-size: 0.85rem; font-weight: 800; color: #f97316;">' + vedicStock.strategy + '</p>' +
                    '<p style="margin: 2px 0 0 0; font-size: 0.65rem; color: ' + theme.textDim + ';">Lagna Trait: ' + vedicStock.lagnaTrait + '</p>' +
                    '</div>' +
                    '</div>' +
                    // Row 3: Nakshatra Details Card
                    (nakshatra ? '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px; margin-bottom: 16px;">' +
                        '<p style="margin: 0 0 10px 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; color: #eab308;">✨ NAKSHATRA INSIGHTS</p>' +
                        '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">' +
                        '<div><p style="margin: 0; font-size: 0.6rem; color: ' + theme.textDim + '; text-transform: uppercase;">DEITY</p><p style="margin: 2px 0 0 0; font-size: 0.8rem; font-weight: 600; color: ' + theme.text + ';">' + nakshatra.deity + '</p></div>' +
                        '<div><p style="margin: 0; font-size: 0.6rem; color: ' + theme.textDim + '; text-transform: uppercase;">NATURE</p><p style="margin: 2px 0 0 0; font-size: 0.8rem; font-weight: 600; color: ' + theme.text + ';">' + nakshatra.nature + '</p></div>' +
                        '<div><p style="margin: 0; font-size: 0.6rem; color: ' + theme.textDim + '; text-transform: uppercase;">QUALITIES</p><p style="margin: 2px 0 0 0; font-size: 0.8rem; font-weight: 600; color: ' + theme.text + ';">' + nakshatra.qualities + '</p></div>' +
                        '</div>' +
                        '</div>' : '') +
                    // Row 4: Quick Stats Grid
                    '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Rashi Element</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 800; color: ' + theme.text + ';">' + (vedicRashi.element.split(' ')[0]) + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Shubh Muhurat</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 800; color: #10b981;">⏰ ' + shubhMuhurat.time + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Ratna</p>' +
                    '<p style="margin: 0; font-size: 0.8rem; font-weight: 800; color: #ec4899;">💎 ' + vedicRashi.gemstone.split(' ')[0] + '</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Lucky Numbers</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 800; color: #f59e0b;">🔢 ' + vedicLuckyNums + '</p>' +
                    '</div>' +
                    '<div style="background: linear-gradient(135deg, ' + (isDarkMode ? 'rgba(249, 115, 22, 0.15)' : 'rgba(249, 115, 22, 0.1)') + ', ' + (isDarkMode ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)') + '); padding: 16px; border-radius: 12px; border: 1px solid rgba(249, 115, 22, 0.3); grid-column: span 2;">' +
                    '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">' +
                    '<div>' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Current Mahadasha</p>' +
                    '<p style="margin: 0; font-size: 1rem; font-weight: 800; color: #f97316;">' + (dasha ? dasha.current.planet : 'Unknown') + '</p>' +
                    '</div>' +
                    '<div style="text-align: right;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Ends On</p>' +
                    '<p style="margin: 0; font-size: 0.75rem; font-weight: 700; color: ' + theme.text + ';">' + (dasha ? dasha.current.end.toLocaleDateString() : '--/--/----') + '</p>' +
                    '</div>' +
                    '</div>' +
                    '<p style="margin: 0; font-size: 0.75rem; color: ' + theme.text + '; font-style: italic; opacity: 0.9;">"' + (dasha ? dasha.current.theme : '') + '"</p>' +
                    '</div>' +
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center;">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Compatible</p>' +
                    '<p style="margin: 0; font-size: 0.65rem; font-weight: 600; color: #ec4899;">' + vedicCompatible.slice(0, 2).join(', ') + '</p>' +
                    '</div>' +
                    '<div id="ms-edit-birth-details" style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background=\'rgba(249, 115, 22, 0.1)\'" onmouseout="this.style.background=\'' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '\'">' +
                    '<p style="margin: 0 0 4px 0; font-size: 0.55rem; font-weight: 700; text-transform: uppercase; color: ' + theme.textDim + ';">Birth Info <span style="color: #f97316;">(Edit)</span></p>' +
                    '<p style="margin: 0; font-size: 0.73rem; font-weight: 800; color: #06b6d4;">' + (birthTime ? birthTime.split(':').slice(0, 2).join(':') : '--:--') + ' • ' + (localStorage.getItem('ms_user_birth_location') || 'Nepal') + '</p>' +
                    '</div>' +
                    '</div>' +

                    // Row 4: Vimshottari Dasha Timeline
                    (dasha ? '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px; margin-bottom: 20px;">' +
                        '<p style="margin: 0 0 12px 0; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; color: #f97316;">📅 VIMSHOTTARI DASHA TIMELINE (120 Years)</p>' +
                        '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px;">' +
                        dasha.timeline.map(d => {
                            const isCurrent = d === dasha.current;
                            return '<div style="background: ' + (isCurrent ? (isDarkMode ? 'rgba(249,115,22,0.15)' : 'rgba(249,115,22,0.08)') : 'transparent') + '; padding: 8px; border-radius: 8px; border: 1px solid ' + (isCurrent ? '#f97316' : (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')) + ';">' +
                                '<p style="margin: 0; font-size: 0.75rem; font-weight: 700; color: ' + (isCurrent ? '#f97316' : theme.text) + ';">' + d.planet + (isCurrent ? ' ⚡' : '') + '</p>' +
                                '<p style="margin: 2px 0 0 0; font-size: 0.6rem; color: ' + theme.textDim + ';">Until ' + d.end.getFullYear() + '</p>' +
                                '</div>';
                        }).join('') +
                        '</div>' +
                        '</div>' : '') +

                    // Row 5: Mantra
                    '<div style="background: ' + (isDarkMode ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)') + '; padding: 16px; border-radius: 12px; margin-top: 16px; text-align: center;">' +
                    '<p style="margin: 0 0 6px 0; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: #f97316;">🙏 ' + vedicRashi.lord + ' Beej Mantra</p>' +
                    '<p style="margin: 0; font-size: 0.85rem; font-weight: 600; color: ' + theme.text + '; font-style: italic;">' + (vedicRashi.mantra || 'Om Namah Shivaya') + '</p>' +
                    '</div>' +
                    '<p style="margin: 16px 0 0 0; font-size: 0.65rem; color: ' + theme.textDim + '; text-align: center; font-style: italic; opacity: 0.7;">✨ Astrological insights are for entertainment purposes only and do not constitute financial advice.</p>' +
                    '</div>';
            })()}
                </div>

                        <p style="margin: 0; font-size: 0.8rem; color: ${theme.textDim}; font-weight: 500;">Showing all ${stocks.length} scrips • Click headers to sort</p>
                        <p style="margin: 0; font-size: 0.75rem; color: ${theme.textDim};">MS Advanced v2.2</p>


            <style>
                #MS-PANEL * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
                #MS-PANEL .material-icons-round { font-family: 'Material Icons Round' !important; font-style: normal; }
                .ms-row { display: flex !important; flex-direction: row !important; gap: 20px !important; margin-bottom: 24px !important; width: 100% !important; box-sizing: border-box !important; }
                .ms-card-1 { flex: 1 !important; min-width: 0 !important; box-sizing: border-box !important; }
                .ms-card-2 { flex: 2 !important; min-width: 0 !important; box-sizing: border-box !important; }
                
                /* Mobile Overrides */
                @media (max-width: 1024px) {
                    .ms-row { flex-direction: column !important; gap: 16px !important; }
                    .ms-card-1, .ms-card-2 { width: 100% !important; flex: none !important; }
                    .ms-header { flex-direction: column !important; align-items: flex-start !important; gap: 16px !important; }
                    .ms-filter-bar { flex-direction: column !important; align-items: stretch !important; gap: 12px !important; }
                    .ms-stat-grid { grid-template-columns: 1fr !important; }
                    .ms-table-wrapper { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
                    .ms-portfolio-table { min-width: 1250px !important; }
                }

                @keyframes pulse {
                    0 %, 100 % { opacity: 1; }
                    50% {opacity: 0.5; }
                }
                .ms-table-row:hover {background: ${theme.tableHover} !important; }
                #ms-close-btn:hover {background: ${theme.cardBg} !important; }
                #ms-theme-btn:hover {background: ${isDarkMode ? '#334155' : '#e2e8f0'} !important; }
                #ms-sync-btn:hover {opacity: 0.9; transform: translateY(-1px); }
                .ms-sortable:hover {background: ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'} !important; }
                .ms-sortable .ms-sort-icon {opacity: 0.4; font-size: 0.65rem; margin-left: 4px; }
                .ms-sortable:hover .ms-sort-icon {opacity: 0.8; }
                .ms-sortable.sort-asc .ms-sort-icon {opacity: 1; }
                .ms-sortable.sort-desc .ms-sort-icon {opacity: 1; }
            </style>
            </div>
            `;


        const completeHTML = allHTML3 + remainingHTML;


        panel.appendChild(build(completeHTML));


        document.getElementById("ms-close-btn").onclick = () => {
            dashboardActive = false;
            document.getElementById("MS-PANEL").remove();
        };

        document.getElementById("ms-sync-btn").onclick = () => {
            syncAllDataInstantly();
        };

        if (document.getElementById("ms-notifications-btn")) {
            document.getElementById("ms-notifications-btn").onclick = () => {
                document.getElementById("ms-notification-modal").style.display = "flex";
            };
        }

        if (document.getElementById("ms-notif-close")) {
            document.getElementById("ms-notif-close").onclick = () => {
                document.getElementById("ms-notification-modal").style.display = "none";
            };
        }

        window.onclick = (event) => {
            const modals = ['ms-sizing-modal', 'ms-wacc-modal', 'ms-health-modal', 'ms-notification-modal'];
            modals.forEach(id => {
                const modal = document.getElementById(id);
                if (event.target == modal) {
                    modal.style.display = "none";
                }
            });
        };

        document.getElementById("ms-theme-btn").onclick = () => {
            isDarkMode = !isDarkMode;
            setUserStorage({ dashboardTheme: isDarkMode ? 'dark' : 'light' });
            showDashboard();
        };


        document.getElementById("ms-pdf-btn").onclick = () => {
            exportToPDF(stocks, totalValue, totalInvestment, totalPL, totalPLPercent, sectorChartBars);
        };


        document.getElementById("ms-hide-btn").onclick = () => {
            numbersHidden = !numbersHidden;
            showDashboard();
        };

        document.getElementById("ms-hide-names-btn").onclick = () => {
            scripNamesHidden = !scripNamesHidden;
            showDashboard();
        };

        // DOB Entry prompt for Cosmic Insights
        const dobPrompt = document.getElementById("ms-dob-prompt");
        if (dobPrompt) {
            dobPrompt.onclick = () => {
                const dob = prompt("🔮 Enter your Date of Birth (YYYY-MM-DD format):\n\nExample: 1990-05-15", "");
                if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
                    localStorage.setItem('ms_user_dob', dob);
                    console.log("[MS Cosmic] DOB saved to localStorage:", dob);
                    location.reload(); // Simple page reload
                } else if (dob) {
                    alert("Invalid date format. Please use YYYY-MM-DD format (e.g., 1990-05-15)");
                }
            };
        }

        // Vedic Rashi selection prompt - for setting Rashi from Kundali
        const showVedicRashiSelector = () => {
            const rashiNames = ["Mesha", "Vrishabha", "Mithuna", "Karka", "Simha", "Kanya", "Tula", "Vrishchika", "Dhanu", "Makara", "Kumbha", "Meena"];
            const rashiOptions = rashiNames.map((n, i) => `${i + 1}. ${n}`).join("\n");

            const currentRashi = localStorage.getItem('ms_user_vedic_rashi') || '';
            const currentIndex = rashiNames.indexOf(currentRashi);
            const defaultValue = currentIndex >= 0 ? (currentIndex + 1).toString() : "";

            const choice = prompt(
                "🕉️ Select your Vedic Rashi (Moon Sign) from your Kundali:\n\n" +
                rashiOptions +
                "\n\nEnter the number (1-12):" +
                (currentRashi ? "\n\nCurrently set: " + currentRashi : ""),
                defaultValue
            );

            if (choice) {
                const num = parseInt(choice);
                if (num >= 1 && num <= 12) {
                    const selectedRashi = rashiNames[num - 1];
                    localStorage.setItem('ms_user_vedic_rashi', selectedRashi);
                    console.log("[MS Vedic] Rashi saved to localStorage:", selectedRashi);
                    location.reload();
                } else {
                    alert("Invalid choice. Please enter a number between 1 and 12.");
                }
            }
        };

        const vedicRashiPrompt = document.getElementById("ms-vedic-rashi-prompt");
        if (vedicRashiPrompt) vedicRashiPrompt.onclick = showVedicRashiSelector;

        const changeVedicRashi = document.getElementById("ms-change-vedic-rashi");
        if (changeVedicRashi) changeVedicRashi.onclick = showVedicRashiSelector;

        // Unified Birth Details Setup - collects DOB, Time, and Location for auto-calculation
        const showBirthDetailsInput = (isSetupFlow = false) => {
            const currentDOB = localStorage.getItem('ms_user_dob') || '';
            const currentTime = localStorage.getItem('ms_user_birth_time') || '';
            const currentLocation = localStorage.getItem('ms_user_birth_location') || 'Nepal';

            // Step 1: Birth Date
            const dobInput = prompt(
                "📅 Step 1/3: Enter your Date of Birth\n\n" +
                "Format: YYYY-MM-DD\n" +
                "Example: 1995-08-25",
                currentDOB || "1995-01-01"
            );
            if (!dobInput) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput)) {
                alert("Invalid date format. Use YYYY-MM-DD.");
                return;
            }

            // Step 2: Birth Time
            const timeInput = prompt(
                "🕐 Step 2/3: Enter your Birth Time (HH:MM:SS)\n\n" +
                "24-hour format. Examples:\n" +
                "  08:15:00 for 8:15 AM\n" +
                "  20:30:00 for 8:30 PM",
                currentTime || "08:00:00"
            );
            if (!timeInput) return;
            const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
            if (!timeRegex.test(timeInput)) {
                alert("Invalid time format. Use HH:MM:SS.");
                return;
            }
            const timeParts = timeInput.split(':');
            const standardizedTime = timeParts.length === 2 ? `${timeInput}:00` : timeInput;

            // Step 3: Location (Focusing on Nepal Districts for now)
            const locationKeys = [
                'Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Bharatpur',
                'Biratnagar', 'Birgunj', 'Janakpur', 'Butwal', 'Dharan',
                'Dhangadhi', 'Nepalgunj', 'Hetauda', 'Itahari', 'Bhairahawa',
                'Birtamod', 'Damak', 'Ghorahi', 'Tulsipur', 'Kalaiya',
                'Jaleshwar', 'Lahan', 'Rajbiraj', 'Mahendranagar', 'Gulariya'
            ];

            const locationOptions = locationKeys.map((k, i) => `${i + 1}. ${k}`).join("\n");

            const locChoice = prompt("📍 Step 3/3: Select Birth District/City\n\n" + locationOptions + "\n\nEnter number (1-25):", "1");
            if (!locChoice) return;
            const locNum = parseInt(locChoice);
            if (locNum < 1 || locNum > locationKeys.length) {
                alert("Invalid choice.");
                return;
            }
            const selectedLocation = locationKeys[locNum - 1];

            // Save all
            localStorage.setItem('ms_user_dob', dobInput);
            localStorage.setItem('ms_user_birth_time', standardizedTime);
            localStorage.setItem('ms_user_birth_location', selectedLocation);

            // Wipe manual overrides to force clean calculation
            localStorage.removeItem('ms_user_vedic_rashi');
            localStorage.removeItem('ms_user_nakshatra');
            localStorage.removeItem('ms_user_nakshatra_pada');
            localStorage.removeItem('ms_user_lagna');

            console.log("[MS Vedic] All birth details saved. Recalculating...");
            location.reload();
        };

        // Birth details prompt (when no Nakshatra shown because no birth time)
        const birthTimePrompt = document.getElementById("ms-set-birth-time-prompt");
        if (birthTimePrompt) {
            birthTimePrompt.onclick = showBirthDetailsInput;
        }

        // "Edit birth details" link (when Nakshatra is shown)
        const editBirthDetails = document.getElementById("ms-edit-birth-details");
        if (editBirthDetails) {
            editBirthDetails.onclick = showBirthDetailsInput;
        }

        const editBirthDetailsBtn = document.getElementById("ms-edit-birth-details-btn");
        if (editBirthDetailsBtn) {
            editBirthDetailsBtn.onclick = showBirthDetailsInput;
        }

        // Birth time card in quick stats
        const birthTimeBtn = document.getElementById("ms-set-birth-time");
        if (birthTimeBtn) {
            birthTimeBtn.onclick = showBirthDetailsInput;
        }

        // Position Sizing Calculator Logic
        const sizeBtn = document.getElementById("ms-size-btn");
        const sizingModal = document.getElementById("ms-sizing-modal");
        const closeSizing = document.getElementById("ms-close-sizing");
        const sizingInputs = ["ms-sizing-capital", "ms-sizing-risk", "ms-sizing-entry", "ms-sizing-stop"];

        const updateSizing = () => {
            const capital = parseFloat(document.getElementById("ms-sizing-capital").value) || 0;
            const riskPct = parseFloat(document.getElementById("ms-sizing-risk").value) || 0;
            const entry = parseFloat(document.getElementById("ms-sizing-entry").value) || 0;
            const stop = parseFloat(document.getElementById("ms-sizing-stop").value) || 0;

            const riskAmtTotal = capital * (riskPct / 100);
            const riskPerShare = Math.abs(entry - stop);

            let units = 0;
            if (riskPerShare > 0) {
                units = Math.floor(riskAmtTotal / riskPerShare);
            }

            const investment = units * entry;

            document.getElementById("ms-sizing-units").innerText = units.toLocaleString();
            document.getElementById("ms-sizing-invest").innerText = `Investment: Rs. ${Math.round(investment).toLocaleString()}`;
            document.getElementById("ms-sizing-risk-amt").innerText = `Total Risk: Rs. ${Math.round(riskAmtTotal).toLocaleString()}`;
        };

        sizeBtn.onclick = () => {
            sizingModal.style.display = "flex";
            updateSizing();
        };

        closeSizing.onclick = () => sizingModal.style.display = "none";
        sizingModal.onclick = (e) => { if (e.target === sizingModal) sizingModal.style.display = "none"; };

        sizingInputs.forEach(id => {
            document.getElementById(id).addEventListener("input", updateSizing);
        });

        document.querySelectorAll(".ms-row-sizing-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const ltp = parseFloat(btn.dataset.ltp) || 0;
                document.getElementById("ms-sizing-entry").value = ltp;
                sizingModal.style.display = "flex";
                updateSizing();
            };
        });

        // WACC Simulator Logic
        const waccModal = document.getElementById("ms-wacc-modal");
        const closeWacc = document.getElementById("ms-close-wacc");
        const waccInputs = ["ms-wacc-buy-price", "ms-wacc-buy-units"];
        let activeWaccStock = null;

        const updateWaccSimulation = () => {
            if (!activeWaccStock) return;
            const buyPrice = parseFloat(document.getElementById("ms-wacc-buy-price").value) || 0;
            const buyUnits = parseFloat(document.getElementById("ms-wacc-buy-units").value) || 0;

            const currentUnits = activeWaccStock.units;
            const currentWacc = activeWaccStock.cost || 0;
            const currentTotalCost = currentUnits * currentWacc;

            const newPurchaseAmount = buyPrice * buyUnits;

            let commission = 0;
            if (newPurchaseAmount <= 50000) commission = newPurchaseAmount * 0.0036;
            else if (newPurchaseAmount <= 500000) commission = newPurchaseAmount * 0.0033;
            else if (newPurchaseAmount <= 2000000) commission = newPurchaseAmount * 0.0031;
            else if (newPurchaseAmount <= 10000000) commission = newPurchaseAmount * 0.0027;
            else commission = newPurchaseAmount * 0.0024;

            commission = Math.max(10, commission);
            const sebonFee = newPurchaseAmount * 0.00015;
            const dpFee = 25;
            const totalFees = commission + sebonFee + dpFee;

            const newTotalCost = currentTotalCost + newPurchaseAmount + totalFees;
            const newTotalUnits = currentUnits + buyUnits;
            const newWacc = newTotalUnits > 0 ? (newTotalCost / newTotalUnits) : 0;

            const changePct = currentWacc > 0 ? ((newWacc - currentWacc) / currentWacc) * 100 : 0;
            const changeColor = newWacc < currentWacc ? '#10b981' : (newWacc > currentWacc ? '#ef4444' : theme.textDim);

            document.getElementById("ms-wacc-new-val").innerText = `Rs. ${newWacc.toFixed(2)}`;
            document.getElementById("ms-wacc-change").innerText = `Change: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`;
            document.getElementById("ms-wacc-change").style.color = changeColor;
            document.getElementById("ms-wacc-fees").innerText = `Incl. Buy Fees: Rs. ${Math.round(totalFees).toLocaleString()}`;
        };

        document.querySelectorAll(".ms-row-wacc-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                activeWaccStock = stocks.find(s => s.symbol === symbol);
                if (activeWaccStock) {
                    document.getElementById("ms-wacc-sim-title").innerText = `WACC Simulator: ${symbol}`;
                    document.getElementById("ms-wacc-current-units").innerText = `${activeWaccStock.units.toLocaleString()} Units`;
                    document.getElementById("ms-wacc-current-wacc").innerText = `Rs. ${(activeWaccStock.cost || 0).toFixed(2)}`;
                    document.getElementById("ms-wacc-buy-price").value = activeWaccStock.ltp;
                    waccModal.style.display = "flex";
                    updateWaccSimulation();
                }
            };
        });

        closeWacc.onclick = () => waccModal.style.display = "none";
        waccModal.onclick = (e) => { if (e.target === waccModal) waccModal.style.display = "none"; };
        waccInputs.forEach(id => {
            document.getElementById(id).addEventListener("input", updateWaccSimulation);
        });





        let currentSort = { column: null, direction: 'asc' };

        document.querySelectorAll('.ms-sortable').forEach(header => {
            header.addEventListener('click', () => {
                const sortKey = header.dataset.sort;
                const tbody = document.getElementById('ms-table-body');
                const rows = Array.from(tbody.querySelectorAll('tr'));


                if (currentSort.column === sortKey) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = sortKey;
                    currentSort.direction = 'asc';
                }


                document.querySelectorAll('.ms-sortable').forEach(h => {
                    h.classList.remove('sort-asc', 'sort-desc');
                    h.querySelector('.ms-sort-icon').textContent = '↕';
                });
                header.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                header.querySelector('.ms-sort-icon').textContent = currentSort.direction === 'asc' ? '↑' : '↓';


                const isNumeric = ['units', 'ltp', 'cost', 'investment', 'value', 'weight', 'returnamt'].includes(sortKey.toLowerCase());

                rows.sort((a, b) => {
                    let aVal = a.dataset[sortKey.toLowerCase()];
                    let bVal = b.dataset[sortKey.toLowerCase()];

                    if (isNumeric) {
                        aVal = parseFloat(aVal) || 0;
                        bVal = parseFloat(bVal) || 0;
                    } else {
                        aVal = aVal.toLowerCase();
                        bVal = bVal.toLowerCase();
                    }

                    if (currentSort.direction === 'asc') {
                        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                    } else {
                        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
                    }
                });


                rows.forEach(row => tbody.appendChild(row));
            });
        });


        const searchInput = document.getElementById("ms-search");
        const sectorFilter = document.getElementById("ms-sector-filter");
        const filterBtns = document.querySelectorAll(".ms-filter-btn");
        let activeFilter = 'all';

        const applyFilters = () => {
            const rawSearch = searchInput.value.trim().toLowerCase();
            const sectorValue = sectorFilter.value;
            const rows = document.querySelectorAll("#ms-table-body tr:not(#ms-no-results)");
            const noResultsRow = document.getElementById("ms-no-results");
            let visibleCount = 0;

            rows.forEach(row => {
                const symbol = row.dataset.symbol.toLowerCase();
                const sector = row.dataset.sector;
                const value = parseFloat(row.dataset.value) || 0;
                const returnAmt = parseFloat(row.dataset.returnamt) || 0;
                const returnPct = parseFloat(row.dataset.returnpct) || 0;


                let matchesSearch = rawSearch === "" || symbol.includes(rawSearch);


                const isRange = ['under', 'above', '25k', '50k', '100k', '250k'].some(k => rawSearch.includes(k));
                if (isRange) {
                    if (rawSearch.includes('under 25k')) matchesSearch = value < 25000;
                    else if (rawSearch.includes('25k - 50k')) matchesSearch = value >= 25000 && value < 50000;
                    else if (rawSearch.includes('50k - 100k')) matchesSearch = value >= 50000 && value < 100000;
                    else if (rawSearch.includes('100k - 250k')) matchesSearch = value >= 100000 && value < 250000;
                    else if (rawSearch.includes('above 250k')) matchesSearch = value >= 250000;
                }


                else if (rawSearch === '>10') matchesSearch = returnPct > 10;
                else if (rawSearch === '<-10') matchesSearch = returnPct < -10;

                const matchesSector = sectorValue === 'all' || sector === sectorValue;
                let matchesStatus = true;
                if (activeFilter === 'profit') matchesStatus = returnAmt > 0;
                else if (activeFilter === 'loss') matchesStatus = returnAmt < 0;

                const isVisible = matchesSearch && matchesSector && matchesStatus;
                row.style.display = isVisible ? "" : "none";
                if (isVisible) visibleCount++;
            });

            if (noResultsRow) {
                noResultsRow.style.display = visibleCount === 0 ? "" : "none";
            }
        };

        searchInput.oninput = applyFilters;
        sectorFilter.onchange = applyFilters;

        filterBtns.forEach(btn => {
            btn.onclick = () => {
                filterBtns.forEach(b => {
                    b.style.background = b.dataset.filter === 'all' ? (isDarkMode ? '#334155' : '#e2e8f0') : 'rgba(0,0,0,0.05)';
                    b.style.border = '1px solid transparent';
                });

                activeFilter = btn.dataset.filter;
                btn.style.border = `1px solid ${activeFilter === 'profit' ? '#10b981' : activeFilter === 'loss' ? '#ef4444' : theme.cardBorder} `;
                btn.style.background = activeFilter === 'profit' ? 'rgba(16,185,129,0.2)' : activeFilter === 'loss' ? 'rgba(239,68,68,0.2)' : (isDarkMode ? '#334155' : '#e2e8f0');

                applyFilters();
            };
        });


        document.getElementById("ms-goal-card").onclick = () => {
            const newGoal = prompt("Set your Portfolio Value Goal (Rs.):", portfolioGoal);
            if (newGoal && !isNaN(newGoal)) {
                setUserStorage({ "portfolioGoal": parseFloat(newGoal) }).then(() => {
                    showDashboard();
                });
            }
        };




        document.getElementById("ms-csv-btn").onclick = () => {
            const headers = ["Symbol", "Units", "LTP", "WACC", "Investment", "Current Value", "Profit/Loss", "P/L %"];
            const csvRows = stocks.map(s => {
                const pl = s.value - s.investment;
                const plPct = s.investment > 0 ? (pl / s.investment * 100).toFixed(2) : 0;
                return [s.symbol, s.units, s.ltp, (s.cost || 0).toFixed(2), s.investment, s.value, Math.round(pl), plPct];
            });

            const csvContent = headers.join(",") + "\n"
                + csvRows.map(e => e.join(",")).join("\n");

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `MS_Portfolio_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        };


        document.getElementById("ms-backup-btn").onclick = async () => {
            const userKey = getCurrentUserKey();
            const allData = await chrome.storage.local.get(null);
            const userData = {};

            Object.keys(allData).forEach(k => {
                if (k.startsWith(userKey + "_")) {
                    userData[k] = allData[k];
                }
            });

            if (Object.keys(userData).length === 0) return alert("No local data found to backup.");

            const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `MS_Backup_${userKey}_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };


        document.getElementById("ms-restore-btn").onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = async event => {
                    try {
                        const data = JSON.parse(event.target.result);
                        await chrome.storage.local.set(data);
                        alert("Data restored successfully! Dashboard will refresh.");
                        showDashboard();
                    } catch (err) {
                        alert("Failed to restore data. Invalid file format.");
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        };




        document.querySelectorAll(".ms-alert-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                const target = prompt(`Set Price Alert for ${symbol}(LTP: ${stocks.find(s => s.symbol === symbol)?.ltp}): `, "");
                if (target !== null) {
                    const priceValue = parseFloat(target);
                    if (isNaN(priceValue)) return alert("Invalid price");

                    const type = priceValue > (stocks.find(s => s.symbol === symbol)?.ltp || 0) ? 'above' : 'below';
                    const newAlert = { symbol, target: priceValue, type, triggered: false, createdAt: new Date().toISOString() };

                    const updatedAlerts = [...priceAlerts.filter(a => a.symbol !== symbol), newAlert];
                    setUserStorage({ "priceAlerts": updatedAlerts }).then(() => {
                        showDashboard();
                    });
                }
            };
        });


        document.querySelectorAll(".ms-note-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                const existingNote = scriptNotes[symbol] || "";
                const newNote = prompt(`Note for ${symbol}: `, existingNote);
                if (newNote !== null) {
                    const updatedNotes = { ...scriptNotes, [symbol]: newNote };
                    setUserStorage({ "scriptNotes": updatedNotes }).then(() => {
                        showDashboard();
                    });
                }
            };
        });




        document.querySelectorAll(".ms-bonus-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                const existingBonus = bonusShares[symbol] || 0;
                const bonusInput = prompt(`Enter pending Bonus Shares for ${symbol}: `, existingBonus);
                if (bonusInput !== null) {
                    const units = parseInt(bonusInput) || 0;
                    const updatedBonus = { ...bonusShares };
                    if (units > 0) updatedBonus[symbol] = units;
                    else delete updatedBonus[symbol];

                    setUserStorage({ "bonusShares": updatedBonus }).then(() => {
                        showDashboard();
                    });
                }
            };
        });


        const simModal = document.getElementById("ms-simulator-modal");
        const simPriceInput = document.getElementById("ms-sim-price");
        let activeSimStock = null;

        const calculateSimulation = () => {
            if (!activeSimStock) return;
            const sellPrice = parseFloat(simPriceInput.value) || 0;
            const units = activeSimStock.units;
            const costPerUnit = activeSimStock.cost || 0;

            const turnover = sellPrice * units;


            let commission = 0;
            if (turnover <= 50000) commission = turnover * 0.0036;
            else if (turnover <= 500000) commission = turnover * 0.0033;
            else if (turnover <= 2000000) commission = turnover * 0.0031;
            else if (turnover <= 10000000) commission = turnover * 0.0027;
            else commission = turnover * 0.0024;

            commission = Math.max(10, commission);
            const sebonFee = turnover * 0.00015;
            const dpFee = 25;

            const totalReceivable = turnover - commission - sebonFee - dpFee;
            const totalInvestment = costPerUnit * units;
            const grossProfit = totalReceivable - totalInvestment;

            const taxableProfit = grossProfit > 0 ? grossProfit : 0;
            const cgt = taxableProfit * 0.075;

            const netProfit = grossProfit - cgt;
            const netPct = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;

            document.getElementById("ms-sim-turnover").textContent = `Rs.${Math.round(turnover).toLocaleString()} `;
            document.getElementById("ms-sim-broker").textContent = `- Rs.${Math.round(commission).toLocaleString()} `;
            document.getElementById("ms-sim-sebon").textContent = `- Rs.${Math.round(sebonFee).toLocaleString()} `;
            document.getElementById("ms-sim-taxable").textContent = `Rs.${Math.round(taxableProfit).toLocaleString()} `;
            document.getElementById("ms-sim-tax").textContent = `- Rs.${Math.round(cgt).toLocaleString()} `;
            document.getElementById("ms-sim-net").textContent = `Rs.${Math.round(netProfit).toLocaleString()} `;
            document.getElementById("ms-sim-net").style.color = netProfit >= 0 ? '#10b981' : '#ef4444';
            document.getElementById("ms-sim-net-pct").textContent = `(${netProfit >= 0 ? '+' : ''}${netPct.toFixed(2)} %)`;
            document.getElementById("ms-sim-net-pct").style.color = netProfit >= 0 ? '#10b981' : '#ef4444';
        };

        document.querySelectorAll(".ms-simulator-btn").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const symbol = btn.dataset.symbol;
                activeSimStock = stocks.find(s => s.symbol === symbol);
                if (activeSimStock) {
                    document.getElementById("ms-sim-title").textContent = `Exit Planner: ${symbol} `;
                    document.getElementById("ms-sim-subtitle").textContent = `${activeSimStock.units} Units • WACC: Rs.${activeSimStock.cost?.toFixed(2)} `;
                    simPriceInput.value = activeSimStock.ltp;
                    simModal.style.display = "flex";
                    calculateSimulation();
                }
            };
        });

        simPriceInput.oninput = calculateSimulation;
        document.getElementById("ms-close-sim").onclick = () => { simModal.style.display = "none"; };
        simModal.onclick = (e) => { if (e.target === simModal) simModal.style.display = "none"; };

    });
}


function addTMSButtons() {
    const table = document.querySelector("table");
    if (!table || !isWithinTradingHours()) return;

    table.querySelectorAll("tbody tr").forEach(tr => {
        const firstCell = tr.querySelector("td");
        if (!firstCell || firstCell.querySelector(".tms-actions")) return;

        const ticker = tr.querySelector("td:nth-child(2)")?.innerText.trim();
        if (!ticker || ticker.includes("Total")) return;

        const actions = document.createElement("div");
        actions.className = "tms-actions";
        actions.style.display = "inline-flex";
        actions.style.gap = "4px";
        actions.style.marginLeft = "8px";

        const btnBuy = document.createElement("button");
        btnBuy.innerText = "B";
        btnBuy.style.cssText = "background: #10b981; color: white; border: none; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;";
        btnBuy.onclick = (e) => {
            e.preventDefault();
            window.open(`https://nepalstock.com.np/company/detail/${CONSTANTS.NEPSEIDS[ticker] || ''}`, '_blank');
        };

        const btnSell = document.createElement("button");
        btnSell.innerText = "S";
        btnSell.style.cssText = "background: #f43f5e; color: white; border: none; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;";
        btnSell.onclick = (e) => {
            e.preventDefault();
            window.open(`https://nepalstock.com.np/company/detail/${CONSTANTS.NEPSEIDS[ticker] || ''}`, '_blank');
        };

        actions.appendChild(btnBuy);
        actions.appendChild(btnSell);
        firstCell.appendChild(actions);
    });
}

function displaySummaryBar(portfolio, lastUpdated) {
    if (window.location.hash !== "#/portfolio") return;

    let bar = document.getElementById("ms-summary-bar");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "ms-summary-bar";
        const target = document.querySelector(".page-title-wrapper");
        if (target) target.parentElement.insertBefore(bar, target.nextSibling);
        else return;
    }

    const totalValue = portfolio.reduce((sum, s) => sum + (parseFloat(s.value) || 0), 0);
    const totalInvestment = portfolio.reduce((sum, s) => sum + (parseFloat(s.investment) || 0), 0);
    const totalPL = totalValue - totalInvestment;
    const plColor = totalPL >= 0 ? '#10b981' : '#ef4444';


    bar.style.cssText = `
        display: flex; gap: 16px; padding: 16px 20px; margin: 16px 0;
        background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06); font-family: 'Inter', system-ui, sans-serif;
    `;

    bar.textContent = '';
    const createStat = (label, value, color) => {
        const div = document.createElement('div');
        div.style.flex = '1';
        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px;';
        labelSpan.textContent = label;
        const valSpan = document.createElement('span');
        valSpan.style.cssText = `font-size: 1.1rem; font-weight: 700; color: ${color || '#0f172a'};`;
        valSpan.textContent = value;
        div.appendChild(labelSpan);
        div.appendChild(valSpan);
        return div;
    };

    bar.appendChild(createStat('Total Value', `Rs. ${Math.round(totalValue).toLocaleString()}`));
    bar.appendChild(createStat('Investment', `Rs. ${Math.round(totalInvestment).toLocaleString()}`));
    bar.appendChild(createStat('Total P/L', `${totalPL >= 0 ? '+' : ''}Rs. ${Math.round(totalPL).toLocaleString()}`, plColor));
    bar.appendChild(createStat('Last Sync', lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'N/A'));
}




function injectMenu() {
    if (document.getElementById("ms-menu") || window.location.hash.includes("/login")) return;
    const nav = document.querySelector(".ms-side-nav ul, nav ul");
    if (!nav) return;
    const li = document.createElement("li");
    li.id = "ms-menu";
    li.style.cursor = "pointer";
    li.textContent = '';
    const link = document.createElement("a");
    link.style.cssText = "padding:10px 15px;display:flex;align-items:center;color:#cbd5e1;text-decoration:none;";
    const icon = document.createElement("i");
    icon.className = "fa fa-line-chart";
    icon.style.cssText = "color:#2ecc71;margin-right:10px;";
    const span = document.createElement("span");
    span.style.fontWeight = "500";
    span.textContent = "MS Advanced";
    link.appendChild(icon);
    link.appendChild(span);
    li.appendChild(link);
    li.onclick = (e) => { e.preventDefault(); dashboardActive = true; showDashboard(); };
    nav.appendChild(li);
}




async function waitForTable(maxWait = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const table = document.querySelector("table tbody tr");
        if (table) return true;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
}


async function clickTab(tabText, maxWait = 3000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const tabs = document.querySelectorAll('.nav-tabs a, .nav-link, [role="tab"], .mat-tab-label, a[role="tab"], button');
        for (const tab of tabs) {
            if (tab.innerText && tab.innerText.toLowerCase().includes(tabText.toLowerCase())) {
                tab.click();
                return true;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
}

async function autoSyncOnLogin() {
    if (autoSyncInProgress) return;

    const now = Date.now();
    if (now - lastAutoSyncTime < 30000) return;

    const token = getAuthToken();
    if (!token) return;


    const stored = await getUserStorage(['portfolio', 'lastUpdated']);
    if (stored.portfolio && stored.portfolio.length > 0 && stored.lastUpdated) {
        const lastUpdate = new Date(stored.lastUpdated).getTime();
        if (now - lastUpdate < 5 * 60 * 1000) {
            return;
        }
    }

    autoSyncInProgress = true;
    lastAutoSyncTime = now;

    try {

        window.location.hash = "#/portfolio";
        await new Promise(resolve => setTimeout(resolve, 2000));


        const tableLoaded = await waitForTable(6000);
        if (!tableLoaded) {
            autoSyncInProgress = false;
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        const portfolioData = scrapePortfolioTable();
        if (!portfolioData || portfolioData.length === 0) {
            autoSyncInProgress = false;
            return;
        }


        window.location.hash = "#/purchase";
        await new Promise(resolve => setTimeout(resolve, 2000));


        const allTabs = document.querySelectorAll('.nav-tabs a, .nav-link, [role="tab"], .mat-tab-label, a.nav-link, button.nav-link, li.nav-item a');

        const tabClicked = await clickTab('wacc', 4000);
        if (tabClicked) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
        }


        const tableFound = await waitForTable(4000);
        await new Promise(resolve => setTimeout(resolve, 500));

        const waccData = await scrapeWACCTable();


        const processedPortfolio = portfolioData.map(item => {
            const cost = waccData[item.symbol] || 0;
            const investment = item.units * cost;
            return {
                symbol: item.symbol,
                units: item.units,
                prevClose: item.prevClose,
                ltp: item.ltp,
                cost: cost,
                investment: investment,
                value: item.value,
                gainLoss: item.value - investment
            };
        });

        const totalValue = processedPortfolio.reduce((s, i) => s + i.value, 0);
        const totalInvestment = processedPortfolio.reduce((s, i) => s + i.investment, 0);

        await setUserStorage({
            portfolio: processedPortfolio,
            waccData: waccData,
            lastUpdated: new Date().toISOString(),
            tempPortfolio: null
        });



        await new Promise(resolve => setTimeout(resolve, 500));
        window.location.hash = "#/dashboard";

    } catch (err) {
    } finally {
        autoSyncInProgress = false;
    }
}



let previousHash = window.location.hash;


if (window.location.hash.includes('/dashboard')) {
    dashboardActive = true;
    setTimeout(showDashboard, 1000);
}

window.addEventListener('hashchange', () => {
    const newHash = window.location.hash;


    if (newHash.includes('/login')) {
        dashboardActive = false;
        currentUserKey = null;
        let panel = document.getElementById("MS-PANEL");
        if (panel) panel.remove();
    }


    if (newHash.includes('/dashboard')) {
        dashboardActive = true;
        showDashboard();

        setTimeout(showDashboard, 500);
        setTimeout(showDashboard, 1500);
    } else {

        if (!autoSyncInProgress) {
            dashboardActive = false;

            let panel = document.getElementById("MS-PANEL");
            if (panel) panel.style.display = 'none';


            const mainContent = document.querySelector('app-dashboard, .main-content, .content-wrapper, router-outlet + *');
            if (mainContent) {
                Array.from(mainContent.children).forEach(c => {
                    if (c.id !== 'MS-PANEL') c.style.display = '';
                });
            }
        } else {
            console.log("[MS Sync] Ignoring hashchange during active sync.");
        }
    }


    if (previousHash.includes('/login') && !newHash.includes('/login')) {

        setTimeout(() => {
            notifyActiveUser();
        }, 2000);
    }

    previousHash = newHash;
});


setTimeout(() => {
    const token = getAuthToken();
    const hash = window.location.hash;
    if (token && !hash.includes('/login')) {

        notifyActiveUser();
    }
}, 3000);

const mainLoop = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(mainLoop); return; }


    if (dashboardActive) {

        if (window.location.hash.includes("/dashboard")) {
            if (!document.getElementById("MS-PANEL")) showDashboard();
        }
    } else {

    }

    getUserStorage(["portfolio", "lastUpdated"]).then((res) => {

        if (!dashboardActive) {
            if (res.portfolio) displaySummaryBar(res.portfolio, res.lastUpdated);
        }
    });
}, 1000);



