# Beta cerrada

Guía para la beta cerrada de Lukas (FIN-408): cómo instalar la app, cómo enviar comentarios y
cómo la maneja el equipo. La meta es que 10 personas la usen durante una semana.

## Para quienes prueban

Lukas está en beta: puede tener fallas y los datos de esta etapa podrían borrarse antes del
lanzamiento. Haz una copia de seguridad (Ajustes → Copia de seguridad) si te importan.

### Android (APK)

1. Abre en el teléfono el enlace del último release que te mandamos
   (`https://github.com/Juan-Carlos-Estevez-Vargas/lukas/releases`, archivo `.apk` del release
   `@lukas/mobile@…`).
2. Descarga el archivo. Chrome puede avisar que "este tipo de archivo puede dañar el
   dispositivo": es el aviso de siempre para apps fuera de Play Store; toca **Descargar de todos
   modos**.
3. Abre el archivo descargado. La primera vez Android pide permitir la instalación desde esa app
   (Chrome o Archivos): **Configuración → Permitir de esta fuente**, y vuelve atrás.
4. Toca **Instalar**. Si Play Protect pregunta, elige **Instalar de todos modos**: la app aún no
   está en Play Store, por eso no la conoce.
5. Abre Lukas, acepta la política de datos y entra con tu correo.

Requisitos: Android 7.0 o superior. Para actualizar, instala el APK nuevo encima: tus datos se
conservan.

### iPhone o computador (web)

1. Abre en Safari (iPhone) o Chrome (Android o computador) el enlace web que te mandamos.
2. Para tenerla como app:
   - **iPhone:** botón Compartir → **Agregar a inicio**.
   - **Chrome:** menú ⋮ → **Instalar app** (o **Agregar a la pantalla principal**).
3. Se abre a pantalla completa, como una app más. Algunas funciones son solo de Android, como
   leer los avisos del banco.

### Enviar comentarios

En la app: **Ajustes → Enviar comentarios**. Elige si algo falla, si tienes una idea u otra cosa,
y escribe. Para fallas, cuenta qué hacías, qué esperabas y qué pasó.

**Nunca escribas números de tarjeta, claves ni datos de acceso a tu banco.** Lukas no los pide
nunca. Si un número de tarjeta se cuela en el mensaje, la app lo tapa antes de enviarlo y el
servidor lo vuelve a revisar antes de guardarlo.

## Para el equipo

### Repartir la beta

- **APK:** cada release de `@lukas/mobile` adjunta el APK firmado por EAS al GitHub Release
  (ver [releases.md](releases.md)). Si el repo es privado, las personas no pueden descargarlo de
  ahí: compartan el enlace de descarga de EAS que queda en el resumen del workflow **EAS**.
- **Web (PWA):** la de producción, `<proyecto>.pages.dev`. Pasar a producción requiere la
  aprobación del dueño.
- Invitar de a pocas personas y anotar a quién se le envió, para saber cuándo se llega a 10.

### Leer los comentarios

Quedan en `app.feedback` (Neon, rama `main`). La app solo puede insertar; leerlos se hace desde la
consola SQL de Neon con el rol dueño:

```sql
select created_at, kind, platform, app_version, message
from app.feedback
order by created_at desc
limit 100;
```

La tabla no guarda el correo, solo el `user_id`. Para responderle a alguien, búsquenlo en
`auth.users` solo si hace falta, y no copien comentarios con datos personales a issues públicos.

### Hecho cuando

10 personas usan la beta durante una semana. Al cerrar, revisar los comentarios, convertir las
fallas en issues y decidir qué entra antes del lanzamiento.
