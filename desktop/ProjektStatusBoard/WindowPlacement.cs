using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;

namespace ProjektStatusBoard;

/// <summary>Fenstergröße und -position merken (%LOCALAPPDATA%\Projekt-Status-Board\fenster.json).</summary>
internal static class WindowPlacement
{
    private sealed record Placement(double Left, double Top, double Width, double Height, bool Maximized);

    private static string FilePath => Path.Combine(App.LocalAppDir, "fenster.json");

    public static void Restore(Window window)
    {
        try
        {
            if (!File.Exists(FilePath)) return;
            var p = JsonSerializer.Deserialize<Placement>(File.ReadAllText(FilePath));
            if (p is null || p.Width < 400 || p.Height < 300) return;
            // nur übernehmen, wenn das Fenster auf dem aktuellen Bildschirmbereich sichtbar bleibt
            var visible = p.Left + 100 < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth &&
                          p.Top + 50 < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight &&
                          p.Left + p.Width - 100 > SystemParameters.VirtualScreenLeft &&
                          p.Top >= SystemParameters.VirtualScreenTop - 10;
            if (!visible) return;
            window.WindowStartupLocation = WindowStartupLocation.Manual;
            window.Left = p.Left;
            window.Top = p.Top;
            window.Width = p.Width;
            window.Height = p.Height;
            if (p.Maximized) window.WindowState = WindowState.Maximized;
        }
        catch (Exception)
        {
            // ungültige Datei ignorieren
        }
    }

    public static void Save(Window window)
    {
        try
        {
            var bounds = window.WindowState == WindowState.Normal ? new Rect(window.Left, window.Top, window.Width, window.Height) : window.RestoreBounds;
            var p = new Placement(bounds.Left, bounds.Top, bounds.Width, bounds.Height, window.WindowState == WindowState.Maximized);
            Directory.CreateDirectory(App.LocalAppDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(p));
        }
        catch (Exception)
        {
            // nicht kritisch
        }
    }

    // dunkle Titelleiste passend zum Dunkelmodus der Oberfläche (Windows 10 20H1+ / Windows 11)
    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    public static void SetDarkTitleBar(Window window, bool dark)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        var value = dark ? 1 : 0;
        const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref value, sizeof(int));
    }
}
