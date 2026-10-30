using System.Net;
using ProjektStatusBoard.Core;

// Test-Host: liefert public/ von der Festplatte und beantwortet /api/... mit derselben BoardApi wie die WPF-App.
string? Arg(string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

var port = int.Parse(Arg("--port") ?? "3400");
var publicDir = Path.GetFullPath(Arg("--public") ?? Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "public"));
var store = new BoardStore(BoardStore.ResolveDataDir(Directory.GetCurrentDirectory(), Arg("--data")));
var api = new BoardApi(store);

using var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
listener.Start();
Console.WriteLine($"DevHost {BoardApi.AppVersion}: http://127.0.0.1:{port}/  Daten: {store.DataDir}  Web: {publicDir}");

while (true)
{
    var ctx = await listener.GetContextAsync();
    _ = Task.Run(async () =>
    {
        var req = ctx.Request;
        var res = ctx.Response;
        try
        {
            var path = req.Url!.AbsolutePath;
            if (path.StartsWith("/api/", StringComparison.Ordinal))
            {
                using var ms = new MemoryStream();
                await req.InputStream.CopyToAsync(ms);
                var r = api.Handle(req.HttpMethod, req.Url.AbsolutePath, req.Url.Query, ms.ToArray());
                await Send(res, r.Status, r.ContentType, r.Body, "no-store");
                return;
            }
            var rel = BoardApi.StaticPath(path);
            var file = rel is null ? null : Path.Combine(publicDir, rel);
            if (file is null || !File.Exists(file))
            {
                await Send(res, 404, "text/plain; charset=utf-8", "Nicht gefunden"u8.ToArray(), "no-cache");
                return;
            }
            await Send(res, 200, BoardApi.MimeType(file), await File.ReadAllBytesAsync(file), "no-cache");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            try { res.StatusCode = 500; res.Close(); } catch { }
        }
    });
}

static async Task Send(HttpListenerResponse res, int status, string contentType, byte[] body, string cache)
{
    res.StatusCode = status;
    res.ContentType = contentType;
    res.Headers["Cache-Control"] = cache;
    res.ContentLength64 = body.Length;
    await res.OutputStream.WriteAsync(body);
    res.Close();
}
