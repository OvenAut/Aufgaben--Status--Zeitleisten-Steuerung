using System.IO;
using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using ProjektStatusBoard.Core;

namespace ProjektStatusBoard;

/// <summary>
/// Hauptfenster: WebView2 zeigt die Web-Oberfläche unter https://board.example/ an.
/// Diese Adresse existiert nicht im Netz – alle Anfragen beantwortet das Programm selbst:
/// statische Dateien aus den eingebetteten Ressourcen, /api/... über BoardCore.
/// </summary>
public partial class MainWindow : Window
{
    // .example ist für Beispiele reserviert (RFC 2606) und wird nie ins Internet aufgelöst
    private const string Host = "board.example";
    private const string Origin = "https://" + Host + "/";

    private readonly AppOptions _options;
    private readonly BoardApi _api;
    private readonly WebAssets _assets = new();
    private bool _closeConfirmed;
    private bool _selfTestStarted;

    public MainWindow(AppOptions options)
    {
        _options = options;
        _api = new BoardApi(new BoardStore(options.DataDir));
        InitializeComponent();
        if (options.SelfTestResult is null) WindowPlacement.Restore(this);
        Loaded += async (_, _) => await InitWebViewAsync();
    }

    public void BringToFront()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Topmost = true;  // kurz nach vorne holen, ohne dauerhaft im Vordergrund zu bleiben
        Topmost = false;
        Focus();
    }

    // ------------------------------------------------------------------
    // WebView2 einrichten
    // ------------------------------------------------------------------

    private async Task InitWebViewAsync()
    {
        try
        {
            var userData = Path.Combine(App.LocalAppDir, "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, userData);
            await Web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this,
                "Für Projekt-Status-Board wird die Microsoft Edge WebView2 Runtime benötigt.\n\n" +
                "Sie ist unter Windows 10/11 normalerweise vorinstalliert. Download:\n" +
                "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                "WebView2 fehlt", MessageBoxButton.OK, MessageBoxImage.Error);
            FinishSelfTest(false, "WebView2 Runtime fehlt");
            Close();
            return;
        }

        var core = Web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = _options.DevTools;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnWebResourceRequested;
        core.DocumentTitleChanged += (_, _) => Title = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Projekt-Status-Board" : core.DocumentTitle;
        core.PermissionRequested += OnPermissionRequested;
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.DownloadStarting += OnDownloadStarting;
        core.WebMessageReceived += OnWebMessageReceived;

        var start = Origin + (string.IsNullOrWhiteSpace(_options.Project) ? "" : "?projekt=" + Uri.EscapeDataString(_options.Project));
        core.Navigate(start);
    }

    // ------------------------------------------------------------------
    // Anfragen der Oberfläche beantworten
    // ------------------------------------------------------------------

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var env = Web.CoreWebView2.Environment;
        var uri = new Uri(e.Request.Uri);

        if (uri.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal))
        {
            byte[] body = [];
            if (e.Request.Content is { } content)
            {
                using var ms = new MemoryStream();
                content.CopyTo(ms);
                body = ms.ToArray();
            }
            var r = _api.Handle(e.Request.Method, uri.AbsolutePath, uri.Query, body);
            e.Response = env.CreateWebResourceResponse(new MemoryStream(r.Body), r.Status, r.ReasonPhrase,
                $"Content-Type: {r.ContentType}\r\nCache-Control: no-store");
            return;
        }

        var rel = BoardApi.StaticPath(uri.AbsolutePath);
        var stream = rel is null ? null : _assets.Open(rel);
        e.Response = stream is null
            ? env.CreateWebResourceResponse(new MemoryStream("Nicht gefunden"u8.ToArray()), 404, "Not Found", "Content-Type: text/plain; charset=utf-8")
            : env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {BoardApi.MimeType(rel!)}\r\nCache-Control: no-cache");
    }

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        // Zwischenablage für "KI-Korrektur" (Antwort der KI einlesen) ohne Rückfrage erlauben
        if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead && e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase))
        {
            e.State = CoreWebView2PermissionState.Allow;
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // nur die eigene Oberfläche im Fenster – alles andere im Standardbrowser öffnen
        if (e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return;
        e.Cancel = true;
        OpenExternal(e.Uri);
    }

    private static void OpenExternal(string uri)
    {
        if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // kein Standardbrowser – ignorieren
        }
    }

    // Exporte (JSON, CSV, Berichte) mit Windows-Speichern-Dialog statt stillem Download
    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var deferral = e.GetDeferral();
        Dispatcher.BeginInvoke(() =>
        {
            using (deferral)
            {
                var suggested = Path.GetFileName(e.ResultFilePath);
                var ext = Path.GetExtension(suggested).ToLowerInvariant();
                var dialog = new SaveFileDialog
                {
                    FileName = suggested,
                    InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    Filter = ext switch
                    {
                        ".json" => "JSON-Datei (*.json)|*.json|Alle Dateien (*.*)|*.*",
                        ".csv" => "CSV-Datei (*.csv)|*.csv|Alle Dateien (*.*)|*.*",
                        ".md" => "Markdown (*.md)|*.md|Alle Dateien (*.*)|*.*",
                        _ => "Alle Dateien (*.*)|*.*"
                    }
                };
                if (dialog.ShowDialog(this) == true)
                {
                    e.ResultFilePath = dialog.FileName;
                    e.Handled = true; // keine Download-Leiste
                }
                else
                {
                    e.Cancel = true;
                }
            }
        });
    }

    // Nachrichten der Oberfläche (window.chrome.webview.postMessage)
    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var msg = JsonNode.Parse(e.WebMessageAsJson);
            if (msg?["type"]?.GetValue<string>() == "theme")
            {
                var dark = msg["dark"]?.GetValue<bool>() ?? false;
                WindowPlacement.SetDarkTitleBar(this, dark);
                Background = dark ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(3, 7, 18)) : System.Windows.Media.Brushes.White;
            }
        }
        catch (Exception)
        {
            // unbekannte Nachricht ignorieren
        }
    }

    private async void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingText.Visibility = Visibility.Collapsed;
        if (!e.IsSuccess)
        {
            FinishSelfTest(false, $"Navigation fehlgeschlagen: {e.WebErrorStatus}");
            return;
        }
        if (_options.SelfTestResult is not null && !_selfTestStarted)
        {
            _selfTestStarted = true;
            await RunSelfTestAsync();
        }
    }

    // ------------------------------------------------------------------
    // Schließen: offene Speicherungen abwarten, Fensterposition merken
    // ------------------------------------------------------------------

    protected override async void OnClosing(CancelEventArgs e)
    {
        if (_closeConfirmed || Web.CoreWebView2 is null)
        {
            if (_options.SelfTestResult is null) WindowPlacement.Save(this);
            base.OnClosing(e);
            return;
        }
        e.Cancel = true;
        try
        {
            for (var i = 0; i < 30; i++)
            {
                var busy = await Web.CoreWebView2.ExecuteScriptAsync(
                    "typeof serverSaveInFlight !== 'undefined' && (serverSaveInFlight || serverSavePending)");
                if (busy != "true") break;
                await Task.Delay(100);
            }
        }
        catch (Exception)
        {
            // Seite nicht bereit – trotzdem schließen
        }
        _closeConfirmed = true;
        Close();
    }

    // ------------------------------------------------------------------
    // Selbsttest (--selftest <Datei>): Oberfläche laden, Aufgabe speichern, Datei prüfen
    // ------------------------------------------------------------------

    private async Task RunSelfTestAsync()
    {
        var result = new JsonObject();
        try
        {
            await Task.Delay(2500);
            var page = await Web.CoreWebView2.ExecuteScriptAsync(
                "JSON.stringify({ loaded: typeof loadTasks === 'function', server: SERVER_MODE, project: currentWorkspace.projectName, " +
                "tasks: tasks.length, icons: document.querySelectorAll('symbol').length, css: getComputedStyle(document.body).display })");
            result["page"] = JsonNode.Parse(JsonSerializer.Deserialize<string>(page)!);

            await Web.CoreWebView2.ExecuteScriptAsync(
                "tasks.push(normalizeTask({ id: 'selbsttest', title: 'Selbsttest', status: 'Offen', startDate: '2026-01-01', endDate: '2026-01-02' })); saveTasks();");
            await Task.Delay(1500);

            var tasksFile = Path.Combine(_options.DataDir, BoardStore.SafeProjectName(_options.Project ?? BoardStore.DefaultProject), "tasks.json");
            var saved = File.Exists(tasksFile) && File.ReadAllText(tasksFile, Encoding.UTF8).Contains("\"selbsttest\"");
            var history = Path.Combine(Path.GetDirectoryName(tasksFile)!, "history.jsonl");
            result["savedToDisk"] = saved;
            result["historyWritten"] = File.Exists(history) && File.ReadAllText(history).Contains("\"selbsttest\"");
            result["assets"] = _assets.Count;
            result["dataDir"] = _options.DataDir;

            var p = result["page"]!;
            var ok = p["loaded"]?.GetValue<bool>() == true && p["server"]?.GetValue<bool>() == true &&
                     p["icons"]?.GetValue<int>() > 0 && saved && result["historyWritten"]!.GetValue<bool>();
            FinishSelfTest(ok, null, result);
        }
        catch (Exception ex)
        {
            FinishSelfTest(false, ex.ToString(), result);
        }
    }

    private void FinishSelfTest(bool ok, string? error, JsonObject? details = null)
    {
        if (_options.SelfTestResult is null) return;
        details ??= new JsonObject();
        details["ok"] = ok;
        if (error is not null) details["error"] = error;
        File.WriteAllText(_options.SelfTestResult, details.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        _closeConfirmed = true;
        Application.Current.Shutdown(ok ? 0 : 1);
    }
}
