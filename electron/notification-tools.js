const { Notification, dialog, BrowserWindow } = require('electron');
const path = require('path');

/**
 * Shows a native OS notification.
 */
function showNotification(title, body) {
    const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');

    if (Notification.isSupported()) {
        const notification = new Notification({
            title,
            body,
            icon: iconPath
        });
        notification.show();
        return { success: true };
    } else {
        return { success: false, error: 'Notifications not supported' };
    }
}

/**
 * Shows a native message box dialog.
 */
async function showMessageDialog(options) {
    // options: { type, title, message, buttons }
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showMessageBox(win, {
        type: options.type || 'info',
        title: options.title || 'Friday',
        message: options.message || '',
        buttons: options.buttons || ['OK'],
        defaultId: 0,
        cancelId: 0
    });

    return { response: result.response };
}

module.exports = {
    showNotification,
    showMessageDialog
};
