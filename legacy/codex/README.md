# Orquestador para Codex

Entorno multiagente Codex-native en el que GPT-5.6 Sol actúa como Tech Lead y delega trabajo técnico a agentes Terra y Luna.

## Uso rápido

Instalación global desde PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
.\verify.ps1 -Global
```

Reiniciá Codex. Después, desde cualquier repositorio:

```powershell
codex
```

Podés pedir directamente:

```text
Implementá esta validación.
Revisá completamente este proyecto.
```

Para forzar el workflow:

```text
Usá $constructor para implementar esta validación.
Usá $revisor-completo para revisar todo el proyecto.
```

## Arquitectura

- Sol Medium: intención, decisiones, especificaciones, routing y revisión final.
- Terra Medium: exploración, TDD, implementación y navegador.
- Terra High: correctness y security review.
- Luna Medium/Low: documentación y verificación mecánica.
- Máximo cuatro subagentes concurrentes; sólo Sol puede crearlos.

La configuración portable vive en `.codex/` y `.agents/`. `install.ps1` la instala globalmente sin reemplazar configuraciones ajenas.

## Dependencias

- Fija: Engram y Context7.
- Opcional: Serena y Codex Security.
- Bajo pedido: Playwright y Chrome DevTools.
- Ponytail no se instala por defecto; sus reglas mínimas están incorporadas en Tester y Constructor para evitar dependencia de hooks globales.

Consultá [INSTALL.md](INSTALL.md) para instalación, actualización, seguridad y diagnóstico.
