Closes #

## Qué cambia

## Cómo se probó

## Checklist
- [ ] Commits con Conventional Commits y el id de la tarea (`[FIN-xxx]`)
- [ ] Changeset agregado si cambia el comportamiento de una app (`pnpm changeset`)
- [ ] Pruebas nuevas o actualizadas
- [ ] Sin secretos, datos personales ni números de tarjeta en código, logs o fixtures
- [ ] Montos de dinero en enteros (`bigint`), nunca en `number`
- [ ] Documentación o ADR actualizados si cambia una decisión

### Seguridad (marca solo lo que aplique a este cambio)
- [ ] **Entrada (ASVS V5):** todo dato externo se valida con Zod y se rechaza lo que sobra
- [ ] **Acceso (ASVS V4):** las rutas nuevas exigen sesión y filtran por `user_id`; hay prueba de que otro usuario no ve los datos
- [ ] **Sesión (ASVS V3):** nada guarda tokens fuera de cookies seguras o Keystore/Keychain
- [ ] **Errores y logs (ASVS V7):** sin datos personales, montos ni tokens en logs; errores en RFC 9457 sin detalles internos
- [ ] **Almacenamiento móvil (MASVS-STORAGE):** datos sensibles solo en SQLCipher o SecureStore, nunca en AsyncStorage ni en logs
- [ ] **Red móvil (MASVS-NETWORK):** solo HTTPS hacia dominios propios
- [ ] **Plataforma (MASVS-PLATFORM):** permisos nuevos justificados y mínimos; sin deep links que salten la sesión
- [ ] Si cambia un límite de confianza, actualicé `docs/security/modelo-de-amenazas.md`
