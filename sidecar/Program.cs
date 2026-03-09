// ═══════════════════════════════════════════════════════════════════════
// sidecar/Program.cs — Friday Sidecar Entry Point
// Named Pipe server with JSON-RPC message dispatcher.
// Handles HUD click-through, UIA, and SendInput requests from Friday.
// ═══════════════════════════════════════════════════════════════════════

using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;

namespace Friday.Sidecar;

internal static class Program
{
    private const string PipeName = "friday-sidecar-v2";
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    static async Task Main(string[] args)
    {
        Console.WriteLine("[sidecar] Friday Sidecar starting...");
        Console.WriteLine($"[sidecar] PID: {Environment.ProcessId}");
        Console.WriteLine($"[sidecar] Pipe: \\\\.\\pipe\\{PipeName}");

        int maxInstances = 5;
        var tasks = new List<Task>();
        for (int i = 0; i < maxInstances; i++)
        {
            tasks.Add(StartPipeListener(i));
        }

        await Task.WhenAll(tasks);
    }

    private static async Task StartPipeListener(int instanceId)
    {
        while (true)
        {
            try
            {
                await RunPipeSession(instanceId);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[sidecar-{instanceId}] Session error: {ex.Message}");
            }

            await Task.Delay(200);
        }
    }

    private static async Task RunPipeSession(int instanceId)
    {
        using var server = new NamedPipeServerStream(
            PipeName,
            PipeDirection.InOut,
            10, // Max instances
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous
        );

        await server.WaitForConnectionAsync();
        Console.WriteLine($"[sidecar-{instanceId}] Friday connected!");

        // CRITICAL: Use UTF8 without BOM
        var utf8NoBom = new UTF8Encoding(false);
        using var reader = new StreamReader(server, utf8NoBom, leaveOpen: true);
        using var writer = new StreamWriter(server, utf8NoBom, leaveOpen: true) { AutoFlush = true };

        while (server.IsConnected)
        {
            string? line = await reader.ReadLineAsync();
            if (line == null) break;

            if (string.IsNullOrWhiteSpace(line)) continue;

            Console.WriteLine($"[sidecar-{instanceId}] ← {line}");
            string response = await DispatchMessage(line);
            Console.WriteLine($"[sidecar-{instanceId}] → {response}");

            await writer.WriteLineAsync(response);
        }

        Console.WriteLine($"[sidecar-{instanceId}] Client disconnected.");
    }

    /// <summary>
    /// Parse a JSON-RPC request and route to the appropriate handler.
    /// </summary>
    private static async Task<string> DispatchMessage(string json)
    {
        try
        {
            var doc = JsonNode.Parse(json);
            if (doc == null) return ErrorResponse(0, "Invalid JSON");

            int id = doc["id"]?.GetValue<int>() ?? 0;
            string method = doc["method"]?.GetValue<string>() ?? "";
            var @params = doc["params"];

            object? result = method switch
            {
                "ping" => HandlePing(),
                "setClickThrough" => HandleSetClickThrough(@params),
                "uia.findElement" => UiaHelper.FindElement(@params),
                "uia.invoke" => UiaHelper.Invoke(@params),
                "uia.setValue" => UiaHelper.SetValue(@params),
                "uia.getText" => UiaHelper.GetText(@params),
                "uia.toggle" => UiaHelper.Toggle(@params),
                "uia.dumpTree" => UiaHelper.DumpTree(@params),
                "window.list" => WindowHelper.ListWindows(@params),
                "window.focus" => WindowHelper.FocusWindow(@params),
                "window.close" => WindowHelper.CloseWindow(@params),
                "process.list" => ProcessHelper.ListProcesses(@params),
                "process.kill" => ProcessHelper.KillProcess(@params),
                "input.typeString" => SendInputHelper.TypeString(@params),
                "input.sendChord" => SendInputHelper.SendChord(@params),
                "input.clickAt" => SendInputHelper.ClickAt(@params),
                _ => throw new Exception($"Unknown method: {method}")
            };

            return SuccessResponse(id, result);
        }
        catch (Exception ex)
        {
            return ErrorResponse(0, ex.Message);
        }
    }

    // ── Built-in Handlers ────────────────────────────────────────────────

    private static object HandlePing() => new { pong = true, time = DateTime.UtcNow };

    /// <summary>
    /// Apply WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW to the HUD window.
    /// This makes the window click-through at the OS level.
    /// </summary>
    private static object HandleSetClickThrough(JsonNode? @params)
    {
        // DEPRECATED: Friday handles this via setIgnoreMouseEvents(true, { forward: true })
        // Returning success without modifying the window style.
        return new { success = true, note = "Click-through managed by Friday" };
    }

    // ── Win32 Interop (fallback if CsWin32 doesn't generate these) ───────

    [DllImport("user32.dll", SetLastError = true)]
    private static extern long GetWindowLongPtr(nint hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern long SetWindowLongPtr(nint hWnd, int nIndex, long dwNewLong);

    // ── JSON-RPC Response Helpers ────────────────────────────────────────

    private static string SuccessResponse(int id, object? result)
    {
        var resp = new { id, result };
        return JsonSerializer.Serialize(resp, JsonOpts);
    }

    private static string ErrorResponse(int id, string message)
    {
        var resp = new { id, error = message };
        return JsonSerializer.Serialize(resp, JsonOpts);
    }
}
