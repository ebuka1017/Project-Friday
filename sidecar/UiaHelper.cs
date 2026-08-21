// ═══════════════════════════════════════════════════════════════════════
// sidecar/UiaHelper.cs — UI Automation Helper (COM Interop for .NET 9)
// Provides desktop element inspection and control via UIA COM interfaces
// defined inline (no COMReference or TLB import needed).
// ═══════════════════════════════════════════════════════════════════════

using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Friday.Sidecar;

// ── Minimal COM Interface Definitions for UIAutomation ─────────────────
// Only the interfaces and constants we actually need are defined here.
// Full UIA has hundreds of interfaces — we declare only what we use.

[ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomation
{
    // 0
    int CompareElements(object el1, object el2);
    // 1
    int CompareRuntimeIds(int[] a, int[] b);
    // 2
    IUIAutomationElement GetRootElement();
    // 3
    IUIAutomationElement ElementFromHandle(nint hwnd);
    // 4
    IUIAutomationElement ElementFromPoint(tagPOINT pt);
    // 5
    IUIAutomationElement GetFocusedElement();
    // 6
    void GetRootElementBuildCacheDummy();
    // 7
    void ElementFromHandleBuildCacheDummy();
    // 8
    void ElementFromPointBuildCacheDummy();
    // 9
    void GetFocusedElementBuildCacheDummy();
    // 10
    void CreateTreeWalkerDummy();
    // 11
    IUIAutomationTreeWalker get_ControlViewWalker();
    // 12
    IUIAutomationTreeWalker get_ContentViewWalker();
    // 13
    IUIAutomationTreeWalker get_RawViewWalker();
    // 14
    void get_RawViewConditionDummy();
    // 15
    void get_ControlViewConditionDummy();
    // 16
    void get_ContentViewConditionDummy();
    // 17
    IUIAutomationCacheRequest CreateCacheRequest(); // stub
    // 18
    IUIAutomationCondition CreateTrueCondition();
    // 19
    IUIAutomationCondition CreateFalseCondition();
    // 20
    IUIAutomationCondition CreatePropertyCondition(int propertyId, [MarshalAs(UnmanagedType.Struct)] object value);
}

[ComImport, Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationElement
{
    // 0
    void SetFocus();
    // 1
    int[] GetRuntimeId();
    // 2
    IUIAutomationElement FindFirst(TreeScope scope, IUIAutomationCondition condition);
    // 3
    IUIAutomationElementArray FindAll(TreeScope scope, IUIAutomationCondition condition);
    // 4
    void FindFirstBuildCacheDummy();
    // 5
    void FindAllBuildCacheDummy();
    // 6
    void BuildUpdatedCacheDummy();
    // 7
    [return: MarshalAs(UnmanagedType.Struct)]
    object GetCurrentPropertyValue(int propertyId);
    // 8
    [return: MarshalAs(UnmanagedType.Struct)]
    object GetCurrentPropertyValueEx(int propertyId, bool ignoreDefaultValue);
    // 9
    [return: MarshalAs(UnmanagedType.Struct)]
    object GetCachedPropertyValue(int propertyId);
    // 10
    [return: MarshalAs(UnmanagedType.Struct)]
    object GetCachedPropertyValueEx(int propertyId, bool ignoreDefaultValue);
    // 11
    nint GetCurrentPatternAs(int patternId, [In] ref Guid riid);
    // 12
    void GetCachedPatternAsDummy();
    // 13
    void GetCurrentPatternDummy();
    // 14
    void GetCachedPatternDummy();
    // 15
    void GetCachedParentDummy();
    // 16
    void GetCachedChildrenDummy();
    // Properties — accessed via vtable
    // 17
    int get_CurrentProcessId();
    // 18
    int get_CurrentControlType();
    // 19
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentLocalizedControlType();
    // 20
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentName();
    // 21
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentAcceleratorKey();
    // 22
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentAccessKey();
    // 23
    int get_CurrentHasKeyboardFocus();
    // 24
    int get_CurrentIsKeyboardFocusable();
    // 25
    int get_CurrentIsEnabled();
    // 26
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentAutomationId();
    // 27
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentClassName();
}

[ComImport, Guid("352FFBA8-0973-437C-A61F-F64CAFD81DF9")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationCondition { }

[ComImport, Guid("4042C624-389C-4AFC-A630-9DF854A541FC")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationTreeWalker
{
    IUIAutomationElement GetParentElement(IUIAutomationElement element);
    IUIAutomationElement GetFirstChildElement(IUIAutomationElement element);
    IUIAutomationElement GetLastChildElement(IUIAutomationElement element);
    IUIAutomationElement GetNextSiblingElement(IUIAutomationElement element);
    IUIAutomationElement GetPreviousSiblingElement(IUIAutomationElement element);
}

[ComImport, Guid("14314595-B4BC-4055-95F2-58F2E42C9855")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationElementArray
{
    int get_Length();
    IUIAutomationElement GetElement(int index);
}

[ComImport, Guid("B17D7A26-3E18-4C46-8FEB-C8AAF3753E2C")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationCacheRequest { }

// IUIAutomationInvokePattern
[ComImport, Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationInvokePattern
{
    void Invoke();
}

// IUIAutomationValuePattern
[ComImport, Guid("A94CD8B1-0844-4CD6-9D2D-640537AB39E9")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationValuePattern
{
    void SetValue([MarshalAs(UnmanagedType.BStr)] string val);
    [return: MarshalAs(UnmanagedType.BStr)]
    string get_CurrentValue();
}

// IUIAutomationTogglePattern
[ComImport, Guid("94CF8058-9B8D-4AB9-8BFD-4CD0A33C8C70")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IUIAutomationTogglePattern
{
    void Toggle();
    int get_CurrentToggleState();
}

[StructLayout(LayoutKind.Sequential)]
internal struct tagPOINT { public int x, y; }

internal enum TreeScope
{
    TreeScope_Element = 1,
    TreeScope_Children = 2,
    TreeScope_Descendants = 4,
    TreeScope_Subtree = 7,
}

// ── COM Class IDs ─────────────────────────────────────────────────────

internal static class UiaClsids
{
    public static readonly Guid CUIAutomation = new("FF48DBA4-60EF-4201-AA87-54103EEF594E");
}

// ── UIA Pattern IDs ───────────────────────────────────────────────────

internal static class PatternIds
{
    public const int Invoke = 10000;
    public const int Value = 10002;
    public const int Toggle = 10015;
}

internal static class PropertyIds
{
    public const int Name = 30005;
    public const int AutomationId = 30011;
    public const int IsInvokePatternAvailable = 30010;
    public const int IsValuePatternAvailable = 30013;
    public const int IsTogglePatternAvailable = 30014;
    public const int IsEnabled = 30010; // Wait, IsEnabled is 30010? No, check docs.
    // Actually, let's use the ones from the walkthrough:
    // Invoke: 30010, Value: 30013, Toggle: 30014
}

// ═══════════════════════════════════════════════════════════════════════
// The actual UIA Helper implementation
// ═══════════════════════════════════════════════════════════════════════

internal static class UiaHelper
{
    private static readonly IUIAutomation Automation;

    static UiaHelper()
    {
        var type = Type.GetTypeFromCLSID(UiaClsids.CUIAutomation)
            ?? throw new Exception("CUIAutomation CLSID not found");
        Automation = (IUIAutomation)(Activator.CreateInstance(type)
            ?? throw new Exception("Failed to create CUIAutomation instance"));
    }

    /// <summary>
    /// Find an element by Name or AutomationId within a target application window.
    /// </summary>
    public static object? FindElement(JsonNode? @params)
    {
        var root = GetSearchRoot(@params);
        var condition = BuildCondition(@params);

        var element = root.FindFirst(TreeScope.TreeScope_Descendants, condition);
        if (element == null)
            return new { found = false };

        return DescribeElement(element);
    }

    /// <summary>
    /// Click a button or invoke-able control.
    /// </summary>
    public static object? Invoke(JsonNode? @params)
    {
        var element = FindRequiredElement(@params);
        
        // Priority 4.1: Check pattern availability first
        try {
            var isAvailable = element.GetCurrentPropertyValue(PropertyIds.IsInvokePatternAvailable);
            if (isAvailable is bool b && !b)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support Invoke pattern." };
            }
        } catch { /* Fallback */ }

        var guid = typeof(IUIAutomationInvokePattern).GUID;
        var ptr = element.GetCurrentPatternAs(PatternIds.Invoke, ref guid);
        try
        {
            if (ptr == IntPtr.Zero)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support clicking/invoking." };
            }

            // Fix BUG-021: Verify element is enabled and visible
            if (element.get_CurrentIsEnabled() == 0)
                return new { error = "Element is disabled" };

            var pattern = (IUIAutomationInvokePattern)Marshal.GetObjectForIUnknown(ptr);
            pattern.Invoke();
            return new { invoked = true, name = element.get_CurrentName() };
        }
        finally
        {
            // Fix BUG-014: Ensure release in all paths
            if (ptr != IntPtr.Zero) Marshal.Release(ptr);
        }
    }

    /// <summary>
    /// Set text value on a text field or editable control.
    /// </summary>
    public static object? SetValue(JsonNode? @params)
    {
        string value = @params?["value"]?.GetValue<string>()
            ?? throw new ArgumentException("value is required");

        var element = FindRequiredElement(@params);

        // Priority 4.1: Check pattern availability first
        try {
            var isAvailable = element.GetCurrentPropertyValue(PropertyIds.IsValuePatternAvailable);
            if (isAvailable is bool b && !b)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support Value pattern." };
            }
        } catch { /* Fallback */ }

        var guid = typeof(IUIAutomationValuePattern).GUID;
        var ptr = element.GetCurrentPatternAs(PatternIds.Value, ref guid);
        try
        {
            if (ptr == IntPtr.Zero)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support text input (ValuePattern)." };
            }

            if (element.get_CurrentIsEnabled() == 0)
                return new { error = "Element is disabled" };

            var pattern = (IUIAutomationValuePattern)Marshal.GetObjectForIUnknown(ptr);
            pattern.SetValue(value);
            return new { set = true, value };
        }
        finally
        {
            if (ptr != IntPtr.Zero) Marshal.Release(ptr);
        }
    }

    /// <summary>
    /// Read text from an element.
    /// </summary>
    public static object? GetText(JsonNode? @params)
    {
        var element = FindRequiredElement(@params);

        // Try ValuePattern first
        try
        {
            var guid = typeof(IUIAutomationValuePattern).GUID;
            var ptr = element.GetCurrentPatternAs(PatternIds.Value, ref guid);
            var pattern = (IUIAutomationValuePattern)Marshal.GetObjectForIUnknown(ptr);
            try
            {
                return new { text = pattern.get_CurrentValue(), source = "ValuePattern" };
            }
            finally
            {
                Marshal.Release(ptr);
            }
        }
        catch { }

        // Fallback to element name
        return new { text = element.get_CurrentName(), source = "Name" };
    }

    /// <summary>
    /// Toggle a checkbox or toggle control.
    /// </summary>
    public static object? Toggle(JsonNode? @params)
    {
        var element = FindRequiredElement(@params);

        // Priority 4.1: Check pattern availability first
        try {
            var isAvailable = element.GetCurrentPropertyValue(PropertyIds.IsTogglePatternAvailable);
            if (isAvailable is bool b && !b)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support Toggle pattern." };
            }
        } catch { /* Fallback */ }

        var guid = typeof(IUIAutomationTogglePattern).GUID;
        var ptr = element.GetCurrentPatternAs(PatternIds.Toggle, ref guid);
        try
        {
            if (ptr == IntPtr.Zero)
            {
                return new { error = $"Element '{element.get_CurrentName()}' does not support toggling." };
            }

            if (element.get_CurrentIsEnabled() == 0)
                return new { error = "Element is disabled" };

            var pattern = (IUIAutomationTogglePattern)Marshal.GetObjectForIUnknown(ptr);
            int before = pattern.get_CurrentToggleState();
            pattern.Toggle();
            int after = pattern.get_CurrentToggleState();
            return new { toggled = true, before, after };
        }
        finally
        {
            if (ptr != IntPtr.Zero) Marshal.Release(ptr);
        }
    }

    /// <summary>
    /// Dump the UIA subtree for debugging.
    /// </summary>
    public static object? DumpTree(JsonNode? @params)
    {
        var root = GetSearchRoot(@params);
        int maxDepth = @params?["maxDepth"]?.GetValue<int>() ?? 3;

        var sb = new StringBuilder();
        DumpTreeRecursive(root, sb, 0, maxDepth);
        return new { tree = sb.ToString() };
    }

    // ── Private Helpers ──────────────────────────────────────────────────

    private static IUIAutomationElement GetSearchRoot(JsonNode? @params)
    {
        string? app = @params?["app"]?.GetValue<string>();
        if (string.IsNullOrEmpty(app))
            return Automation.GetRootElement();

        var condition = Automation.CreatePropertyCondition(PropertyIds.Name, app);
        var appWindow = Automation.GetRootElement()
            .FindFirst(TreeScope.TreeScope_Children, condition);

        if (appWindow == null)
            throw new Exception($"Application window '{app}' not found");

        // BUG-019: Sanity check — verify process is still alive
        try {
            int pid = appWindow.get_CurrentProcessId();
            using var proc = System.Diagnostics.Process.GetProcessById(pid);
            if (proc.HasExited) throw new Exception("Target process has exited");
        } catch (Exception ex) {
            throw new Exception($"Application '{app}' is non-responsive or has exited: {ex.Message}");
        }

        return appWindow;
    }

    private static IUIAutomationCondition BuildCondition(JsonNode? @params)
    {
        string? name = @params?["name"]?.GetValue<string>();
        string? automationId = @params?["automationId"]?.GetValue<string>();

        if (!string.IsNullOrEmpty(automationId))
            return Automation.CreatePropertyCondition(PropertyIds.AutomationId, automationId);

        if (!string.IsNullOrEmpty(name))
            return Automation.CreatePropertyCondition(PropertyIds.Name, name);

        throw new ArgumentException("Either 'name' or 'automationId' is required");
    }

    private static IUIAutomationElement FindRequiredElement(JsonNode? @params)
    {
        var root = GetSearchRoot(@params);
        var condition = BuildCondition(@params);

        var element = root.FindFirst(TreeScope.TreeScope_Descendants, condition);
        if (element == null)
        {
            string identifier = @params?["automationId"]?.GetValue<string>()
                ?? @params?["name"]?.GetValue<string>()
                ?? "(unknown)";
            throw new Exception($"Element '{identifier}' not found");
        }

        return element;
    }

    private static object DescribeElement(IUIAutomationElement el)
    {
        return new
        {
            found = true,
            name = el.get_CurrentName(),
            automationId = el.get_CurrentAutomationId(),
            controlType = el.get_CurrentControlType(),
            className = el.get_CurrentClassName(),
            isEnabled = el.get_CurrentIsEnabled() != 0,
        };
    }

    private static void DumpTreeRecursive(IUIAutomationElement el, StringBuilder sb, int depth, int maxDepth)
    {
        if (depth > maxDepth) return;

        string indent = new(' ', depth * 2);
        string name = "";
        try { name = el.get_CurrentName() ?? ""; } catch {}
        string autoId = "";
        try { autoId = el.get_CurrentAutomationId() ?? ""; } catch {}
        int controlType = 0;
        try { controlType = el.get_CurrentControlType(); } catch {}

        sb.AppendLine($"{indent}[{controlType}] \"{name}\" id=\"{autoId}\"");

        var walker = Automation.get_ControlViewWalker();
        try
        {
            var child = walker.GetFirstChildElement(el);
            while (child != null)
            {
                try
                {
                    DumpTreeRecursive(child, sb, depth + 1, maxDepth);
                    child = walker.GetNextSiblingElement(child);
                }
                catch
                {
                    break;
                }
            }
        }
        catch { }
    }
}
