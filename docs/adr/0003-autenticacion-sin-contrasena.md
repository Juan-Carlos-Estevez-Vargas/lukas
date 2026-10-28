# 0003. Autenticación sin contraseña en el plan gratuito

- Estado: Propuesto
- Fecha: 2026-10-28

## Contexto

La API corre en Cloudflare Workers Free, que da 10 ms de CPU por solicitud. Un hash de contraseña
seguro (Argon2id con los parámetros de OWASP: 19 MiB y 2 iteraciones) tarda entre 50 y 100 ms en
WASM, y PBKDF2 con las 600 000 iteraciones recomendadas tampoco cabe. Bajar los parámetros para
entrar en 10 ms dejaría las contraseñas expuestas ante una filtración, y en una app de finanzas no
es aceptable.

## Decisión

Mientras estemos en el plan gratuito no hay contraseñas. Se entra con:

- **Código de un solo uso por correo** (6 dígitos, 5 minutos, 3 intentos, guardado como hash
  SHA-256). Así se crea la cuenta y se recupera el acceso.
- **Passkeys (WebAuthn)** con verificación de usuario obligatoria (huella, Face ID o PIN). Son
  resistentes al phishing y la llave privada nunca sale del dispositivo.
- **Turnstile** antes de enviar un código, para frenar bots y el abuso de correo.

Las sesiones duran 30 días, se renuevan una vez al día de uso y se pueden listar y cerrar de forma
remota. La web usa cookie `Secure; HttpOnly` y la app móvil usa `Authorization: Bearer`.

El TOTP con códigos de respaldo queda para cuando haya contraseña: en Better Auth el segundo factor
solo se exige en los inicios de sesión con contraseña. Con passkeys ya tenemos un factor fuerte.

## Consecuencias

- Todo el flujo cabe en el plan gratuito y no guardamos contraseñas, así que no hay nada que
  filtrar.
- Hace falta un proveedor de correo (puerto `Mailer`). En desarrollo el código se escribe en la
  consola; en staging y producción hay que conectar uno (por ejemplo Resend, que tiene plan gratis).
- Si alguien pierde el acceso a su correo y a sus dispositivos, la recuperación es manual.
- Al pasar a Workers Paid se puede agregar contraseña con Argon2id y TOTP sin migrar datos: solo se
  activan los métodos en la configuración.
