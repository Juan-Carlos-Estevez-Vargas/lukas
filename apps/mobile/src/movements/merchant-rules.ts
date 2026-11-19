import { merchantKey } from "@lukas/domain";

/**
 * Comercios colombianos frecuentes y la categoría por defecto que les toca. Solo se usan cuando la
 * persona aún no tiene historial con ese comercio; su propia elección siempre gana.
 */
const RULES: readonly (readonly [category: string, words: readonly string[]])[] = [
  [
    "default.mercado",
    [
      "exito",
      "carulla",
      "d1",
      "ara",
      "olimpica",
      "jumbo",
      "makro",
      "metro",
      "isimo",
      "surtimax",
      "mercado",
      "fruver",
    ],
  ],
  [
    "default.restaurantes",
    [
      "rappi",
      "ifood",
      "domicilios",
      "restaurante",
      "corral",
      "crepes",
      "frisby",
      "kfc",
      "mcdonalds",
      "juan valdez",
      "tostao",
      "oma",
      "panaderia",
    ],
  ],
  [
    "default.transporte",
    [
      "uber",
      "didi",
      "cabify",
      "indrive",
      "tullave",
      "transmilenio",
      "metro de medellin",
      "civica",
      "terpel",
      "primax",
      "texaco",
      "biomax",
      "gasolina",
      "peaje",
      "parqueadero",
      "taxi",
    ],
  ],
  [
    "default.servicios",
    [
      "epm",
      "enel",
      "codensa",
      "vanti",
      "gas natural",
      "acueducto",
      "emcali",
      "air e",
      "afinia",
      "celsia",
    ],
  ],
  ["default.celular", ["claro", "movistar", "tigo", "wom", "etb", "virgin", "une"]],
  [
    "default.salud",
    ["drogueria", "farmacia", "cruz verde", "farmatodo", "colsubsidio", "eps", "sura"],
  ],
  [
    "default.entretenimiento",
    [
      "netflix",
      "spotify",
      "disney",
      "prime video",
      "hbo",
      "max",
      "cine colombia",
      "cinemark",
      "procinal",
      "steam",
      "playstation",
      "xbox",
    ],
  ],
  [
    "default.compras",
    [
      "falabella",
      "mercado libre",
      "amazon",
      "homecenter",
      "alkosto",
      "ktronix",
      "flamingo",
      "zara",
      "arturo calle",
      "temu",
      "shein",
    ],
  ],
  ["default.educacion", ["universidad", "colegio", "platzi", "coursera", "udemy", "icetex"]],
];

/** Categoría por defecto sugerida para un comercio conocido, o `null`. */
export function ruleCategoryFor(merchant: string): string | null {
  const key = ` ${merchantKey(merchant)} `;
  for (const [category, words] of RULES) {
    if (words.some((w) => key.includes(` ${w} `))) return category;
  }
  return null;
}
