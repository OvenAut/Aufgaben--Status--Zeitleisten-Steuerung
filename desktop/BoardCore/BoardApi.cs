using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ProjektStatusBoard.Core;

public sealed record ApiResponse(int Status, string ContentType, byte[] Body)
{
    public string ReasonPhrase => Status switch
    {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Internal Server Error"
    };
}

/// <summary>
/// Die Schnittstelle /api/... der Web-Oberfläche – gleiche Adressen und Antworten wie der Node-Server.
/// Unabhängig vom Transport: die WPF-App ruft sie aus WebView2 heraus auf, der Test-Host über HTTP.
/// </summary>
public sealed class BoardApi(BoardStore store)
{
    public const string AppName = "Projekt-Status-Board";
    public const int MaxBody = 20 * 1024 * 1024;

    public static string AppVersion =>
        typeof(BoardApi).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "1.0.0";

    private static readonly JsonSerializerOptions ResponseJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public BoardStore Store => store;

    /// <param name="path">z. B. /api/projects/Hauptprojekt/tasks (noch URL-kodiert)</param>
    /// <param name="query">Query-String ohne "?" (darf leer sein)</param>
    public ApiResponse Handle(string method, string path, string? query, byte[]? body)
    {
        try
        {
            return Route(method.ToUpperInvariant(), path, ParseQuery(query), body ?? []);
        }
        catch (Exception ex)
        {
            return Json(500, new JsonObject { ["error"] = ex.Message });
        }
    }

    private ApiResponse Route(string method, string path, Dictionary<string, string> query, byte[] body)
    {
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.UnescapeDataString).ToArray(); // ["api", ...]
        if (parts.Length < 2 || parts[0] != "api") return NotFound();

        if (parts[1] == "health")
        {
            return Json(200, new JsonObject { ["ok"] = true, ["app"] = AppName, ["version"] = AppVersion, ["dataDir"] = store.DataDir });
        }
        if (parts[1] != "projects") return NotFound();

        if (parts.Length == 2 && method == "GET") return Json(200, store.ListProjects());

        if (parts.Length == 3 && method == "DELETE")
        {
            var target = store.DeleteProject(parts[2]);
            return target is null
                ? Json(404, new JsonObject { ["error"] = "Projekt nicht gefunden" })
                : Json(200, new JsonObject { ["ok"] = true, ["trash"] = Path.GetRelativePath(store.DataDir, target) });
        }

        if (parts.Length != 4) return NotFound();
        var project = parts[2];
        if (project == BoardStore.TrashDirName) return Json(400, new JsonObject { ["error"] = "Dieser Projektname ist reserviert" });

        switch (parts[3], method)
        {
            case ("tasks", "GET"):
            {
                var tasks = store.ReadTasks(project);
                return Json(200, new JsonObject
                {
                    ["project"] = project,
                    ["exists"] = tasks is not null,
                    ["firstStart"] = tasks is null && store.IsFirstStart(),
                    ["tasks"] = tasks ?? []
                });
            }
            case ("tasks", "PUT"):
            {
                if (body.Length > MaxBody) return Json(413, new JsonObject { ["error"] = "Anfrage zu groß" });
                JsonNode? parsed;
                try
                {
                    parsed = JsonNode.Parse(body);
                }
                catch (JsonException)
                {
                    return Json(400, new JsonObject { ["error"] = "Ungültiges JSON" });
                }
                if (parsed is not JsonArray tasks || tasks.Any(t => t is not JsonObject o || o["id"] is null))
                {
                    return Json(400, new JsonObject { ["error"] = "Erwartet wird eine Liste von Aufgaben mit \"id\"" });
                }
                query.TryGetValue("reason", out var reason);
                var (saved, logged) = store.SaveTasks(project, tasks, reason);
                return Json(200, new JsonObject { ["tasks"] = saved.DeepClone(), ["logged"] = logged });
            }
            case ("history", "GET"):
                query.TryGetValue("from", out var from);
                query.TryGetValue("to", out var to);
                return Json(200, store.ReadHistory(project, from, to));
        }
        return NotFound();
    }

    private static ApiResponse NotFound() => Json(404, new JsonObject { ["error"] = "Unbekannte API-Adresse" });

    private static ApiResponse Json(int status, JsonNode node) =>
        new(status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(node.ToJsonString(ResponseJson)));

    private static Dictionary<string, string> ParseQuery(string? query)
    {
        var result = new Dictionary<string, string>();
        if (string.IsNullOrEmpty(query)) return result;
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var i = pair.IndexOf('=');
            var key = Uri.UnescapeDataString((i < 0 ? pair : pair[..i]).Replace('+', ' '));
            var value = i < 0 ? "" : Uri.UnescapeDataString(pair[(i + 1)..].Replace('+', ' '));
            result[key] = value;
        }
        return result;
    }

    // ------------------------------------------------------------------
    // statische Dateien der Web-Oberfläche
    // ------------------------------------------------------------------

    public const string StartPage = "projekt_status_aufgaben_board.html";

    public static string MimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".txt" or "" => "text/plain; charset=utf-8",
        ".md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream"
    };

    /// <summary>URL-Pfad → relativer Dateipfad in public/ ("/" → Startseite); null bei unzulässigem Pfad.</summary>
    public static string? StaticPath(string urlPath)
    {
        var rel = Uri.UnescapeDataString(urlPath).TrimStart('/');
        if (rel.Length == 0) rel = StartPage;
        if (rel.Split('/').Any(seg => seg is ".." or ".") || rel.Contains('\\')) return null;
        return rel;
    }
}
