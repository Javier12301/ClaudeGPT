# Wrapper para daniel3303/ClaudeCodeStatusLine.
#
# El script upstream formatea horas y montos con la cultura del sistema. En un
# Windows en español eso produce "11:00 p. m." (con espacio duro U+00A0),
# "sáb ago 22" y "$31,66" — y PowerShell 5.1 los emite en el codepage OEM, con
# lo cual los acentos y el espacio duro salen como "?".
#
# Fijar cultura invariante + salida UTF-8 arregla las tres cosas de una, y deja
# el clon intacto para que `git pull` siga funcionando.

$ErrorActionPreference = 'Continue'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$inv = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentCulture   = $inv
[System.Threading.Thread]::CurrentThread.CurrentUICulture = $inv

$stdin = [Console]::In.ReadToEnd()
$stdin | & (Join-Path $PSScriptRoot 'statusline\statusline.ps1')
