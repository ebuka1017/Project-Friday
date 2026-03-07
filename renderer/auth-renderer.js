// ═══════════════════════════════════════════════════════════════════════
// renderer/auth-renderer.js — Auth State Manager
// ═══════════════════════════════════════════════════════════════════════

// Using the injected `window.friday` IPC bridge for electron communication.

(function () {
    let _authState = {
        status: "idle", // "idle" | "pending" | "authenticated" | "error"
        token: null,
        user: null,
        error: null,
    };

    const _listeners = new Set();

    function getAuthState() {
        return { ..._authState };
    }

    function setState(partial) {
        _authState = { ..._authState, ...partial };
        console.log('[AuthRenderer] State updated:', _authState.status, _authState.user?.email || '');
        _listeners.forEach((fn) => fn(_authState));

        // Notify main process of auth status and user profile for route protection and tools
        window.friday.setAuthStatus(_authState.status === 'authenticated', _authState.user);
    }

    function onAuthStateChange(fn) {
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    }

    async function signIn() {
        setState({ status: "pending", error: null });
        try {
            await window.friday.authSignIn();
        } catch (e) {
            setState({ status: "error", error: e.message });
        }
    }

    async function signOut() {
        await window.friday.authSignOut();
        setState({ status: "idle", token: null, user: null });
    }

    function initAuth() {
        // ─── Deep Link Callbacks (from preload.js) ──────────────────────────────────

        window.friday.onAuthSuccess(async ({ token }) => {
            let user = null;
            try {
                const payload = JSON.parse(atob(token.split(".")[1]));
                user = {
                    id: payload.sub,
                    email: payload.email,
                    name: payload.name || payload.username || payload.sub,
                    imageUrl: payload.image_url,
                };
            } catch {
                console.warn('[AuthRenderer] Could not decode token payload, using basic auth flag.');
                user = { id: 'unknown', name: 'User' };
            }

            setState({ status: "authenticated", token, user, error: null });

            try {
                await window.friday.db.setSecret("clerk_session_token", token);
                console.log('[AuthRenderer] Session token secured in DB.');
            } catch (e) {
                console.error('[AuthRenderer] DB secure storage err:', e);
            }
        });

        window.friday.onAuthError(({ error }) => {
            setState({ status: "error", error, token: null, user: null });
        });

        window.friday.onAuthSignedOut(async () => {
            setState({ status: "idle", token: null, user: null, error: null });
            try {
                // Clear from both for safety during transition
                localStorage.removeItem("clerk_session_token");
                await window.friday.db.setSecret("clerk_session_token", "");
            } catch { }
        });

        // ─── Restore session on app load ─────────────────────────────────────────────

        (async () => {
            try {
                // 1. Migration check: if in localStorage, move to secret DB
                const legacy = localStorage.getItem("clerk_session_token");
                if (legacy) {
                    console.log('[AuthRenderer] Migrating legacy session to secure storage...');
                    await window.friday.db.setSecret("clerk_session_token", legacy);
                    localStorage.removeItem("clerk_session_token");
                }

                // 2. Load from secure storage
                const saved = await window.friday.db.getSecret("clerk_session_token");
                if (saved && saved.length > 10) { // basic check for token validity
                    console.log('[AuthRenderer] Restoring session from secure storage...');
                    let user = null;
                    try {
                        const payload = JSON.parse(atob(saved.split(".")[1]));
                        const now = Math.floor(Date.now() / 1000);
                        if (payload.exp && payload.exp < now) {
                            console.log('[AuthRenderer] Session expired.');
                            await window.friday.db.setSecret("clerk_session_token", "");
                            setState({ status: "idle" });
                            return;
                        }

                        user = {
                            id: payload.sub,
                            email: payload.email,
                            name: payload.name || payload.username || payload.sub,
                            imageUrl: payload.image_url,
                        };
                    } catch {
                        user = { id: 'unknown', name: 'User' };
                    }

                    setState({ status: "authenticated", token: saved, user });
                } else {
                    console.log('[AuthRenderer] No active session found.');
                    setState({ status: "idle" });
                }
            } catch (e) {
                console.error('[AuthRenderer] Restore/Migration err:', e);
                setState({ status: "idle" });
            }
        })();
    }

    window.fridayAuth = { initAuth, signIn, signOut, getAuthState, onAuthStateChange };
})();
