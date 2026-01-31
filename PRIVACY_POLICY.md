# Privacy Policy

**Mero Share Integrated Stock Tracker**  
*Last Updated: January 23, 2026*

---

## 🛡️ Our Privacy Guarantee

Mero Share Integrated Stock Tracker ("the Extension") is designed with a **Privacy-First, Offline-First** philosophy. Your financial data is sensitive, and we believe it should stay exactly where it belongs: **on your device.**

## 1. Data Collection & Transmission

### ✅ Zero-Server Architecture
The Extension **does not have a backend server**. We do not collect, store, or transmit your data to any external database owned by us or any third party.

### ✅ Local Storage Only
All your portfolio data, Weighted Average Cost (WACC) adjustments, notes, settings, and price alerts are stored strictly in your browser's `chrome.storage.local`. 
- **Offline Access**: Your data is accessible even without an internet connection (though market updates require one).
- **No Sync**: We do not use `chrome.storage.sync` to prevent your financial data from being uploaded to Google's servers.

### 🌐 Network Activity Transparency
The Extension only makes the following network requests:
1. **Mero Share Official API** (`webbackend.cdsc.com.np`): To fetch your portfolio data using your existing browser session. This stays between your browser and Mero Share.
2. **Public Market Data** (Public JSON files): To fetch the Last Traded Price (LTP) of stocks for profit/loss calculations. This is a one-way download of public info and contains no user data.

## 2. Information We Handle

| Data Type | Stored Where? | Transmitted Anywhere? |
|-----------|---------------|-----------------------|
| Portfolio Holdings | Local Device | ❌ NO |
| WACC / Cost Data | Local Device | ❌ NO |
| Price Alerts | Local Device | ❌ NO |
| Personal Notes | Local Device | ❌ NO |
| Credentials/Passwords | **NOT HANDLED** | ❌ NO |

## 3. Permissions Explained

| Permission | Why We Use It |
|------------|----------------|
| `storage` | To save your settings and portfolio metrics on your hard drive. |
| `alarms` | To run the background price checker (alerts) and performance snapshots. |
| `host_permissions` | To read market data and interact with Mero Share while you are logged in. |

## 4. Your Control

- **Export/Backup**: You can export your data to a JSON file at any time.
- **Data Deletion**: Uninstalling the extension or clearing your browser "Site Data" for Mero Share will permanently delete all extension data from your machine.

## 5. Security Measures

- **Encryption**: We rely on the security of your OS and browser's local storage sandbox.
- **HTTPS Only**: All communication (with Mero Share and Market Data providers) is forced over encrypted HTTPS.

---

## 🛑 Notice for Forks and Third-Party Distributions

This privacy policy applies **ONLY** to the official version of the "Mero Share Integrated Stock Tracker" distributed directly from this GitHub repository (`shadowmonarchftw-star/meroshare-analytics`).

- **Forks**: If this project is forked by another user, they may modify the code to include tracking or data harvesting. The original author has no control over forked versions.
- **Safety**: Always audit the code yourself or only use the official distribution. The original author is **NOT responsible** for the privacy practices or data misuse of any forked or modified versions of this software.

---

## 5. Security Measures

✅ **No Tracking Pixels**  
✅ **No Analytics Services**  
✅ **No Advertisements**  
✅ **No Data Mining**

If you have any security concerns, our source code is **Open Source** and available for audit at: [GitHub Repository](https://github.com/shadowmonarchftw-star/meroshare-analytics)

