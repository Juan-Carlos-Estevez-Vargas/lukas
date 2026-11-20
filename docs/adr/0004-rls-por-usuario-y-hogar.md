# 0004. Aislamiento de datos con RLS por usuario y hogar

- Estado: Aceptado
- Fecha: 2026-11-19

## Contexto

Con la sincronización (F2) la API empieza a leer y escribir datos financieros en Postgres. Filtrar
por `user_id` en cada consulta depende de no olvidarlo nunca; un solo descuido expone datos de otra
persona. Además, una pareja o familia necesita ver algunas cuentas en común sin compartir todo.

## Decisión

- Row Level Security en todas las tablas con datos de usuario del esquema `app`.
- La API no consulta como dueña de las tablas: cada petición usa `withUser` (`@lukas/db`), que abre
  una transacción, fija `app.user_id` con `set_config(…, true)` y baja al rol sin login
  `lukas_app` con `SET LOCAL ROLE`. Ambos ajustes mueren con la transacción, así que no se filtran
  entre peticiones del pool.
- Hogares (`households`, `household_members`): cada registro sigue teniendo un dueño; con
  `household_id` lo ven los miembros, pero solo el dueño lo cambia o lo borra. Solo se comparte con
  un hogar del que se es miembro y solo el dueño del hogar invita.
- `audit_log` se llena por trigger en cada escritura (quién la hizo y de quién era el registro) y
  con `app.audit()` para accesos que no escriben (exportar, reportes compartidos). La app no puede
  escribirla directamente ni leer la de otros.
- El dueño de las tablas (migraciones, tareas programadas como la TRM) no pasa por RLS.

## Consecuencias

- Un olvido de filtro en el código ya no expone datos: Postgres devuelve cero filas.
- Toda consulta de datos de usuario en la API debe ir dentro de `withUser`; una consulta fuera de
  ella corre como dueño y sí lo ve todo, así que la revisión de código debe vigilarlo.
- Las pruebas de aislamiento (`packages/db/src/rls.test.ts`) corren contra PGlite en cada PR y
  contra Neon al aplicar la migración en las previews.
