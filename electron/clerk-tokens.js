// electron/clerk-tokens.js
async function getOAuthToken(userId, provider) {
    const secretKey = process.env.CLERK_CLIENT_SECRET || process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
        console.error("[ClerkTokens] CLERK_CLIENT_SECRET missing.");
        return null;
    }

    try {
        console.log(`[ClerkTokens] Fetching ${provider} token for user: ${userId}`);
        const res = await fetch(`https://api.clerk.com/v1/users/${userId}/oauth_access_tokens/${provider}`, {
            headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json",
            },
        });

        if (!res.ok) {
            console.error(`[ClerkTokens] Clerk API error: ${res.status}`);
            return null;
        }

        const data = await res.json();
        // Clerk returns an array of tokens
        if (data && data.length > 0) {
            return data[0].token;
        }

        console.warn(`[ClerkTokens] No tokens found for ${provider}`);
        return null;
    } catch (err) {
        console.error("[ClerkTokens] Error fetching token:", err);
        return null;
    }
}

module.exports = { getOAuthToken };
