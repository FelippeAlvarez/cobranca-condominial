# Servidor estático só para testes de desenvolvimento (http://localhost:8766)
param([int]$Porta = 8768)
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\app'))
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Porta/")
$l.Start()
Write-Host "Servindo $raiz em http://localhost:$Porta/"
$tipos = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.svg'='image/svg+xml'; '.json'='application/json' }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $p) { $p = 'index.html' }
  $f = [IO.Path]::GetFullPath((Join-Path $raiz $p))
  if ($c.Request.HttpMethod -eq "POST") {
    $saida = Join-Path $PSScriptRoot "saida"; [void][IO.Directory]::CreateDirectory($saida)
    $ms = New-Object IO.MemoryStream; $c.Request.InputStream.CopyTo($ms)
    [IO.File]::WriteAllBytes((Join-Path $saida ([IO.Path]::GetFileName($p))), $ms.ToArray())
    $c.Response.Close(); continue
  }
  if ($f.StartsWith($raiz) -and [IO.File]::Exists($f)) {
    $b = [IO.File]::ReadAllBytes($f)
    $t = $tipos[[IO.Path]::GetExtension($f)]; if (-not $t) { $t = 'application/octet-stream' }
    $c.Response.ContentType = $t
    $c.Response.Headers['Cache-Control'] = 'no-store'
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
