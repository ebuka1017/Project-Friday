using System;
using System.Diagnostics;
using System.Linq;
using System.Text.Json.Nodes;

namespace Friday.Sidecar;
    public static class ProcessHelper
    {
        public static object ListProcesses(JsonNode? _)
        {
            try
            {
                var processes = Process.GetProcesses()
                    .Where(p => !string.IsNullOrEmpty(p.MainWindowTitle))
                    .Select(p => new
                    {
                        pid = p.Id,
                        name = p.ProcessName,
                        title = p.MainWindowTitle,
                        memoryBytes = p.WorkingSet64
                    })
                    .ToList();

                return new { success = true, processes };
            }
            catch (Exception ex)
            {
                return new { error = ex.Message };
            }
        }

        public static object KillProcess(JsonNode? @params)
        {
            if (@params == null || @params["pid"] == null)
            {
                return new { error = "Missing 'pid' parameter." };
            }

            try
            {
                int pid = @params["pid"]!.GetValue<int>();
                var process = Process.GetProcessById(pid);
                process.Kill();
                process.WaitForExit(5000); // give it 5 seconds to die
                
                return new { success = true, message = $"Process {pid} terminated." };
            }
            catch (ArgumentException)
            {
                return new { error = "Process not found." };
            }
            catch (Exception ex)
            {
                return new { error = ex.Message };
            }
        }
    }
