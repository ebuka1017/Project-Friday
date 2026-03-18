const AuthService = require('../electron/auth-service');

// Mock electron and axios
jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
}));

jest.mock('axios');
const axios = require('axios');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AuthService.isAuthenticated = false;
    AuthService.currentUser = null;
    AuthService.init();
  });

  test('should initialize with correct status', () => {
    const status = AuthService.getStatus();
    expect(status.isAuthenticated).toBe(false);
    expect(status.currentUser).toBeNull();
  });

  test('should handle login successfully', async () => {
    // AuthService.init() was called in beforeEach, so handlers are registered
    const loginHandler = require('electron').ipcMain.handle.mock.calls.find(call => call[0] === 'auth:login')[1];
    
    const result = await loginHandler({}, { token: 'mock-token', user: { email: 'test@example.com' } });
    
    expect(result.success).toBe(true);
    const status = AuthService.getStatus();
    expect(status.isAuthenticated).toBe(true);
    expect(status.currentUser.email).toBe('test@example.com');
  });

  test('should handle logout', async () => {
    // Set authenticated state manually for test
    AuthService.isAuthenticated = true;
    
    const logoutHandler = require('electron').ipcMain.handle.mock.calls.find(call => call[0] === 'auth:logout')[1];
    await logoutHandler();
    
    const status = AuthService.getStatus();
    expect(status.isAuthenticated).toBe(false);
    expect(status.currentUser).toBeNull();
  });
});
