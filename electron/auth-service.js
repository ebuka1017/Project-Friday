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
            // This is a placeholder for actual Clerk verification logic
            // Since we don't have a backend to talk to, we'll simulate it,
            // but the architecture is now set up correctly in the Main process.
            
            if (!token || token === 'undefined') {
                throw new Error('No token provided');
            }

            // SIMULATION: In reality, we'd call axios.get('https://api.clerk.com/v1/sessions/' + token + '/verify', ...)
            // For now, if we have any non-empty token, we'll "verify" it.
            this.isAuthenticated = true;
            console.log('[Auth] Token verified successfully (simulation)');
            
            return { success: true };
        } catch (error) {
            console.error('[Auth] Verification failed:', error);
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
