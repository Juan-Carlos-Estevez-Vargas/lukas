import { LEGAL_VERSIONS, type LegalDocument } from "@lukas/domain";

/**
 * Datos del Responsable del tratamiento. Los define el dueño de Lukas (ver pendientes de FIN-407)
 * antes de abrir la beta; mientras tanto la app los muestra como "por definir".
 */
export const CONTROLLER = {
  name: "Por definir",
  id: "Por definir",
  city: "Bogotá D.C., Colombia",
  email: "Por definir",
} as const;

export interface LegalSection {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export interface LegalText {
  readonly document: LegalDocument;
  readonly title: string;
  readonly version: string;
  readonly sections: readonly LegalSection[];
}

const c = CONTROLLER;

/** Política de Tratamiento de Datos Personales (Ley 1581 de 2012 y Decreto 1074 de 2015). */
const privacy: LegalText = {
  document: "privacy",
  title: "Política de tratamiento de datos personales",
  version: LEGAL_VERSIONS.privacy,
  sections: [
    {
      title: "1. Quién es el responsable",
      paragraphs: [
        `El responsable del tratamiento de tus datos es ${c.name}, identificado con ${c.id}, con domicilio en ${c.city}. Para cualquier asunto sobre tus datos escribe a ${c.email}.`,
      ],
    },
    {
      title: "2. Qué datos tratamos",
      paragraphs: [
        "Tu correo electrónico, para que entres a tu cuenta.",
        "Las finanzas que registras: cuentas, movimientos, categorías, presupuestos, metas y recurrentes. Son datos financieros personales y los tratamos con reserva.",
        "Si activas la captura automática, el texto de los avisos de tus bancos y billeteras. Se lee en tu teléfono y solo se guarda lo que apruebas.",
        "Si activas el asistente con IA, tus preguntas, cifras resumidas y las fotos de recibos que decidas leer.",
        "Datos técnicos mínimos: tipo de teléfono, versión de la app y registros de errores sin datos personales.",
        "Si no lo apagas en Ajustes, reportes de errores y estadísticas de uso anónimas (qué pantallas y funciones se usan), con un identificador aleatorio de la instalación. Nunca incluyen montos, comercios, tu correo ni datos de tus cuentas.",
        "Los comentarios que nos envías desde la app, con la versión y el tipo de teléfono.",
        "Lukas nunca pide, registra ni guarda números de tarjeta, CVV, claves ni credenciales bancarias.",
      ],
    },
    {
      title: "3. Para qué los usamos",
      paragraphs: [
        "Darte el servicio: guardar y sincronizar tus finanzas entre tus dispositivos, calcular saldos, presupuestos, reportes y proyecciones.",
        "Enviarte los avisos que activas (pagos de tarjeta, presupuestos, resumen semanal).",
        "Responder tus preguntas con el asistente y leer recibos, solo si lo activas.",
        "Gestionar tu plan y tus pagos si eliges premium. Los pagos los procesa la pasarela; nosotros no vemos los datos de tu tarjeta.",
        "Mejorar la app a partir de los comentarios que nos envías.",
        "Seguridad, prevención de fraude y cumplimiento de obligaciones legales.",
        "No vendemos tus datos ni los usamos para publicidad de terceros.",
      ],
    },
    {
      title: "4. Encargados y transferencias internacionales",
      paragraphs: [
        "Para operar usamos proveedores que tratan datos por nuestra cuenta, con servidores fuera de Colombia: Cloudflare (servidores de la API, web y modelos de IA), Neon (base de datos), Sentry (reportes de errores) y PostHog (estadísticas de uso), en Estados Unidos y la Unión Europea. Para pagar premium intervienen Wompi (Colombia) en la web y Google Play y RevenueCat (Estados Unidos) en Android; ellos tratan los datos de pago y Lukas no los recibe. Con tu autorización aceptas esta transmisión y transferencia internacional de datos, en los términos del artículo 26 de la Ley 1581 de 2012.",
        "Los datos viajan cifrados (HTTPS) y, en tu teléfono, la base local está cifrada.",
      ],
    },
    {
      title: "5. Tus derechos",
      paragraphs: [
        "Como titular puedes: conocer, actualizar y rectificar tus datos; pedir prueba de la autorización que nos diste; saber cómo los usamos; revocar la autorización o pedir que los borremos cuando no haya un deber legal de conservarlos; presentar quejas ante la Superintendencia de Industria y Comercio después de agotar el trámite con nosotros; y acceder gratis a tus datos.",
        `Desde la app puedes exportar tus datos y borrar tu cuenta (Ajustes → Borrar mi cuenta): al confirmar se borran en el momento todos tus datos del servidor y del teléfono. Si ya no puedes entrar, escríbenos a ${c.email} y lo hacemos en máximo 15 días hábiles.`,
      ],
    },
    {
      title: "6. Cómo hacer consultas y reclamos",
      paragraphs: [
        `Escríbenos a ${c.email} desde el correo de tu cuenta, con tu nombre, lo que pides y, si es un reclamo, los hechos y documentos que lo soportan.`,
        "Consultas: respondemos en máximo 10 días hábiles; si no es posible, te explicamos por qué y respondemos en máximo 5 días hábiles más.",
        "Reclamos: respondemos en máximo 15 días hábiles; si no es posible, te explicamos por qué y respondemos en máximo 8 días hábiles más. Si el reclamo está incompleto, te pedimos lo que falta dentro de los 5 días siguientes.",
      ],
    },
    {
      title: "7. Menores de edad",
      paragraphs: ["Lukas es para mayores de 18 años. No tratamos a sabiendas datos de menores."],
    },
    {
      title: "8. Vigencia y cambios",
      paragraphs: [
        `Esta política rige desde el ${LEGAL_VERSIONS.privacy}. Tus datos se conservan mientras tengas cuenta en Lukas. Si cambiamos esta política te avisaremos en la app y te pediremos aceptarla de nuevo antes de seguir.`,
      ],
    },
  ],
};

/** Términos y condiciones de uso. */
const terms: LegalText = {
  document: "terms",
  title: "Términos y condiciones",
  version: LEGAL_VERSIONS.terms,
  sections: [
    {
      title: "1. Qué es Lukas",
      paragraphs: [
        `Lukas es una app para registrar y entender tus finanzas personales, ofrecida por ${c.name}. Al crear tu cuenta aceptas estos términos.`,
        "Lukas no es un banco ni una entidad vigilada por la Superintendencia Financiera, no mueve tu dinero y no da asesoría financiera, tributaria ni de inversión. Los cálculos, proyecciones y respuestas del asistente son orientativos.",
      ],
    },
    {
      title: "2. Tu cuenta",
      paragraphs: [
        "Debes ser mayor de 18 años y dar un correo que controles. Eres responsable de lo que pase con tu cuenta y tu teléfono; protégelos con el bloqueo de la app.",
        "No uses Lukas para actividades ilegales ni intentes acceder a datos de otras personas o afectar el servicio.",
      ],
    },
    {
      title: "3. Plan gratis y premium",
      paragraphs: [
        "El plan gratis no tiene costo. Premium tiene el precio que se muestra en la app antes de pagar, en pesos colombianos e impuestos incluidos.",
        "La prueba gratis dura 14 días, es una sola vez por persona y vence sola, sin cobros.",
        "Las suscripciones se renuevan solas al final de cada periodo hasta que las canceles. Al cancelar conservas premium hasta el final del periodo pagado.",
        "Tienes derecho de retracto en los 5 días hábiles siguientes a la compra, y a la reversión del pago en los casos del artículo 51 de la Ley 1480 de 2011.",
      ],
    },
    {
      title: "4. El asistente con IA",
      paragraphs: [
        "El asistente es opcional. Puede equivocarse: revisa lo que propone. Nada se guarda hasta que lo apruebas.",
      ],
    },
    {
      title: "5. Disponibilidad y responsabilidad",
      paragraphs: [
        "Hacemos lo posible para que Lukas funcione siempre y tus datos estén seguros, pero el servicio puede tener interrupciones. Te recomendamos hacer respaldos cifrados desde la app.",
        "No respondemos por decisiones financieras que tomes con base en la app, ni por daños causados por terceros o por el mal uso de tu cuenta, en lo que permita la ley colombiana.",
      ],
    },
    {
      title: "6. Fin del servicio",
      paragraphs: [
        `Puedes pedir que borremos tu cuenta cuando quieras, escribiendo a ${c.email}. Podemos suspender cuentas que incumplan estos términos, avisándote cuando sea posible.`,
      ],
    },
    {
      title: "7. Ley aplicable y contacto",
      paragraphs: [
        `Estos términos se rigen por la ley colombiana y rigen desde el ${LEGAL_VERSIONS.terms}. Si los cambiamos te pediremos aceptarlos de nuevo. Contacto: ${c.email}.`,
      ],
    },
  ],
};

export const LEGAL_TEXTS: Readonly<Record<LegalDocument, LegalText>> = { privacy, terms };
