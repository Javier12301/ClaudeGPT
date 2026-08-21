$ErrorActionPreference = 'Stop'

try {
    $inputJson = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputJson)) {
        Write-Output '{}'
        exit 0
    }

    $eventData = $inputJson | ConvertFrom-Json
    $command = [string]$eventData.tool_input.command
    $pushPattern = '(?im)(?:^|[\s;&|])(?:git|git\.exe)\s+(?:(?:-[Cc]\s+\S+|--(?:git-dir|work-tree)(?:=|\s+)\S+)\s+)*push(?:\s|$)'

    if ($command -match $pushPattern) {
        $response = @{
            hookSpecificOutput = @{
                hookEventName = 'PreToolUse'
                permissionDecision = 'deny'
                permissionDecisionReason = 'Bloqueado por el Orquestador: publicar cambios es exclusivo del usuario.'
            }
        }
        $response | ConvertTo-Json -Depth 4 -Compress
        exit 0
    }

    Write-Output '{}'
    exit 0
}
catch {
    # Un fallo del guard no debe bloquear comandos ajenos; la rule sigue activa.
    Write-Output '{}'
    exit 0
}
