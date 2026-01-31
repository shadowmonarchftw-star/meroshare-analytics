if (typeof browser === "undefined") {
  globalThis.browser = chrome;
} else if (typeof chrome === "undefined") {
  globalThis.chrome = browser;
}

console.log("[MS Background] Script Loaded & Initialized (v2.1.0)");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    portfolio: [],
    settings: {
      theme: 'light',
      refreshInterval: 30,
      notifyAlerts: true
    },
    lastUpdated: null
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SAVE_PORTFOLIO") {
    const userKey = request.userKey || 'default';
    chrome.storage.local.set({
      [`${userKey}_portfolio`]: request.data,
      [`${userKey}_lastUpdated`]: new Date().toISOString(),
      activeUserKey: userKey
    }, () => {
      sendResponse({ status: "success" });
    });
    return true;
  }

  if (request.type === "SET_ACTIVE_USER") {
    chrome.storage.local.set({ activeUserKey: request.userKey }, () => {
      sendResponse({ status: "success" });
    });
    return true;
  }

  if (request.type === "GET_DATA") {
    chrome.storage.local.get(['activeUserKey'], (result) => {
      const userKey = result.activeUserKey || 'default';
      const keys = [
        `${userKey}_portfolio`,
        `${userKey}_lastUpdated`,
        `${userKey}_waccData`,
        `${userKey}_dashboardTheme`
      ];

      chrome.storage.local.get(keys, (data) => {
        const unprefixed = {
          portfolio: data[`${userKey}_portfolio`],
          lastUpdated: data[`${userKey}_lastUpdated`],
          waccData: data[`${userKey}_waccData`],
          dashboardTheme: data[`${userKey}_dashboardTheme`],
          activeUserKey: userKey
        };
        sendResponse(unprefixed);
      });
    });
    return true;
  }

  if (request.type === "FETCH_MEROSHARE") {
    fetch(request.url, request.options)
      .then(async (response) => {
        const text = await response.text();
        sendResponse({
          ok: response.ok,
          status: response.status,
          text: text
        });
      })
      .catch(error => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (request.type === "REFRESH_MARKET_DATA") {
    fetchMarketData()
      .then(() => sendResponse({ status: "Refreshed" }))
      .catch(err => sendResponse({ status: "Error", error: err.message }));
    return true;
  }
});

chrome.alarms.create("refresh_ltp", { periodInMinutes: 5 });
chrome.alarms.create("daily_snapshot", { periodInMinutes: 1440 });
chrome.alarms.create("fetch_corporate_actions", { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh_ltp") {
    fetchMarketData();
  }
  if (alarm.name === "daily_snapshot") {
    takePortfolioSnapshot();
  }
  if (alarm.name === "fetch_corporate_actions") {
    fetchCorporateActions();
  }
});

const prevKey = 'previous_close_data';

async function fetchMarketData() {
  const availableUrls = [
    'https://fix-previous-ltp.vercel.app/ltp.json',
    'https://fixes.netlify.app/public/ltp.json',
    'https://fixes-5elg.onrender.com/ltp.json',
  ];

  for (const selectedUrl of availableUrls) {
    try {
      const response = await fetch(selectedUrl);
      if (!response.ok) continue;

      const json = await response.json();
      const rawData = json.data || {};

      await chrome.storage.local.set({
        [prevKey]: JSON.stringify({ data: rawData }),
        lastLtpUpdate: new Date().toISOString()
      });

      checkAlerts(rawData);
      return;
    } catch (error) {
    }
  }
}

async function takePortfolioSnapshot() {
  const result = await chrome.storage.local.get(['activeUserKey']);
  const userKey = result.activeUserKey || 'default';

  const portfolioKey = `${userKey}_portfolio`;
  const historyKey = `${userKey}_netWorthHistory`;

  const data = await chrome.storage.local.get([portfolioKey, historyKey, prevKey]);
  const portfolio = data[portfolioKey] || [];
  const history = data[historyKey] || [];

  let ltpData = {};
  try {
    const parsed = JSON.parse(data[prevKey] || '{}');
    const rawData = parsed.data || parsed;
    Object.keys(rawData).forEach(sym => {
      ltpData[sym] = rawData[sym]?.price || rawData[sym]?.prev_close || rawData[sym] || 0;
    });
  } catch (e) { }

  const totalValue = portfolio.reduce((sum, s) => {
    const ltp = ltpData[s.symbol] || s.ltp || 0;
    return sum + (ltp * s.units);
  }, 0);

  if (totalValue > 0) {
    const today = new Date().toISOString().split('T')[0];
    const lastEntry = history[history.length - 1];

    if (!lastEntry || lastEntry.date !== today) {
      history.push({ date: today, value: Math.round(totalValue) });
      if (history.length > 180) history.shift();
      await chrome.storage.local.set({ [historyKey]: history });
    }
  }
}

async function checkAlerts(rawData) {
  const result = await chrome.storage.local.get(['activeUserKey', 'settings']);
  const userKey = result.activeUserKey || 'default';
  if (result.settings && result.settings.notifyAlerts === false) return;

  const alertKey = `${userKey}_priceAlerts`;
  const storage = await chrome.storage.local.get([alertKey]);
  let alerts = storage[alertKey] || [];
  if (alerts.length === 0) return;

  let triggeredAny = false;
  alerts = alerts.map(alert => {
    const symData = rawData[alert.symbol];
    const currentPrice = symData?.price || symData?.prev_close || symData || 0;
    if (!currentPrice || alert.triggered) return alert;

    let triggered = false;
    if (alert.type === 'above' && currentPrice >= alert.target) triggered = true;
    if (alert.type === 'below' && currentPrice <= alert.target) triggered = true;

    if (triggered) {
      triggeredAny = true;
      chrome.notifications.create(`alert_${alert.symbol}_${Date.now()}`, {
        type: 'basic',
        iconUrl: 'assets/icon-128.png',
        title: `🚀 Price Alert: ${alert.symbol}`,
        message: `${alert.symbol} has reached Rs. ${currentPrice} (${alert.type === 'above' ? 'hit' : 'dropped to'} target ${alert.target})`,
        priority: 2
      });
      return { ...alert, triggered: true, triggeredAt: new Date().toISOString() };
    }
    return alert;
  });

  if (triggeredAny) {
    await chrome.storage.local.set({ [alertKey]: alerts });
  }
}

async function fetchCorporateActions() {
  console.log("[MS Background] Fetching Corporate Actions...");
  const urls = [
    { url: 'https://www.sharesansar.com/proposed-dividend', type: 'dividend' },
    { url: 'https://www.sharesansar.com/upcoming-issue', type: 'upcoming_right' },
    { url: 'https://www.sharesansar.com/existing-issues', type: 'existing_right' }
  ];

  let allActions = [];

  for (const item of urls) {
    try {
      const response = await fetch(item.url);
      if (!response.ok) continue;
      const html = await response.text();

      // Basic defensive parsing using Regex (Since DOMParser is not in Service Workers)
      const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

      rows.forEach(row => {
        const cols = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
        if (cols.length < 5) return;

        const clean = (str) => str.replace(/<[^>]*>/g, '').trim();

        if (item.type === 'dividend') {
          // Dividend Table Structure: S.No, Symbol, Company, Bonus, Cash, Total, BookClosure, ...
          const symbol = clean(cols[1]);
          const bonus = clean(cols[3]);
          const cash = clean(cols[4]);
          const total = clean(cols[5]);
          const bookClosure = clean(cols[6]);

          if (symbol && symbol.length <= 6 && (bonus !== '0' || cash !== '0')) {
            allActions.push({
              symbol,
              type: 'Dividend',
              bonus: bonus + '%',
              cash: cash + '%',
              total: total + '%',
              bookClosure: bookClosure,
              source: 'ShareSansar'
            });
          }
        } else if (item.type.includes('right')) {
          // Right Share Table: Symbol is usually 2nd col
          const symbol = clean(cols[1]);
          const ratio = clean(cols[3]);
          const status = clean(cols[cols.length - 1]);

          if (symbol && symbol.length <= 6) {
            allActions.push({
              symbol,
              type: 'Right Share',
              ratio: ratio,
              status: status,
              source: 'ShareSansar'
            });
          }
        }
      });
    } catch (error) {
      console.error(`[MS Background] Error fetching ${item.type}:`, error);
    }
  }

  if (allActions.length > 0) {
    await chrome.storage.local.set({ corporateActions: allActions, lastCorporateUpdate: new Date().toISOString() });
    checkCorporateNotifications(allActions);
  }
}

async function checkCorporateNotifications(actions) {
  const result = await chrome.storage.local.get(['activeUserKey', 'settings']);
  const userKey = result.activeUserKey || 'default';
  if (result.settings && result.settings.notifyAlerts === false) return;

  const portfolioData = await chrome.storage.local.get([`${userKey}_portfolio`]);
  const portfolio = portfolioData[`${userKey}_portfolio`] || [];
  if (portfolio.length === 0) return;

  const holdings = new Set(portfolio.map(s => s.symbol));

  // Get already notified actions to avoid spam
  const notifiedData = await chrome.storage.local.get(['notifiedCorporateActions']);
  const notified = notifiedData.notifiedCorporateActions || [];

  actions.forEach(action => {
    if (holdings.has(action.symbol)) {
      const actionId = `${action.symbol}_${action.type}_${action.bonus || action.ratio}`;
      if (!notified.includes(actionId)) {
        chrome.notifications.create(`corp_${actionId}`, {
          type: 'basic',
          iconUrl: 'assets/icon-128.png',
          title: `🔔 Corporate Action: ${action.symbol}`,
          message: `${action.symbol} has a ${action.type}. ${action.bonus ? `Bonus: ${action.bonus}` : `Ratio: ${action.ratio}`}.`,
          priority: 1
        });
        notified.push(actionId);
      }
    }
  });

  await chrome.storage.local.set({ notifiedCorporateActions: notified.slice(-50) }); // Keep last 50
}

fetchMarketData();
fetchCorporateActions();
