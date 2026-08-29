# Repository Context Capsule

Leé este archivo la primera vez que trabajás en un repo, o cuando vayas a
escribir una spec y estés por explicar el entorno a mano otra vez.

## El problema que resuelve

Cada subagente arranca frío y gasta entre 20 y 40 llamadas redescubriendo lo que
vos ya sabés: cuál es el intérprete, qué runner de tests hay, dónde está el
entrypoint. En la sesión que originó esta regla, la línea *"el python del PATH no
tiene pandas, usar `./.venv/Scripts/python.exe`"* se escribió a mano **doce
veces**.

## Formato

Un archivo por repo, en `.orquestador/repo.md`, que escribís la primera vez que
trabajás ahí y **pegás textual** en el `VERIFIED REPOSITORY FACTS` de cada spec.

```yaml
repository:
  name:
  root:

environment:
  runtime:
  interpreter:          # la ruta exacta, no "python"
  package_manager:
  database:
  framework:

commands:
  targeted_tests:       # como correr UN test o UN archivo
  module_tests:         # como correr un modulo
  full_suite:           # y cuanto tarda, si es caro

baseline:
  passed:
  failed:
  measured_at:
  known_preexisting_failures:

architecture:
  relevant_entrypoints:
  relevant_modules:

gotchas:
  - el python del PATH no tiene pandas: usar ./.venv/Scripts/python.exe
```

## Reglas

- **Solo hechos verificados.** Si no lo mediste o no lo leíste del repo, no va.
  Un dato inventado acá se propaga a todas las specs siguientes, que es
  exactamente el fallo que la capsule tendría que prevenir.
- **`baseline` se re-mide cada sesión y se pisa.** Un número de baseline viejo es
  peor que no tenerlo: describe otro momento y te hace comparar contra una
  ficción. Ver la regla de baseline medido en `SKILL.md`.
- **Sin maquinaria de invalidación.** Es un archivo que leés y editás a mano
  cuando algo cambia. El resto de los campos cambia con los manifests, que es
  raro. Una cache con invalidación automática cuesta más de lo que ahorra.
- **`gotchas` es la sección que más rinde.** Cada línea ahí es un ciclo de
  delegación que no se pierde. Agregá una cada vez que un subagente tropiece con
  algo del entorno.

## Dónde vive cada cosa

| Tipo de hecho | Dónde |
|---|---|
| Estable y del proyecto (framework, base de datos, convenciones) | `AGENTS.md` / `CLAUDE.md` — Codex y Claude los leen solos |
| Operativo y reusable (comandos, intérprete, baseline, gotchas) | la capsule |
| Propio de esta tarea (contrato, alcance de archivos, criterios) | la spec, y solo ahí |
| Volátil o secreto (tokens, rutas de una sola vez, estado de una corrida) | **en ningún lado persistente** |
