using System.IO;
using System.Reflection;

namespace ProjektStatusBoard;

/// <summary>Die eingebettete Web-Oberfläche (public/**), abgelegt als Ressourcen "web/&lt;Pfad&gt;".</summary>
public sealed class WebAssets
{
    private readonly Assembly _assembly = typeof(WebAssets).Assembly;
    private readonly Dictionary<string, string> _resources = new(StringComparer.OrdinalIgnoreCase);

    public WebAssets()
    {
        foreach (var name in _assembly.GetManifestResourceNames())
        {
            // beim Bauen unter Windows enthält der Name Backslashes – auf URL-Pfade vereinheitlichen
            var normalized = name.Replace('\\', '/');
            if (normalized.StartsWith("web/", StringComparison.Ordinal)) _resources[normalized[4..]] = name;
        }
    }

    public int Count => _resources.Count;

    public Stream? Open(string relativePath) =>
        _resources.TryGetValue(relativePath, out var name) ? _assembly.GetManifestResourceStream(name) : null;
}
