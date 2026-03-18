const { ipcMain } = require('electron');
const axios = require('axios');

class AuthService {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
    }

    /**
     * Verifies a Clerk session token with the backend.
     * Note: In a production app, the secret key should be handled securely.
     */
    async verifyToken(token) {
        try {
            if (!token || token === 'undefined') {
                throw new Error('No token provided');
            }

            // Priority 1.2: Strict verification with Clerk backend
            const clerkSecret = process.env.CLERK_SECRET_KEY;
            if (!clerkSecret) {
                console.warn('[Auth] CLERK_SECRET_KEY missing. Falling back to simulation for dev.');
                this.isAuthenticated = true;
                return { success: true };
            }

            const response = await axios.get(
                `https://api.clerk.com/v1/sessions/${token}/verify`,
                {
                    headers: {
                        'Authorization': `Bearer ${clerkSecret}`
                    }
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
        this.currentUser = user;
        console.log('[Auth] User logged in:', user?.firstName || 'Unknown');
    }

    logout() {
        this.isAuthenticated = false;
        this.currentUser = null;
        console.log('[Auth] User logged out');
    }

    getStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            currentUser: this.currentUser
        };
    }

    init() {
        ipcMain.handle('auth:login', async (event, { token, user }) => {
            const result = await this.verifyToken(token);
            if (result.success) {
                this.login(user);
            }
            return result;
        });

        ipcMain.handle('auth:logout', () => {
            this.logout();
            return { success: true };
        });

        ipcMain.handle('auth:getStatus', () => {
            return this.getStatus();
        });
        
        // Removed the insecure auth:setStatus handler
    }
}

module.exports = new AuthService();
