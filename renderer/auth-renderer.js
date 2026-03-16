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
                
                // Check if persona exists
                const pName = await window.friday.db.getMemory('user_name');
                const pGender = await window.friday.db.getMemory('user_gender');
                
                if (!pName || !pGender) {
                    // Start Personalization flow within the same overlay
                    if (window.nextObStep) window.nextObStep('Name');
                } else {
                    // Persona exists, hide overlay and enter app
                    const overlay = document.getElementById('onboardingOverlay');
                    if (overlay) overlay.classList.add('hidden');
                    
                    // Update agent with full identity
                    const bio = await window.friday.db.getMemory('user_bio');
                    window.friday.setAuthStatus(true, { ...user, persona: { name: pName, gender: pGender, bio } });
                }
            } catch (e) {
                console.error('[AuthRenderer] DB secure storage/persona check err:', e);
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
                if ( legacy) {
                    console.log('[AuthRenderer] Migrating legacy session to secure storage...');
                    await window.friday.db.setSecret("clerk_session_token", legacy);
                    localStorage.removeItem("clerk_session_token");
                }

                // 2. Load from secure storage
                const saved = await window.friday.db.getSecret("clerk_session_token");
                const overlay = document.getElementById('onboardingOverlay');
                
                // Standardize memory keys: if legacy exists, migrate
                let isCompleted = await window.friday.db.getMemory('onboarding_complete');
                if (isCompleted !== '1') {
                    const legacy1 = await window.friday.db.getMemory('onboarding_completed');
                    const legacy2 = await window.friday.db.getMemory('onboarding_seen');
                    if (legacy1 === '1' || legacy2 === '1') {
                        console.log('[AuthRenderer] Migrating legacy onboarding key -> onboarding_complete');
                        await window.friday.db.setMemory('onboarding_complete', '1');
                        isCompleted = '1';
                    }
                }
                
                console.log('[AuthRenderer] Initializing. Onboarding completed status:', isCompleted);

                if (saved && saved.length > 10) {
                    console.log('[AuthRenderer] Restoring session from secure storage...');
                    let user = null;
                    try {
                        const payload = JSON.parse(atob(saved.split(".")[1]));
                        user = {
                            id: payload.sub,
                            email: payload.email,
                            name: payload.name || payload.username || payload.sub,
                            imageUrl: payload.image_url,
                        };
                    } catch (e) {
                        console.error('[AuthRenderer] JWT Parse failed:', e);
                        user = { id: 'unknown', name: 'User' };
                    }

                    // Load persona
                    const pName = await window.friday.db.getMemory('user_name');
                    const pGender = await window.friday.db.getMemory('user_gender');
                    const pBio = await window.friday.db.getMemory('user_bio');

                    if (pName && pGender) {
                        console.log('[AuthRenderer] Authenticated and persona present. Hiding overlay.');
                        setState({ status: "authenticated", user });
                        window.friday.setAuthStatus(true, { ...user, persona: { name: pName, gender: pGender, bio: pBio || '' } });
                        if (overlay) overlay.classList.add('hidden');

                        // Sync settings UI
                        const prefName = document.getElementById('prefNameInput');
                        const prefGender = document.getElementById('prefGenderSelect');
                        const prefBio = document.getElementById('prefBioInput');
                        if (prefName) prefName.value = pName;
                        if (prefGender) prefGender.value = pGender;
                        if (prefBio) prefBio.value = pBio || '';
                    } else {
                        // Signed in but no persona (e.g. app crashed after auth)
                        console.log('[AuthRenderer] User authenticated but persona missing. Triggering personalization...');
                        setState({ status: "authenticated", user });
                        if (overlay) {
                            overlay.classList.remove('hidden');
                            if (window.nextObStep) {
                                await window.nextObStep('Name');
                            } else {
                                console.error('[AuthRenderer] nextObStep not found for Name transition');
                                // Fallback show directly
                                const nameStep = document.getElementById('obStepName');
                                if (nameStep) {
                                    nameStep.classList.remove('hidden');
                                    nameStep.classList.add('active');
                                }
                            }
                        }
                    }
                } else {
                    // Not signed in: Show onboarding slides
                    console.log('[AuthRenderer] No saved session. Preparing onboarding overlay...');
                    setState({ status: "idle" });
                    if (overlay) {
                        if (overlay.classList.contains('hidden')) {
                            console.log('[AuthRenderer] Un-hiding onboardingOverlay');
                            overlay.classList.remove('hidden');
                        }
                        if (window.nextObStep) {
                            console.log('[AuthRenderer] Starting from Splash (Step 0)');
                            window.nextObStep(0);
                        } else {
                            console.error('[AuthRenderer] nextObStep not found for initial onboarding');
                        }
                    } else {
                        console.error('[AuthRenderer] onboardingOverlay element NOT found!');
                    }
                }


                // Initial load of external accounts
                await refreshExternalAccounts();

                // Periodic check for account linkage
                setInterval(refreshExternalAccounts, 30000);

            } catch (e) {
                console.error('[AuthRenderer] Restore/Migration err:', e);
                setState({ status: "idle" });
            }
        })();
    }

    async function refreshExternalAccounts() {
        if (_authState.status !== 'authenticated' || !_authState.user) return;

        try {
            const freshUser = await window.friday.clerkGetUser(_authState.user.id);
            if (freshUser && freshUser.externalAccounts) {
                const accounts = freshUser.externalAccounts;
                const providers = accounts.map(a => a.provider);
                
                // Update UI toggles/status for each connector
                updateConnectorUI('connGmail', providers.includes('oauth_google'));
                updateConnectorUI('connGoogleCalendar', providers.includes('oauth_google'));
                updateConnectorUI('connGoogleDrive', providers.includes('oauth_google'));
                updateConnectorUI('connOutlook', providers.includes('oauth_outlook'));
                updateConnectorUI('connOutlookCalendar', providers.includes('oauth_outlook'));

                // Update auth status to include these links for the agent to know what it has access to
                window.friday.setAuthStatus(true, { ..._authState.user, externalAccounts: accounts });
            }
        } catch (e) {
            console.error('[AuthRenderer] Refresh external accounts err:', e);
        }
    }

    function updateConnectorUI(id, isConnected) {
        const toggleEl = document.getElementById(`toggle_${id}`);
        const statusEl = document.getElementById(`status_${id}`);
        
        if (toggleEl) {
            toggleEl.checked = isConnected;
        }
        if (statusEl) {
            statusEl.textContent = isConnected ? 'Connected' : 'Disconnected';
            statusEl.style.color = isConnected ? 'var(--success)' : 'var(--text-muted)';
        }
    }

    window.fridayAuth = { initAuth, signIn, signOut, getAuthState, onAuthStateChange, refreshExternalAccounts };
})();
