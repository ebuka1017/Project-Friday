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

        // Notify main process of auth status for route protection
        window.friday.setAuthStatus(_authState.status === 'authenticated');
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

        window.friday.onAuthSuccess(({ token }) => {
            let user = null;
            try {
                const payload = JSON.parse(atob(token.split(".")[1]));
                user = {
                    id: payload.sub,
                    email: payload.email, // Note: standard Clerk sessions might not have email on the session JWT by default unless customized, but we can decode it if present.
                    name: payload.name || payload.username || payload.sub,
                    imageUrl: payload.image_url,
                };
            } catch {
                console.warn('[AuthRenderer] Could not decode token payload, using basic auth flag.');
                user = { id: 'unknown', name: 'User' };
            }

            setState({ status: "authenticated", token, user, error: null });

            try {
                localStorage.setItem("clerk_session_token", token);
            } catch (e) {
                console.error('[AuthRenderer] LocalStorage err:', e);
            }
        });

        window.friday.onAuthError(({ error }) => {
            setState({ status: "error", error, token: null, user: null });
        });

        window.friday.onAuthSignedOut(() => {
            setState({ status: "idle", token: null, user: null, error: null });
            try {
                localStorage.removeItem("clerk_session_token");
            } catch { }
        });

        // ─── Restore session on app load ─────────────────────────────────────────────

        try {
            const saved = localStorage.getItem("clerk_session_token");
            if (saved) {
                console.log('[AuthRenderer] Restoring session from localStorage...');
                // Need to decode to restore user obj
                let user = null;
                try {
                    const payload = JSON.parse(atob(saved.split(".")[1]));
                    // Optional: Check expiry (exp)
                    const now = Math.floor(Date.now() / 1000);
                    if (payload.exp && payload.exp < now) {
                        console.log('[AuthRenderer] Session expired.');
                        localStorage.removeItem("clerk_session_token");
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
                console.log('[AuthRenderer] No saved session found.');
                setState({ status: "idle" });
            }
        } catch (e) {
            console.error('[AuthRenderer] Restore err:', e);
        }
    }

    window.fridayAuth = { initAuth, signIn, signOut, getAuthState, onAuthStateChange };
})();
