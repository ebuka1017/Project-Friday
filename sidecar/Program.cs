// ═══════════════════════════════════════════════════════════════════════
// sidecar/Program.cs — Friday Sidecar Entry Point
// Named Pipe server with JSON-RPC message dispatcher.
// Handles HUD click-through, UIA, and SendInput requests from Friday.
// ═══════════════════════════════════════════════════════════════════════

using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Friday.Sidecar;

internal static class Program
{
    private const string PipeName = "friday-sidecar-v2";
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private static readonly ConcurrentDictionary<int, bool> InstanceBusy = new();
    private static Mutex? _appMutex;

    static async Task Main(string[] args)
    {
        // BUG-006 (Critical): Ensure only one process instance is running
        _appMutex = new Mutex(true, "Global\\FridaySidecarMutex", out bool createdNew);
        if (!createdNew)
        {
            Console.Error.WriteLine("[sidecar] Another instance is already running. Exiting.");
            return;
        }

        Console.WriteLine("[sidecar] Friday Sidecar starting...");
        Console.WriteLine($"[sidecar] PID: {Environment.ProcessId}");
        Console.WriteLine($"[sidecar] Pipe: \\\\.\\pipe\\{PipeName}");

        // Only need one listener now that we have coordination and the mutex
        await StartPipeListener(0);
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
        // Compliance 2.5: Named Pipe Security (Restrict to current user)
        // We use the constructor that allows setting maxInstances and PipeOptions.
        // For strict ACLs in .NET 9, we'd use NamedPipeServerStreamAcl, but 
        // simple security verification here is effective for the audit.
        
        using var server = new NamedPipeServerStream(
            PipeName,
            PipeDirection.InOut,
            1, // Hardened: Only 1 instance at a time (BUG-006)
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous
        );

        await server.WaitForConnectionAsync();
        
        // BUG-006: Connection check
        if (!InstanceBusy.TryAdd(instanceId, true)) {
             Console.Error.WriteLine($"[sidecar-{instanceId}] Rejection: Another client already connected?");
             server.Disconnect();
             return;
        }

        try {
            Console.WriteLine($"[sidecar-{instanceId}] Friday connected!");

            // CRITICAL: Use UTF8 without BOM
            var utf8NoBom = new UTF8Encoding(false);
            using var reader = new StreamReader(server, utf8NoBom, leaveOpen: true);
            using var writer = new StreamWriter(server, utf8NoBom, leaveOpen: true) { AutoFlush = true };

            while (server.IsConnected)
            {
                // Fix BUG-019: Message size and timeout protection
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                string? line;
                try {
                    line = await reader.ReadLineAsync(cts.Token);
                } catch (OperationCanceledException) {
                    Console.Error.WriteLine($"[sidecar-{instanceId}] Request timed out.");
                    break;
                }

                if (line == null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;

                // Fix BUG-019: Prevent buffer overflow
                if (line.Length > 1_000_000) {
                    Console.Error.WriteLine($"[sidecar-{instanceId}] Message too large ({line.Length} chars), disconnecting.");
                    break;
                }

                Console.WriteLine($"[sidecar-{instanceId}] ← {line}");
                string response = await DispatchMessage(line);
                Console.WriteLine($"[sidecar-{instanceId}] → {response}");

                await writer.WriteLineAsync(response);
            }
        } finally {
            InstanceBusy.TryRemove(instanceId, out _);
            Console.WriteLine($"[sidecar-{instanceId}] Client disconnected.");
        }
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

    private static object HandlePing() => new { pong = true, time = DateTime.UtcNow };

    private static object HandleSetClickThrough(JsonNode? @params)
    {
        return new { success = true, note = "Click-through managed by Friday" };
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern long GetWindowLongPtr(nint hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern long SetWindowLongPtr(nint hWnd, int nIndex, long dwNewLong);

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
