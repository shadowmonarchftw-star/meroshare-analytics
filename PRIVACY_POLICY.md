# Privacy Policy

**Mero Share Integrated Stock Tracker**  
*Last Updated: March 22, 2026*

---

## 🛡️ Our Privacy Guarantee

Mero Share Integrated Stock Tracker ("the Extension") is designed with a **Privacy-First, Offline-First** philosophy. Your financial data is sensitive, and we believe it should stay exactly where it belongs: **on your device.**

## 1. Data Collection & Transmission

### ✅ No Publisher Backend
The Extension **does not operate its own backend server or database**. We do not collect or store your portfolio data on infrastructure controlled by the publisher.

### ✅ Local Storage Only
All your portfolio data, Weighted Average Cost (WACC) adjustments, notes, settings, price alerts, and locally saved birth details are stored on your device using browser storage (`chrome.storage.local`) and limited page-local `localStorage` values used by the extension UI.
- **Offline Access**: Your data is accessible even without an internet connection (though market updates require one).
- **No Sync**: We do not use `chrome.storage.sync` to prevent your financial data from being uploaded to Google's servers.

### 🌐 Network Activity Transparency
The Extension can make the following network requests:
1. **Mero Share Official API** (`webbackend.cdsc.com.np`): To fetch your portfolio, purchase, and account details using your existing browser session.
2. **Public Market Data Mirrors** (`fix-previous-ltp.vercel.app`, `fixes.netlify.app`, `fixes-5elg.onrender.com`): To download public Last Traded Price (LTP) data used for calculations and alerts.
3. **ShareSansar** (`www.sharesansar.com`): To download public corporate-action pages used for dividend and rights-share tracking.
4. **Google Fonts** (`fonts.googleapis.com`): To load dashboard fonts and icon fonts rendered in the injected interface.
5. **External Link-outs Initiated by You** (`nepalstock.com.np` and other research links opened from the dashboard): These only open when you click them.

These services may receive standard web-request metadata such as your IP address, browser user agent, and request timing. The extension is designed so that your locally stored notes, alerts, and portfolio history are not intentionally uploaded to those third-party services.

## 2. Information We Handle

| Data Type | Stored Where? | Transmitted Anywhere? |
|-----------|---------------|-----------------------|
| Portfolio Holdings | Local Device | ❌ NO |
| WACC / Cost Data | Local Device | ❌ NO |
| Price Alerts | Local Device | ❌ NO |
| Personal Notes | Local Device | ❌ NO |
| DOB / Birth Details Entered for Optional Features | Local Device | ❌ NO |
| Credentials/Passwords | **NOT HANDLED** | ❌ NO |

## 3. Permissions Explained

| Permission | Why We Use It |
|------------|----------------|
| `storage` | To save your settings and portfolio metrics on your hard drive. |
| `alarms` | To run the background price checker (alerts) and performance snapshots. |
| `notifications` | To show local desktop alerts for price targets and corporate actions. |
| `host_permissions` | To read market data and interact with Mero Share while you are logged in. |

## 4. Your Control

- **Export/Backup**: You can export your data to a JSON file at any time.
- **Data Deletion**: Uninstalling the extension removes extension-managed storage. Some optional UI values written into the Mero Share page's local storage can also be cleared by removing site data for `meroshare.cdsc.com.np`.

## 5. Security Measures

- **Encryption**: We rely on the security of your OS and browser's local storage sandbox.
- **HTTPS Only**: All network requests used by the extension are made over HTTPS.

---

## 🛑 Notice for Forks and Third-Party Distributions

This privacy policy applies **ONLY** to the official version of the "Mero Share Integrated Stock Tracker" distributed directly from this GitHub repository (`shadowmonarchftw-star/meroshare-analytics`).

- **Forks**: If this project is forked by another user, they may modify the code to include tracking or data harvesting. The original author has no control over forked versions.
- **Safety**: Always audit the code yourself or only use the official distribution. The original author is **NOT responsible** for the privacy practices or data misuse of any forked or modified versions of this software.

---

## 6. Additional Privacy Commitments

✅ **No Tracking Pixels**  
✅ **No Analytics Services**  
✅ **No Advertisements**  
✅ **No Data Mining**

If you have any security concerns, our source code is **Open Source** and available for audit at: [GitHub Repository](https://github.com/shadowmonarchftw-star/meroshare-analytics)
