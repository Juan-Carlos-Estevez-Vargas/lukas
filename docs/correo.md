# Correo del código de acceso

Lukas entra sin contraseña: la API manda un código de 6 dígitos al correo (ADR 0003). En
desarrollo el código sale en la consola; en staging y producción lo envía **Resend** por HTTP
(`apps/api/src/modules/auth/mailer.ts`). Sin la llave, la API se niega a enviar códigos y nadie
puede entrar.

## Encenderlo

1. Crear una cuenta gratis en https://resend.com (3 000 correos al mes, 100 al día).
2. **API Keys → Create API key** con permiso _Sending access_.
3. Subirla a la API, sin pegarla en ningún chat ni archivo:

   ```sh
   cd apps/api
   npx wrangler secret put RESEND_API_KEY --env staging
   npx wrangler secret put RESEND_API_KEY --env production
   ```

4. Probar: entrar a la web de staging con el correo con el que se creó la cuenta de Resend.

## Sin dominio y con dominio

- **Sin dominio propio** el remitente es `Lukas <onboarding@resend.dev>` y Resend **solo entrega
  al correo del dueño de la cuenta**. Sirve para probar staging, no para la beta.
- **Con dominio** (FIN-501, tiene costo y requiere aprobación): en Resend, **Domains → Add
  domain**, agregar en Cloudflare DNS los registros que pide (SPF, DKIM y, si se quiere, DMARC) y,
  cuando quede verificado, crear en GitHub la variable de repositorio `MAIL_FROM`, por ejemplo
  `Lukas <acceso@tudominio.co>`. El despliegue la pasa a la API; no hay que publicar otra versión.

## Qué no hace

- No registra el destinatario ni el código en los logs; si Resend falla, solo queda el estado HTTP.
- No manda correos de marketing: solo el código.
