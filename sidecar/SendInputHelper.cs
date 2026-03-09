// ═══════════════════════════════════════════════════════════════════════
// sidecar/SendInputHelper.cs — Keyboard and Mouse Simulation
// Uses Win32 SendInput for low-level input injection.
// Fallback for apps that don't expose UIA patterns.
// ═══════════════════════════════════════════════════════════════════════

using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace Friday.Sidecar;

internal static class SendInputHelper
{
    // ── SendInput Structures ────────────────────────────────────────────

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION union;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public nint dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public nint dwExtraInfo;
    }

    // Input types
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    // Keyboard flags
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    // Mouse flags
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    // ── Public API ──────────────────────────────────────────────────────

    /// <summary>
    /// Type a string using Unicode character injection.
    /// params: { text: string }
    /// </summary>
    public static object? TypeString(JsonNode? @params)
    {
        string text = @params?["text"]?.GetValue<string>()
            ?? throw new ArgumentException("text is required");

        var inputs = new List<INPUT>();
        foreach (char c in text)
        {
            // Key down
            inputs.Add(new INPUT
            {
                type = INPUT_KEYBOARD,
                union = new INPUTUNION
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = c,
                        dwFlags = KEYEVENTF_UNICODE,
                    }
                }
            });
            // Key up
            inputs.Add(new INPUT
            {
                type = INPUT_KEYBOARD,
                union = new INPUTUNION
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = c,
                        dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    }
                }
            });
        }

        uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
        return new { typed = true, chars = text.Length, inputsSent = sent };
    }

    /// <summary>
    /// Send a key chord (e.g., Ctrl+C, Alt+F4, Ctrl+Shift+S).
    /// params: { keys: string } — format: "ctrl+c", "alt+f4", "ctrl+shift+s"
    /// </summary>
    public static object? SendChord(JsonNode? @params)
    {
        string keys = @params?["keys"]?.GetValue<string>()
            ?? throw new ArgumentException("keys is required");

        var parts = keys.ToLower().Split('+');
        var vks = new List<ushort>();

        foreach (var part in parts)
        {
            ushort vk = part.Trim() switch
            {
                "ctrl" or "control" => 0x11,    // VK_CONTROL
                "alt" => 0x12,                   // VK_MENU
                "shift" => 0x10,                 // VK_SHIFT
                "win" or "windows" => 0x5B,      // VK_LWIN
                "enter" or "return" => 0x0D,     // VK_RETURN
                "tab" => 0x09,                   // VK_TAB
                "esc" or "escape" => 0x1B,       // VK_ESCAPE
                "space" => 0x20,                 // VK_SPACE
                "backspace" or "back" => 0x08,   // VK_BACK
                "delete" or "del" => 0x2E,       // VK_DELETE
                "up" => 0x26,
                "down" => 0x28,
                "left" => 0x25,
                "right" => 0x27,
                "home" => 0x24,
                "end" => 0x23,
                "pageup" => 0x21,
                "pagedown" => 0x22,
                "insert" => 0x2D,
                "f1"  => 0x70, "f2"  => 0x71, "f3"  => 0x72, "f4"  => 0x73,
                "f5"  => 0x74, "f6"  => 0x75, "f7"  => 0x76, "f8"  => 0x77,
                "f9"  => 0x78, "f10" => 0x79, "f11" => 0x7A, "f12" => 0x7B,
                var k when k.Length == 1 => (ushort)char.ToUpper(k[0]),
                _ => throw new ArgumentException($"Unknown key: {part}")
            };
            vks.Add(vk);
        }

        var inputs = new List<INPUT>();

        // Press all keys in order
        foreach (var vk in vks)
        {
            inputs.Add(new INPUT
            {
                type = INPUT_KEYBOARD,
                union = new INPUTUNION
                {
                    ki = new KEYBDINPUT { wVk = vk }
                }
            });
        }

        // Release in reverse order
        for (int i = vks.Count - 1; i >= 0; i--)
        {
            inputs.Add(new INPUT
            {
                type = INPUT_KEYBOARD,
                union = new INPUTUNION
                {
                    ki = new KEYBDINPUT { wVk = vks[i], dwFlags = KEYEVENTF_KEYUP }
                }
            });
        }

        uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
        return new { chord = keys, inputsSent = sent };
    }

    /// <summary>
    /// Click at absolute screen coordinates.
    /// params: { x: int, y: int, button?: "left"|"right" }
    /// </summary>
    public static object? ClickAt(JsonNode? @params)
    {
        int x = @params?["x"]?.GetValue<int>()
            ?? throw new ArgumentException("x is required");
        int y = @params?["y"]?.GetValue<int>()
            ?? throw new ArgumentException("y is required");
        string button = @params?["button"]?.GetValue<string>() ?? "left";

        // ITERATION 17: Support Multi-Monitor (Virtual Desktop) scaling
        int vScreenWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int vScreenHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        int vScreenX = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int vScreenY = GetSystemMetrics(SM_YVIRTUALSCREEN);

        // Adjust for negative coordinates if secondary monitor is on the left/top
        int adjustedX = x - vScreenX;
        int adjustedY = y - vScreenY;

        int normX = (int)((adjustedX * 65535.0) / (vScreenWidth - 1));
        int normY = (int)((adjustedY * 65535.0) / (vScreenHeight - 1));

        uint downFlag = button == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
        uint upFlag = button == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;

        var inputs = new[]
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                union = new INPUTUNION
                {
                    mi = new MOUSEINPUT
                    {
                        dx = normX,
                        dy = normY,
                        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | downFlag,
                    }
                }
            },
            new INPUT
            {
                type = INPUT_MOUSE,
                union = new INPUTUNION
                {
                    mi = new MOUSEINPUT
                    {
                        dx = normX,
                        dy = normY,
                        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | upFlag,
                    }
                }
            },
        };

        uint sent = SendInput(2, inputs, Marshal.SizeOf<INPUT>());
        return new { clicked = true, x, y, button, inputsSent = sent };
    }
}
