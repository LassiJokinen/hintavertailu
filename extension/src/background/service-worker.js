const API_URL = "http://localhost:3000/compare";

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

    sendResponse({
      success: true,
      data
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message
    });
  }
}