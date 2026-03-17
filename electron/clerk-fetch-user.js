// electron/clerk-fetch-user.js (main process — never expose secret key to renderer)
const { ipcMain } = require("electron");

const CLERK_SECRET_KEY = process.env.CLERK_CLIENT_SECRET;

/**
 * Fetches fresh user data from the Clerk Backend API.
 * @param {string} userId - The Clerk user ID (e.g., "user_2abc...")
 */
async function fetchClerkUser(userId) {
    if (!CLERK_SECRET_KEY) {
        console.error("[ClerkFetch] CLERK_CLIENT_SECRET not found in environment.");
        throw new Error("Clerk secret key not configured.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
        const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
            headers: {
                Authorization: `Bearer ${CLERK_SECRET_KEY}`,
                "Content-Type": "application/json",
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            if (res.status === 404) throw new Error(`User not found: ${userId}`);
            if (res.status === 401) throw new Error("Invalid Clerk Secret Key.");
            throw new Error(`Clerk API error: ${res.status}`);
        }

        const data = await res.json();

        return {
            id: data.id,
            firstName: data.first_name || "",
            lastName: data.last_name || "",
            name: [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || "there",
            email: data.email_addresses?.[0]?.email_address || "",
            avatar: data.image_url || null,
            externalAccounts: (data.external_accounts || []).map(acc => ({
                provider: acc.provider,
                email: acc.email_address,
                linked: true
            }))
        };
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error("Clerk API timeout (10s)");
        throw err;
    }
}

// IPC — renderer calls: window.friday.clerkGetUser(userId)
ipcMain.handle("clerk-get-user", async (_, userId) => {
    try {
        if (!userId) {
            console.error("[ClerkFetch] No userId provided to IPC handle.");
            return { error: "No user ID supplied." };
        }
        console.log(`[ClerkFetch] Fetching fresh data for user: ${userId}`);
        return await fetchClerkUser(userId);
    } catch (err) {
        console.error("[ClerkFetch] fresh data fetch failed:", err);
        return { error: err.message };
    }
});

module.exports = { fetchClerkUser };
