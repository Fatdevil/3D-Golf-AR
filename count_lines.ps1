$files = Get-ChildItem -Filter '*.html'
foreach($f in $files) {
    $c = (Get-Content $f.FullName | Measure-Object -Line).Lines
    $kb = [math]::Round($f.Length/1024,1)
    Write-Host ($f.Name + ' : ' + $c + ' lines (' + $kb + ' KB)')
}
