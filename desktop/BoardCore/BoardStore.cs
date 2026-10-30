using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ProjektStatusBoard.Core;

/// <summary>
/// Datenablage des Boards – gleiches Format wie der Node-Server (server/server.js):
/// daten/&lt;Projekt&gt;/tasks.json, history.jsonl (Änderungsprotokoll), backups/tasks_JJJJ-MM-TT.json,
/// gelöschte Projekte unter daten/_papierkorb/&lt;Projekt&gt;_&lt;Zeitpunkt&gt;.
/// </summary>
public sealed class BoardStore
{
    public const string DefaultProject = "Hauptprojekt";
    public const string TrashDirName = "_papierkorb";

    // reine Verwaltungsfelder – werden nicht als inhaltliche Änderung protokolliert
    private static readonly HashSet<string> UntrackedFields =
        ["updatedAt", "createdAt", "statusChangedAt", "doneAt", "blockedSince", "prevStatus"];

    private static readonly JsonSerializerOptions FileJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping // Umlaute lesbar speichern
    };

    private static readonly JsonSerializerOptions LineJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly object _lock = new();
    private readonly Func<DateTime> _clock;

    public string DataDir { get; }

    public BoardStore(string dataDir, Func<DateTime>? clock = null)
    {
        DataDir = Path.GetFullPath(dataDir);
        _clock = clock ?? (() => DateTime.UtcNow);
        Directory.CreateDirectory(DataDir);
    }

    // ------------------------------------------------------------------
    // Datenordner bestimmen
    // ------------------------------------------------------------------

    /// <summary>
    /// Standard: Ordner "daten" neben dem Programm. Ist der nicht beschreibbar (z. B. C:\Programme),
    /// wird %APPDATA%\Projekt-Status-Board\daten verwendet.
    /// </summary>
    public static string ResolveDataDir(string baseDir, string? explicitDir = null)
    {
        if (!string.IsNullOrWhiteSpace(explicitDir)) return Path.GetFullPath(explicitDir);
        var preferred = Path.Combine(baseDir, "daten");
        try
        {
            Directory.CreateDirectory(preferred);
            var probe = Path.Combine(preferred, $".schreibtest_{Environment.ProcessId}");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return preferred;
        }
        catch (Exception)
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData)) appData = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(appData, "Projekt-Status-Board", "daten");
        }
    }

    // ------------------------------------------------------------------
    // Hilfen
    // ------------------------------------------------------------------

    private string NowIso() => _clock().ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private string LocalDay() => _clock().ToLocalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string LocalDayOf(string iso) =>
        DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var utc)
            ? utc.ToLocalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : "";

    /// <summary>Projektnamen auf einen sicheren Ordnernamen abbilden (wie im Node-Server).</summary>
    public static string SafeProjectName(string? name)
    {
        var raw = (name ?? DefaultProject).Trim();
        var sb = new StringBuilder(raw.Length);
        foreach (var c in raw) sb.Append(c < 0x20 || "<>:\"/\\|?*".Contains(c) ? '_' : c);
        var safe = sb.ToString();
        var dots = 0;
        while (dots < safe.Length && safe[dots] == '.') dots++;
        if (dots > 0) safe = "_" + safe[dots..];
        if (safe.Length > 120) safe = safe[..120];
        return safe.Length == 0 ? DefaultProject : safe;
    }

    private string ProjectDir(string project) => Path.Combine(DataDir, SafeProjectName(project));

    private static void WriteFileAtomic(string file, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var tmp = $"{file}.{Environment.ProcessId}.tmp";
        File.WriteAllText(tmp, content, new UTF8Encoding(false));
        File.Move(tmp, file, overwrite: true);
    }

    // null/fehlend und "" gelten als gleich (wie JSON.stringify(a ?? '') im Node-Server)
    private static bool SameValue(JsonNode? a, JsonNode? b) =>
        JsonNode.DeepEquals(a ?? JsonValue.Create(""), b ?? JsonValue.Create(""));

    private static string? StringOf(JsonObject task, string field) =>
        task[field] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    // ------------------------------------------------------------------
    // Lesen
    // ------------------------------------------------------------------

    public JsonArray? ReadTasks(string project)
    {
        var file = Path.Combine(ProjectDir(project), "tasks.json");
        try
        {
            return JsonNode.Parse(File.ReadAllText(file)) as JsonArray ?? [];
        }
        catch (Exception)
        {
            return null;
        }
    }

    public JsonArray ListProjects()
    {
        var result = new List<(string Name, int Count, DateTime Modified)>();
        if (Directory.Exists(DataDir))
        {
            foreach (var dir in Directory.GetDirectories(DataDir))
            {
                var name = Path.GetFileName(dir);
                var file = Path.Combine(dir, "tasks.json");
                if (name == TrashDirName || !File.Exists(file)) continue;
                result.Add((name, ReadTasks(name)?.Count ?? 0, File.GetLastWriteTimeUtc(file)));
            }
        }
        var array = new JsonArray();
        foreach (var p in result.OrderBy(p => p.Name, StringComparer.Create(CultureInfo.GetCultureInfo("de-DE"), true)))
        {
            array.Add(new JsonObject
            {
                ["name"] = p.Name,
                ["tasks"] = p.Count,
                ["updatedAt"] = p.Modified.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)
            });
        }
        return array;
    }

    /// <summary>Erster Start: noch nie ein Projekt angelegt oder gelöscht → Hauptprojekt mit Demodaten.</summary>
    public bool IsFirstStart() =>
        ListProjects().Count == 0 && !Directory.Exists(Path.Combine(DataDir, TrashDirName));

    public JsonArray ReadHistory(string project, string? from, string? to)
    {
        var result = new JsonArray();
        var file = Path.Combine(ProjectDir(project), "history.jsonl");
        if (!File.Exists(file)) return result;
        foreach (var line in File.ReadLines(file))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                if (JsonNode.Parse(line) is not JsonObject entry) continue;
                var day = LocalDayOf(StringOf(entry, "ts") ?? "");
                if ((string.IsNullOrEmpty(from) || string.CompareOrdinal(day, from) >= 0) &&
                    (string.IsNullOrEmpty(to) || string.CompareOrdinal(day, to) <= 0))
                {
                    result.Add(entry);
                }
            }
            catch (JsonException)
            {
                // defekte Zeile überspringen
            }
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Schreiben
    // ------------------------------------------------------------------

    /// <summary>
    /// Vergleicht alten und neuen Stand, setzt Zeitstempel (Programmzeit) und liefert die Protokolleinträge.
    /// reason "import"/"reset": nur "importiert" protokollieren, keine Zeitstempel erfinden.
    /// </summary>
    internal List<JsonObject> DiffAndStamp(JsonArray oldTasks, JsonArray newTasks, string nowIso, string? reason)
    {
        var bulk = reason is "import" or "reset";
        var oldById = new Dictionary<string, JsonObject>();
        foreach (var node in oldTasks)
        {
            if (node is JsonObject o && StringOf(o, "id") is { } id) oldById.TryAdd(id, o);
        }
        var newIds = new HashSet<string>();
        var entries = new List<JsonObject>();

        foreach (var node in newTasks)
        {
            if (node is not JsonObject t) continue;
            var id = StringOf(t, "id") ?? "";
            newIds.Add(id);
            oldById.TryGetValue(id, out var before);

            if (before is null || (bulk && StringOf(before, "title") != StringOf(t, "title")))
            {
                // neu – oder beim Import eine andere Aufgabe mit zufällig gleicher ID
                if (!bulk)
                {
                    if (string.IsNullOrEmpty(StringOf(t, "createdAt"))) t["createdAt"] = nowIso;
                    if (string.IsNullOrEmpty(StringOf(t, "statusChangedAt"))) t["statusChangedAt"] = nowIso;
                    if (StringOf(t, "status") == "Erledigt" && string.IsNullOrEmpty(StringOf(t, "doneAt"))) t["doneAt"] = nowIso;
                    if (StringOf(t, "status") == "Blockiert" && string.IsNullOrEmpty(StringOf(t, "blockedSince"))) t["blockedSince"] = nowIso;
                }
                t["updatedAt"] = nowIso;
                entries.Add(Entry(nowIso, t, bulk ? "importiert" : "erstellt",
                    [new JsonObject { ["field"] = "status", ["from"] = null, ["to"] = t["status"]?.DeepClone() }]));
                continue;
            }

            // vom Programm vergebene Zeitstempel bleiben erhalten, auch wenn die Oberfläche sie nicht mitschickt
            foreach (var field in UntrackedFields)
            {
                if (!t.ContainsKey(field) && before.ContainsKey(field)) t[field] = before[field]?.DeepClone();
            }

            var changes = new JsonArray();
            var fields = new List<string>();
            foreach (var kv in before) fields.Add(kv.Key);
            foreach (var kv in t) if (!fields.Contains(kv.Key)) fields.Add(kv.Key);
            foreach (var field in fields)
            {
                if (UntrackedFields.Contains(field)) continue;
                if (!SameValue(before[field], t[field]))
                {
                    changes.Add(new JsonObject
                    {
                        ["field"] = field,
                        ["from"] = before[field]?.DeepClone(),
                        ["to"] = t[field]?.DeepClone()
                    });
                }
            }
            if (changes.Count == 0) continue;
            if (bulk)
            {
                entries.Add(Entry(nowIso, t, "importiert", []));
                continue;
            }

            t["updatedAt"] = nowIso;
            if (changes.Any(c => c?["field"]?.GetValue<string>() == "status"))
            {
                // Statuswechsel immer mit Programmzeit festhalten
                var status = StringOf(t, "status");
                var prev = StringOf(before, "status");
                t["prevStatus"] = prev ?? "";
                t["statusChangedAt"] = nowIso;
                t["doneAt"] = status == "Erledigt" ? (prev == "Erledigt" ? before["doneAt"]?.DeepClone() : nowIso) : "";
                t["blockedSince"] = status == "Blockiert" ? (prev == "Blockiert" ? before["blockedSince"]?.DeepClone() : nowIso) : "";
            }
            entries.Add(Entry(nowIso, t, "geändert", changes));
        }

        foreach (var (id, task) in oldById)
        {
            if (!newIds.Contains(id)) entries.Add(Entry(nowIso, task, "gelöscht", []));
        }
        return entries;
    }

    private static JsonObject Entry(string ts, JsonObject task, string action, JsonArray changes) => new()
    {
        ["ts"] = ts,
        ["taskId"] = task["id"]?.DeepClone(),
        ["title"] = task["title"]?.DeepClone(),
        ["action"] = action,
        ["changes"] = changes
    };

    public (JsonArray Tasks, int Logged) SaveTasks(string project, JsonArray newTasks, string? reason = null)
    {
        lock (_lock)
        {
            var dir = ProjectDir(project);
            var oldTasks = ReadTasks(project) ?? [];
            var entries = DiffAndStamp(oldTasks, newTasks, NowIso(), reason);

            // Tagessicherung: der erste Stand des Tages bleibt erhalten
            var backup = Path.Combine(dir, "backups", $"tasks_{LocalDay()}.json");
            if (oldTasks.Count > 0 && !File.Exists(backup)) WriteFileAtomic(backup, oldTasks.ToJsonString(FileJson));

            WriteFileAtomic(Path.Combine(dir, "tasks.json"), newTasks.ToJsonString(FileJson));
            if (entries.Count > 0)
            {
                var sb = new StringBuilder();
                foreach (var e in entries) sb.Append(e.ToJsonString(LineJson)).Append('\n');
                File.AppendAllText(Path.Combine(dir, "history.jsonl"), sb.ToString(), new UTF8Encoding(false));
            }
            return (newTasks, entries.Count);
        }
    }

    /// <summary>Projekt in den Papierkorb verschieben. Liefert den Zielordner oder null, wenn es das Projekt nicht gibt.</summary>
    public string? DeleteProject(string project)
    {
        lock (_lock)
        {
            var dir = ProjectDir(project);
            var name = Path.GetFileName(dir);
            if (name == TrashDirName || !Directory.Exists(dir)) return null;
            var stamp = _clock().ToUniversalTime().ToString("yyyy-MM-dd-HH-mm-ss", CultureInfo.InvariantCulture);
            var target = Path.Combine(DataDir, TrashDirName, $"{name}_{stamp}");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            Directory.Move(dir, target);
            return target;
        }
    }
}
