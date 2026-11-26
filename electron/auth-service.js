const { ipcMain } = require('electron');
const axios = require('axios');
const CONSTANTS = require('../shared/constants');

class AuthService {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this._handlersRegistered = false;
    }

    /**
     * Sync currentUser to shared state without breaking minimal test mocks.
     */
    _syncSharedState() {
        try {
            const { setState } = require('./state');
            setState({ currentUser: this.currentUser });
        } catch {
            // Ignored in minimal unit test environments
        }
    }

    /**
     * Verifies a Clerk session ID or OAuth access token with the backend.
     */
    async verifyToken(token) {
        try {
            if (!token || token === 'undefined') {
                throw new Error('No token provided');
            }

            const clerkSecret = process.env.CLERK_SECRET_KEY || process.env.CLERK_CLIENT_SECRET;
            if (!clerkSecret) {
                console.warn('[Auth] CLERK_SECRET_KEY / CLERK_CLIENT_SECRET missing. Falling back to simulation for dev.');
                this.isAuthenticated = true;
                return { success: true };
            }

            // OAuth access tokens (PKCE flow) are JWTs; session IDs use /v1/sessions/{id}/verify.
            if (typeof token === 'string' && token.split('.').length === 3) {
                const domain = process.env.CLERK_DOMAIN || CONSTANTS.DEFAULT_CLERK_DOMAIN;
                const response = await axios.get(`https://${domain}/oauth/userinfo`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (response.data && response.data.sub) {
                    this.isAuthenticated = true;
                    return { success: true, user: response.data };
                }
                throw new Error('Invalid OAuth token');
            }

            const response = await axios.get(
                `https://api.clerk.com/v1/sessions/${token}/verify`,
                {
                    headers: {
                        Authorization: `Bearer ${clerkSecret}`,
                    },
                }
            );

            if (response.data && response.data.status === 'active') {
                this.isAuthenticated = true;
                return { success: true, user: response.data.user };
            }

            throw new Error('Invalid or inactive session');
        } catch (error) {
            console.error('[Auth] Verification failed:', error.message);
            this.isAuthenticated = false;
            return { success: false, error: error.message };
        }
    }

    login(user) {
        this.isAuthenticated = true;
        this.currentUser = user || null;
        this._syncSharedState();
        console.log('[Auth] User logged in:', user?.firstName || user?.name || 'Unknown');
    }

    updateUser(patch) {
        if (!this.isAuthenticated || !patch) return false;
        this.currentUser = { ...(this.currentUser || {}), ...patch };
        this._syncSharedState();
        return true;
    }

    logout() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this._syncSharedState();
        console.log('[Auth] User logged out');
    }

    getStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            currentUser: this.currentUser,
        };
    }

    init() {
        const register = (channel, handler) => {
            if (typeof ipcMain.removeHandler === 'function') {
                ipcMain.removeHandler(channel);
            }
            ipcMain.handle(channel, handler);
        };

        register('auth:login', async (event, { token, user }) => {
            const result = await this.verifyToken(token);
            if (result.success) {
                this.login(user || result.user);
            }
            return result;
        });

        register('auth:updateUser', (event, patch) => {
            if (!this.isAuthenticated) {
                return { success: false, error: 'Unauthorized' };
            }
            this.updateUser(patch);
            return { success: true, user: this.currentUser };
        });

        register('auth:logout', () => {
            this.logout();
            return { success: true };
        });

        register('auth:getStatus', () => {
            return this.getStatus();
        });
    }
}

module.exports = new AuthService();
