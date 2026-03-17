const { app, ipcMain, shell } = require("electron");
const crypto = require("crypto");
const https = require("https");
const { URLSearchParams } = require("url");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────────────────────

const PROTOCOL = "friday";
const DOMAIN = process.env.CLERK_DOMAIN || "clerk.algospend.tech";

// ─── PKCE Helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ─── State ───────────────────────────────────────────────────────────────────

let _mainWindow = null;
let _pendingVerifier = null;

function setMainWindow(win) {
    _mainWindow = win;
}

// ─── Token Exchange ─────────────────────────────────────────────────────────

async function exchangeCodeForToken(code) {
    return new Promise((resolve, reject) => {
        const clientId = process.env.CLERK_CLIENT_ID || process.env.CLERK_PUBLISHABLE_KEY || "";
        const clientSecret = process.env.CLERK_CLIENT_SECRET || "";
        
        console.log(`[auth-main] Exchange attempt: domain=${DOMAIN}, client_id=${clientId}`);

        const params = {
            grant_type: "authorization_code",
            client_id: clientId,
            code: code,
            redirect_uri: `${PROTOCOL}://auth/callback`,
            code_verifier: _pendingVerifier,
        };

        if (clientSecret) {
            params.client_secret = clientSecret;
        }

        const data = new URLSearchParams(params).toString();
        const headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": data.length,
        };

        const options = {
            hostname: DOMAIN,
            port: 443,
            path: "/oauth/token",
            method: "POST",
            headers: headers,
        };

        console.log(`[auth-main] POST to https://${DOMAIN}/oauth/token with data: ${data.replace(clientSecret, '******')}`);

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                try {
                    console.log(`[auth-main] Token response status: ${res.statusCode}`);
                    const json = JSON.parse(body);
                    if (res.statusCode === 200) {
                        resolve(json);
                    } else {
                        console.error("[auth-main] Exchange failed. Full body:", body);
                        reject(new Error(json.error_description || json.error || "Token exchange failed"));
                    }
                } catch (e) {
                    console.error("[auth-main] Parse error. Body was:", body);
                    reject(new Error("Failed to parse token response"));
                }
            });
        });

        req.on("error", (e) => {
            console.error("[auth-main] Request error:", e);
            reject(e);
        });
        req.write(data);
        req.end();
    });
}

// ─── Deep Link Registration ───────────────────────────────────────────────────

function registerDeepLink() {
    try {
        if (process.defaultApp) {
            if (process.argv.length >= 2) {
                const appPath = path.resolve(process.argv[1]);
                app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [appPath]);
                console.log(`[auth-main] Registered custom protocol: ${PROTOCOL}:// (Dev: ${appPath})`);
            }
        } else {
            app.setAsDefaultProtocolClient(PROTOCOL);
            console.log(`[auth-main] Registered custom protocol: ${PROTOCOL}:// (Prod)`);
        }
    } catch (err) {
        console.error('[auth-main] Failed to register custom protocol:', err.message);
    }
}

// ─── Handle Incoming Deep Link ────────────────────────────────────────────────

async function handleDeepLinkUrl(url) {
    if (!url || !url.startsWith(`${PROTOCOL}://`)) return;

    console.log("[auth-main] Deep link received:", url);

    try {
        const parsed = new URL(url);

        if (parsed.hostname === "auth" && parsed.pathname === "/callback") {
            const code = parsed.searchParams.get("code");
            const error = parsed.searchParams.get("error");

            if (error) {
                console.error("[auth-main] Auth error from deep link:", error);
                _mainWindow?.webContents.send("auth:error", { error });
                return;
            }

            if (code) {
                console.log("[auth-main] Code received. Exchanging for token...");
                try {
                    const tokenData = await exchangeCodeForToken(code);
                    console.log("[auth-main] Token exchange successful.");
                    // Clerk OIDC returns access_token. 
                    // We send the access_token as the "token" to the renderer.
                    _mainWindow?.webContents.send("auth:success", { token: tokenData.access_token });

                    if (_mainWindow) {
                        if (_mainWindow.isMinimized()) _mainWindow.restore();
                        _mainWindow.show();
                        _mainWindow.focus();
                    }
                } catch (err) {
                    console.error("[auth-main] Token exchange error:", err.message);
                    _mainWindow?.webContents.send("auth:error", { error: err.message });
                }
            }
        }
    } catch (e) {
        console.error('[auth-main] Invalid deep link parsing:', e);
    }
}

// ─── macOS: open-url event ────────────────────────────────────────────────────

app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
});

// ─── Windows/Linux: second-instance event ────────────────────────────────────

app.on("second-instance", (event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
        handleDeepLinkUrl(url);
    } else {
        if (_mainWindow) {
            if (_mainWindow.isMinimized()) _mainWindow.restore();
            _mainWindow.show();
            _mainWindow.focus();
        }
    }
});

// ─── IPC: Trigger Sign-In ─────────────────────────────────────────────────────

ipcMain.handle("auth:signIn", async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    _pendingVerifier = verifier;

    const redirectUri = `${PROTOCOL}://auth/callback`;
    const clientId = process.env.CLERK_CLIENT_ID || process.env.CLERK_PUBLISHABLE_KEY || "";

    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid profile email",
        code_challenge: challenge,
        code_challenge_method: "S256"
    });

    const authorizeUrl = `https://${DOMAIN}/oauth/authorize?${params.toString()}`;

    console.log(`[auth-main] Opening authorize URL: ${authorizeUrl}`);
    console.log(`[auth-main] !! IMPORTANT !! Ensure this Redirect URI is in your Clerk Dashboard: ${redirectUri}`);
    
    await shell.openExternal(authorizeUrl);
    return { started: true };
});

// ─── IPC: Sign Out ────────────────────────────────────────────────────────────

ipcMain.handle("auth:signOut", async () => {
    _pendingVerifier = null;
    _mainWindow?.webContents.send("auth:signed-out");
    return { success: true };
});

module.exports = { registerDeepLink, setMainWindow, handleDeepLinkUrl };
