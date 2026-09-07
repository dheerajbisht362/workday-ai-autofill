import { BACKEND_URL, STORAGE_KEYS } from "../shared/config";

console.log("🔥 WORKDAY SERVICE WORKER LOADED");

async function saveToStorage(key: string, data: unknown) {
    try {
        await chrome.storage.local.set({ [key]: data });
        console.log(`Saved ${key} to storage`);
    } catch (error) {
        console.error(`Error saving ${key} to storage:`, error);
    }
}

async function getFromStorage(key: string) {
    try {
        const result = await chrome.storage.local.get(key);
        return result[key];
    } catch (error) {
        console.error(`Error getting ${key} from storage:`, error);
        return null;
    }
}

async function clearStorage() {
    try {
        await chrome.storage.local.clear();
        console.log("Cleared all storage");
    } catch (error) {
        console.error(`Error clearing storage:`, error);
    }
}

// Forward a message to the content script of the active tab.
async function forwardToActiveTab(msg: unknown) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw Error("No active tab.");
    return chrome.tabs.sendMessage(tab.id, msg);
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    // ---------------------------------------------------------------
    // Resume parsing: popup -> backend -> content script (+ storage)
    // ---------------------------------------------------------------
    if (msg.type === "PARSE_RESUME") {
        (async () => {
            const r = await fetch(`${BACKEND_URL}/api/parse-resume`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(msg),
            });
            if (!r.ok) throw Error(await r.text());
            const resume = await r.json();

            await saveToStorage(STORAGE_KEYS.RESUME_DATA, resume);
            await saveToStorage(STORAGE_KEYS.RESUME_FILE, {
                filename: msg.filename,
                timestamp: Date.now(),
            });

            try {
                await forwardToActiveTab({ type: "SET_RESUME", resume });
            } catch (error) {
                console.error("Failed to send resume to content script:", error);
                sendResponse({
                    error:
                        "Content script is not available in the active tab. Refresh the page and try again.",
                });
                return;
            }
            sendResponse({ ok: true, resume });
        })().catch((e) => {
            console.error("PARSE_RESUME failed:", e);
            sendResponse({ error: String(e) });
        });
        return true;
    }

    if (msg.type === "GET_RESUME") {
        (async () => {
            const resume = await getFromStorage(STORAGE_KEYS.RESUME_DATA);
            const file = await getFromStorage(STORAGE_KEYS.RESUME_FILE);
            sendResponse({ resume, file });
        })().catch((e) => sendResponse({ error: String(e) }));
        return true;
    }

    if (msg.type === "CLEAR_RESUME") {
        (async () => {
            await clearStorage();
            try {
                await forwardToActiveTab({ type: "CLEAR_RESUME" });
            } catch (error) {
                console.error("Failed to clear resume in content script:", error);
            }
            sendResponse({ ok: true });
        })().catch((e) => sendResponse({ error: String(e) }));
        return true;
    }

    // ---------------------------------------------------------------
    // Pure forwarding: everything below goes to the active tab's
    // content script, which owns all DOM interaction.
    // ---------------------------------------------------------------
    const FORWARDABLE = new Set([
        "AUTOFILL",
        "START_AUTOFILL",
        "PAUSE_AUTOFILL",
        "CONTINUE_REVIEW",
        "NAVIGATE_NEXT_STEP",
        "SCAN",
    ]);
    if (FORWARDABLE.has(msg.type)) {
        forwardToActiveTab(msg)
            .then(sendResponse)
            .catch((e) => sendResponse({ error: String(e) }));
        return true;
    }
});
