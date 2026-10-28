# Protección de la rama `main`

## Regla recomendada (ruleset)

Settings → Rules → Rulesets → New branch ruleset, aplicado a `main`:

- **Restrict deletions** y **Block force pushes**.
- **Require a pull request before merging**, con 0 aprobaciones obligatorias (el proyecto lo mantiene una sola persona).
- **Require status checks to pass**, con estos checks:
  - `Lint, tipos y pruebas`
  - `Mensajes de commit`
  - `Semgrep (análisis estático)`
  - `gitleaks (secretos)`
  - `OSV-Scanner (dependencias vulnerables)`
- **Require linear history** desactivado: los PRs se fusionan con merge commit para conservar un commit por subtarea.

## Limitación del plan gratuito

En repositorios **privados** de cuentas personales, los rulesets y la protección de ramas solo se aplican con GitHub Pro (gratis con el GitHub Student Developer Pack). En el plan gratuito quedan dos opciones:

1. Hacer el repositorio público: la regla se aplica y además se habilitan CodeQL y secret scanning sin costo.
2. Mantenerlo privado y confiar en el flujo: todo cambio entra por PR y solo se fusiona con el CI en verde.

## Herramientas de seguridad en CI

| Herramienta | Qué detecta | Cuándo |
| --- | --- | --- |
| Semgrep CE | Patrones inseguros en TypeScript y en los workflows | Cada PR, `main` y lunes |
| gitleaks | Tokens, llaves y contraseñas en commits | Cada PR (solo commits nuevos), `main` y lunes (todo el historial) |
| OSV-Scanner | Dependencias con vulnerabilidades conocidas | Cada PR, `main` y lunes |
| Dependabot | Actualizaciones de dependencias y acciones, con 14 días de espera | Lunes |
