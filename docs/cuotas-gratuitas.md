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
| Expo Push | Resumen semanal de los domingos (`/v1/notifications/device`; sale con el cron diario) | Gratis y sin cupo publicado; Expo pide no pasar de 600 avisos por segundo | https://expo.dev → Push notifications | Un aviso por teléfono a la semana: lejos de cualquier límite |
| Cron Triggers | TRM diaria en staging y producción (13:00 UTC) y, los domingos, el resumen semanal en el mismo cron; las previews no tienen cron | 5 cron triggers por cuenta en el plan Free | Panel → Workers → `lukas-api` → Settings → Triggers | No agregar crons por entorno; juntar tareas en el mismo |
| datos.gov.co (Socrata) | TRM histórica, una consulta al día más las de respaldo | Consultas anónimas con límite por IP | — | Agregar un app token gratuito de Socrata como secreto |
| Workers AI | Asistente de Lukas (`/v1/agent/chat`, Llama 3.3 70B) lectura de recibos (`/v1/agent/receipt`, Gemma 4 con visión) y búsqueda por significado (`/v1/agent/search`, embeddings bge-m3) por la API compatible con OpenAI | 10 000 neuronas al día por cuenta en el plan Free (unas 200 conversaciones cortas); además, la API limita a 20 000 tokens y 40 mensajes por persona al día (`app.ai_usage`) | Panel → AI → Workers AI → Usage | Bajar la cuota por persona o usar un modelo más pequeño con `AI_MODEL`, `AI_VISION_MODEL` o `AI_EMBEDDING_MODEL`; nunca pasar a pago sin aprobación |
| Turnstile | Captcha antes de enviar el código | Sin límite práctico en el plan Free | Panel → Turnstile | — |

## Alertas

- **Cloudflare:** Notifications → Add → *Workers usage* para avisar al 80 % del límite diario.
- **Neon:** Settings → Billing muestra el consumo; el plan Free suspende el cómputo al agotarlo,
  no cobra.
- **GitHub:** Settings → Billing → Spending limit en 0 USD (valor por defecto) evita cobros.

Ningún servicio cobra automáticamente en su plan gratuito: al llegar al límite se detiene o
limita. Pasar a un plan pago requiere aprobación del dueño.
