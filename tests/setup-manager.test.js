const SetupManager = require('../electron/setup-manager');

// Mock electron
jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
  })),
  ipcMain: {
    once: jest.fn(),
  },
}));

// Mock electron-store
jest.mock('electron-store', () => {
    return jest.fn().mockImplementation(() => {
        let storeData = {};
        return {
            get: jest.fn((key) => {
                if (key.includes('.')) {
                    const [p1, p2] = key.split('.');
                    return storeData[p1] ? storeData[p1][p2] : undefined;
                }
                return storeData[key];
            }),
            set: jest.fn((key, value) => { storeData[key] = value; }),
            clear: jest.fn(() => { storeData = {}; }),
        };
    });
});

describe('SetupManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SetupManager.store.clear();
  });

  test('should initially have no keys', () => {
    expect(SetupManager.hasKeys()).toBe(false);
  });

  test('should store keys on setup:submit', async () => {
    const mockKeys = { gemini: 'test-gemini-key', zep: 'test-zep-key' };
    
    // Simulate showSetupDialog which sets up the ipcMain.once listener
    const showPromise = SetupManager.showSetupDialog();
    
    // Get the handler registered with ipcMain.once
    const onceHandler = require('electron').ipcMain.once.mock.calls.find(call => call[0] === 'setup:submit')[1];
    
    // Simulate submitting keys
    onceHandler({}, mockKeys);
    
    const result = await showPromise;
    expect(result).toEqual(mockKeys);
    expect(SetupManager.hasKeys()).toBe(true);
    expect(SetupManager.getKeys()).toEqual(mockKeys);
  });
});
