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

    const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        headers: {
            Authorization: `Bearer ${CLERK_SECRET_KEY}`,
            "Content-Type": "application/json",
        },
    });

    if (!res.ok) throw new Error(`Clerk API error: ${res.status}`);
    const data = await res.json();

    return {
        id: data.id,
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        name: [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || "there",
        email: data.email_addresses?.[0]?.email_address || "",
        avatar: data.image_url || null,
    };
}

// IPC — renderer calls: window.friday.clerkGetUser(userId)
ipcMain.handle("clerk-get-user", async (_, userId) => {
    try {
        console.log(`[ClerkFetch] Fetching fresh data for user: ${userId}`);
        return await fetchClerkUser(userId);
    } catch (err) {
        console.error("[ClerkFetch] IPC Handle Error:", err);
        return { error: err.message };
    }
});

module.exports = { fetchClerkUser };
