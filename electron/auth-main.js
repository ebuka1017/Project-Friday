const { app, ipcMain, shell } = require("electron");
const crypto = require("crypto");
const https = require("https");
const { URLSearchParams } = require("url");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────────────────────

const PROTOCOL = "friday";
const DOMAIN = "singular-alien-87.clerk.accounts.dev";

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
        const params = {
            grant_type: "authorization_code",
            client_id: clientId,
            code: code,
            redirect_uri: `${PROTOCOL}://auth/callback`,
            code_verifier: _pendingVerifier,
        };

        if (process.env.CLERK_CLIENT_SECRET) {
            params.client_secret = process.env.CLERK_CLIENT_SECRET;
        }

        const data = new URLSearchParams(params).toString();

        const options = {
            hostname: DOMAIN,
            port: 443,
            path: "/oauth/token",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": data.length,
            },
        };

        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                try {
                    const json = JSON.parse(body);
                    if (res.statusCode === 200) {
                        resolve(json);
                    } else {
                        reject(new Error(json.error_description || json.error || "Token exchange failed"));
                    }
                } catch (e) {
                    reject(new Error("Failed to parse token response"));
                }
            });
        });

        req.on("error", (e) => reject(e));
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

    const redirectUri = encodeURIComponent(`${PROTOCOL}://auth/callback`);
    // OIDC requires a Client ID from Clerk Dashboard -> Settings -> OAuth Applications
    const clientId = process.env.CLERK_CLIENT_ID || process.env.CLERK_PUBLISHABLE_KEY || "";

    const authorizeUrl =
        `https://${DOMAIN}/oauth/authorize` +
        `?response_type=code` +
        `&client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&scope=${encodeURIComponent("openid profile email")}` +
        `&code_challenge=${challenge}` +
        `&code_challenge_method=S256`;

    console.log('[auth-main] Opening authorize URL:', authorizeUrl);
    console.log('[auth-main] Using Client ID:', clientId);
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
