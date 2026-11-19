# Cuotas gratuitas y alertas

Lukas corre hoy solo en planes gratuitos. Este documento dice qué límite toca primero cada
servicio, dónde mirarlo y qué hacer cuando se acerque. Revisarlo en cada release y cuando lleguen
los primeros usuarios externos.

| Servicio | Lo que usamos | Límite que importa | Dónde se ve | Si se acerca |
| --- | --- | --- | --- | --- |
| Cloudflare Workers | API de staging, producción y una por PR | 100 000 solicitudes al día por cuenta y 10 ms de CPU por solicitud | Panel → Workers & Pages → Observability | Revisar rate limits; pasar a Workers Paid (5 USD/mes) con aprobación |
| Cloudflare Pages | Web de producción, staging y una rama por PR | Número de despliegues al mes del plan Free | Panel → Workers & Pages → `lukas-web` → Deployments | Juntar PRs o dejar de desplegar web en PRs de solo backend |
| Neon | Rama `main` (producción), `staging` y una por PR | 1 GiB por rama (lo reporta la API del proyecto) y horas de cómputo del plan Free | https://console.neon.tech → proyecto `lukas` → Usage | Borrar ramas huérfanas `preview/*`; revisar consultas lentas |
| GitHub Actions | CI, previews y despliegues | 2 000 minutos al mes en repos privados del plan Free | Settings → Billing → Usage | Reducir jobs de PRs o hacer el repo público |
| Expo EAS | APK de Android en cada release y actualizaciones OTA (pendiente) | Cupo mensual de builds y de usuarios de OTA del plan Free | https://expo.dev → Usage | Compilar APK solo en releases |
| Turnstile | Captcha antes de enviar el código | Sin límite práctico en el plan Free | Panel → Turnstile | — |

## Alertas

- **Cloudflare:** Notifications → Add → *Workers usage* para avisar al 80 % del límite diario.
- **Neon:** Settings → Billing muestra el consumo; el plan Free suspende el cómputo al agotarlo,
  no cobra.
- **GitHub:** Settings → Billing → Spending limit en 0 USD (valor por defecto) evita cobros.

Ningún servicio cobra automáticamente en su plan gratuito: al llegar al límite se detiene o
limita. Pasar a un plan pago requiere aprobación del dueño.
