using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using ProjektStatusBoard.Core;

namespace ProjektStatusBoard;

/// <summary>Startoptionen: --data &lt;Ordner&gt; --projekt &lt;Name&gt; --devtools --selftest &lt;Ergebnisdatei&gt;</summary>
public sealed record AppOptions(string DataDir, string? Project, bool DevTools, string? SelfTestResult)
{
    public static AppOptions Parse(string[] args)
    {
        string? Arg(string name)
        {
            var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
        var dataDir = BoardStore.ResolveDataDir(AppContext.BaseDirectory, Arg("--data"));
        return new AppOptions(dataDir, Arg("--projekt"), args.Contains("--devtools", StringComparer.OrdinalIgnoreCase), Arg("--selftest"));
    }
}

public partial class App : Application
{
    private Mutex? _instanceMutex;
    private EventWaitHandle? _activateSignal;

    public static string LocalAppDir { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Projekt-Status-Board");

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var options = AppOptions.Parse(e.Args);

        // nur eine Instanz pro Datenordner – sonst würden zwei Fenster dieselben Dateien überschreiben
        if (options.SelfTestResult is null)
        {
            var key = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(options.DataDir.ToLowerInvariant())))[..16];
            _instanceMutex = new Mutex(true, $"ProjektStatusBoard_{key}", out var isFirst);
            _activateSignal = new EventWaitHandle(false, EventResetMode.AutoReset, $"ProjektStatusBoard_{key}_aktivieren");
            if (!isFirst)
            {
                _activateSignal.Set(); // laufendes Fenster nach vorne holen
                Shutdown();
                return;
            }
            var signal = _activateSignal;
            new Thread(() =>
            {
                while (signal.WaitOne())
                {
                    Dispatcher.BeginInvoke(() => (MainWindow as MainWindow)?.BringToFront());
                }
            }) { IsBackground = true, Name = "Aktivierung" }.Start();
        }

        var window = new MainWindow(options);
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instanceMutex?.Dispose();
        base.OnExit(e);
    }
}
