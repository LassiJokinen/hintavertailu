const API_URL = "http://localhost:3000/compare";
const REFRESH_API_URL = "http://localhost:3000/refresh-matches";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COMPARE_CURRENT_TAB") {
    compareCurrentTab(sendResponse);
    return true;
  }
});

async function compareCurrentTab(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      throw new Error("No active tab found");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/extractors.js"]
    });

    const product = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => extractProductFromPage()
    });

    const extractedProduct = product[0].result;

    if (!extractedProduct?.supported) {
      sendResponse({
        success: false,
        error:
          extractedProduct?.message ||
          "This page is not a supported product page yet."
      });
      return;
    }

    const backendResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(extractedProduct)
    });

    const data = await backendResponse.json();

    console.log("EXTRACTED PRODUCT:", extractedProduct);

    sendResponse({
      success: true,
      data
    });

    void refreshMatchedOffers(data.matches || []).catch((error) => {
      console.error("Matched offer refresh failed:", error);
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

async function refreshMatchedOffers(matches) {
  const candidates = Array.isArray(matches)
    ? matches
        .filter((match) => match && match.url)
        .slice(0, 3)
        .map((match) => ({ url: match.url, store: match.store }))
    : [];

  if (!candidates.length) {
    return;
  }

  const response = await fetch(REFRESH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ matches: candidates, limit: 3 })
  });

  if (!response.ok) {
    throw new Error(`Refresh request failed: ${response.status} ${response.statusText}`);
  }
}