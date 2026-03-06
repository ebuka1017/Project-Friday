using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Friday.Sidecar
{
    internal static class WindowHelper
    {
        // ── Win32 API Definitions ──

        private delegate bool EnumWindowsProc(IntPtr hWnd, int lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumFunc, int lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        private const int SW_RESTORE = 9;
        private const uint WM_CLOSE = 0x0010;

        // ── Command Handlers ──

        /// <summary>
        /// Lists all visible windows with titles.
        /// </summary>
        public static object ListWindows(JsonNode? @params)
        {
            var windows = new List<object>();

            EnumWindows((hWnd, lParam) =>
            {
                if (IsWindowVisible(hWnd))
                {
                    int length = GetWindowTextLength(hWnd);
                    if (length > 0)
                    {
                        var builder = new StringBuilder(length + 1);
                        GetWindowText(hWnd, builder, builder.Capacity);
                        string title = builder.ToString();

                        // Filter out common invisible or system overlay windows
                        if (!string.IsNullOrWhiteSpace(title) && title != "Program Manager")
                        {
                            windows.Add(new
                            {
                                handle = hWnd.ToInt64(), // Pass as integer for JSON
                                title = title
                            });
                        }
                    }
                }
                return true; // Continue enumeration
            }, 0);

            return new { success = true, windows };
        }

        /// <summary>
        /// Brings the specified window to the foreground.
        /// </summary>
        public static object FocusWindow(JsonNode? @params)
        {
            if (@params == null || @params["handle"] == null)
                throw new ArgumentException("Missing 'handle' parameter.");

            long currentHandle = @params["handle"]!.GetValue<long>();
            IntPtr hWnd = new IntPtr(currentHandle);

            // Sometimes the window might be minimized
            ShowWindow(hWnd, SW_RESTORE);
            bool success = SetForegroundWindow(hWnd);

            return new { success, handle = currentHandle };
        }

        /// <summary>
        /// Closes the specified window.
        /// </summary>
        public static object CloseWindow(JsonNode? @params)
        {
            if (@params == null || @params["handle"] == null)
                throw new ArgumentException("Missing 'handle' parameter.");

            long currentHandle = @params["handle"]!.GetValue<long>();
            IntPtr hWnd = new IntPtr(currentHandle);

            // Graceful close using WM_CLOSE
            SendMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);

            return new { success = true, handle = currentHandle };
        }
    }
}
