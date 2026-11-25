# 0007. Open finance: por ahora no, y nunca con credenciales

- Estado: Aceptado
- Fecha: 2026-11-25

## Contexto

Conectar las cuentas del banco ahorraría digitar movimientos. En Colombia hay dos caminos.

**Agregadores comerciales**

|                             | Belvo                                                                                                                                  | Prometeo                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Qué ofrece                  | Datos de cuentas y transacciones por API. Tiene un acuerdo regulado con Nequi (feb. 2024) y dice cubrir unas 10 entidades colombianas. | Verificación de titularidad, riesgo y pagos o transferencias. Su página no publica cobertura de cuentas personales en Colombia. |
| Costo                       | Sandbox gratis solo para pruebas. Producción desde el plan _Launch_ a **USD 1 000 al mes**.                                            | Sin precios publicados: hay que hablar con ventas.                                                                              |
| Plan gratis para producción | No                                                                                                                                     | No                                                                                                                              |

**Sistema regulado de finanzas abiertas**

- La Circular Externa 004 de 2024 de la Superfinanciera exige requisitos al tercero receptor de
  datos. Debe ser persona jurídica y cumplir estándares de protección de datos, protección al
  consumidor y ciberseguridad; en la práctica se pide ISO 27001.
- También exige la autorización previa, expresa e informada del titular (Leyes 1266 de 2008 y 1581
  de 2012) y que la persona pueda revocarla.
- El decreto de abril de 2026 vuelve obligatorio el sistema para las entidades vigiladas, a través
  de un Directorio de Participantes que administra la SFC.
- Los terceros no vigilados pueden adherirse voluntariamente.
- La SFC tiene 6 meses para fijar estándares y cronograma, y luego las entidades tienen hasta 12
  meses (más 6 de prórroga) para abrir sus APIs.

**La alternativa sin regulación**

El _screen scraping_ pide el usuario y la clave del banco. Eso choca con una regla del proyecto:
nunca pedir, registrar ni guardar credenciales bancarias.

## Decisión

1. **No se integra ningún agregador por ahora.** Ninguno tiene plan gratis de producción
   (ADR 0002), y Belvo cuesta más de lo que el proyecto factura hoy.
2. **Nunca se usará scraping ni se pedirán credenciales bancarias**, aunque un proveedor lo ofrezca.
3. **Mientras tanto, los movimientos entran por los caminos que ya existen:**
   - registro rápido;
   - captura de notificaciones del banco en Android;
   - importación de extractos (CSV, Excel y PDF);
   - lectura de recibos con IA.
4. **Se revisa la decisión** cuando ocurra una de dos cosas:
   - la SFC publique el cronograma de APIs obligatorias y el proceso de adhesión al Directorio para
     terceros no vigilados;
   - Lukas tenga ingresos que cubran el costo de un agregador y su certificación de seguridad.
5. **Si se integra, será detrás de un puerto `BankLink`** en el módulo de importación, con:
   - consentimiento explícito y revocable desde la app;
   - solo lectura;
   - tokens del proveedor guardados cifrados en la API, nunca en el teléfono.

## Consecuencias

- No hay costo fijo ni requisitos de la SFC que cumplir antes del lanzamiento.
- La persona sigue registrando o importando sus movimientos. La captura de notificaciones y la
  importación de extractos cubren la mayor parte del trabajo.
- La importación ya normaliza movimientos de fuentes externas. Cuando llegue el momento, un
  proveedor regulado se conecta como otra fuente de importación, sin migrar datos.
- Hay que vigilar el cronograma de la SFC. Queda anotado en `docs/backlog.md` (FIN-605) para la
  revisión trimestral.

## Fuentes

- Planes de Belvo: https://belvo.com/plans-and-pricing/
- Prometeo: https://prometeoapi.com/en/about-us
- Acuerdo Belvo–Nequi: https://www.latamfintech.co/articles/fintechs-belvo-y-nequi-realizan-el-primer-acuerdo-de-open-finance-en-colombia
- Circular Externa 004 de 2024: https://www.hklaw.com/en/insights/publications/2024/03/la-sfc-expide-regulacion-sobre-las-finanzas-abiertas-en-colombia
- Decreto de finanzas abiertas obligatorias: https://www.portafolio.co/economia/finanzas/expiden-decreto-para-poner-en-marcha-el-sistema-de-finanzas-abiertas-obligatorio-en-que-consiste-491669
