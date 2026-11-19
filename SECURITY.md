# Política de seguridad

## Reportar una vulnerabilidad

Repórtala de forma privada en
[GitHub Security Advisories](https://github.com/Juan-Carlos-Estevez-Vargas/lukas/security/advisories/new).
No abras un issue público.

Incluye qué encontraste, cómo reproducirlo y el impacto que ves. Respondemos en un máximo de
5 días hábiles y te avisamos cuando haya corrección. Pedimos no publicar detalles hasta 90 días
después del reporte o hasta que salga la corrección, lo que pase primero.

## Alcance

- La API (`apps/api`), la app (`apps/mobile`) y los paquetes de este repositorio.
- Fuera de alcance: ataques de denegación de servicio volumétricos, ingeniería social y
  hallazgos en servicios de terceros (Cloudflare, Neon, Expo) que no dependan de nuestra
  configuración.

## Versiones con soporte

Solo la última versión publicada de la API y de la app recibe correcciones de seguridad.

## Cómo protegemos los datos

El modelo de amenazas está en [docs/security/modelo-de-amenazas.md](docs/security/modelo-de-amenazas.md).
Lukas nunca pide ni guarda números de tarjeta, CVV ni credenciales bancarias.
