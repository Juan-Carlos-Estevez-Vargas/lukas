// Junta los coverage-summary.json (formato json-summary de Istanbul/Vitest) de cada
// app y paquete, y escribe una tabla en Markdown para el resumen del job de CI.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "packages"];
const rows = [];

for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root)) {
    const file = join(root, name, "coverage", "coverage-summary.json");
    if (!existsSync(file)) continue;
    const { total } = JSON.parse(readFileSync(file, "utf8"));
    rows.push({ name: `${root}/${name}`, total });
  }
}

const pct = (metric) => `${metric.pct.toFixed(1)} %`;

console.log("## Cobertura\n");
if (rows.length === 0) {
  console.log("Todavía no hay reportes de cobertura.");
} else {
  console.log("| Paquete | Líneas | Ramas | Funciones |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const { name, total } of rows) {
    console.log(
      `| ${name} | ${pct(total.lines)} | ${pct(total.branches)} | ${pct(total.functions)} |`,
    );
  }
}
