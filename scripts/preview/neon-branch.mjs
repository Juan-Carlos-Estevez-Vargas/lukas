// Crea (si no existe) o borra la rama de Neon de una preview de PR.
//
//   node scripts/preview/neon-branch.mjs create preview/pr-42   → escribe database_url en $GITHUB_OUTPUT
//   node scripts/preview/neon-branch.mjs delete preview/pr-42
//
// Requiere NEON_API_KEY y NEON_PROJECT_ID. Usa la API v2 de Neon directamente para no sumar
// otra acción de terceros a la cadena de suministro.
import { appendFileSync } from "node:fs";

const API = "https://console.neon.tech/api/v2";
const [command, name] = process.argv.slice(2);
const { NEON_API_KEY: key, NEON_PROJECT_ID: project, GITHUB_OUTPUT: output } = process.env;

if (!key || !project || !name || !["create", "delete"].includes(command ?? "")) {
  console.error(
    "Uso: neon-branch.mjs <create|delete> <nombre>  (con NEON_API_KEY y NEON_PROJECT_ID)",
  );
  process.exit(1);
}

/** Llama a la API de Neon y falla con el mensaje del servidor si no responde 2xx. */
async function neon(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function findBranch() {
  const { branches } = await neon(
    "GET",
    `/projects/${project}/branches?search=${encodeURIComponent(name)}`,
  );
  return branches.find((b) => b.name === name);
}

if (command === "create") {
  let branch = await findBranch();
  if (!branch) {
    // Compute mínimo (0.25 CU). El plan gratuito no deja cambiar la suspensión: usa la de Neon (5 min).
    ({ branch } = await neon("POST", `/projects/${project}/branches`, {
      branch: { name },
      endpoints: [
        { type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 },
      ],
    }));
    console.log(`Rama ${name} creada (${branch.id})`);
  } else {
    console.log(`Rama ${name} ya existía (${branch.id})`);
  }

  const { databases } = await neon("GET", `/projects/${project}/branches/${branch.id}/databases`);
  const database = databases.find((d) => d.name === "neondb") ?? databases[0];
  if (!database) throw new Error(`La rama ${name} no tiene bases de datos`);
  const params = new URLSearchParams({
    branch_id: branch.id,
    database_name: database.name,
    role_name: database.owner_name,
  });
  const { uri } = await neon("GET", `/projects/${project}/connection_uri?${params}`);
  // La cadena lleva la contraseña: se enmascara antes de pasarla a los siguientes pasos.
  console.log(`::add-mask::${uri}`);
  if (output) appendFileSync(output, `database_url=${uri}\n`);
} else {
  const branch = await findBranch();
  if (branch) {
    await neon("DELETE", `/projects/${project}/branches/${branch.id}`);
    console.log(`Rama ${name} borrada`);
  } else {
    console.log(`La rama ${name} no existe; nada que borrar`);
  }
}
