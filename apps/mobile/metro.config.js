// La web usa expo-sqlite sobre wa-sqlite: Metro debe empaquetar el .wasm y el servidor de desarrollo
// debe aislar el origen (COOP/COEP) para que exista SharedArrayBuffer. En producción esas cabeceras
// salen de public/_headers.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm");

// ECharts importa `tslib` como ESM; la entrada que elige Metro hace `import tslib from "../tslib.js"`
// sobre un módulo CommonJS y en la web queda `undefined`. Se resuelve directo a la versión ES.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (moduleName === "tslib") return resolve(context, "tslib/tslib.es6.js", platform);
  return resolve(context, moduleName, platform);
};

const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhance ? enhance(middleware, server) : middleware;
  return (req, res, done) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    return next(req, res, done);
  };
};

module.exports = config;
