// La web usa expo-sqlite sobre wa-sqlite: Metro debe empaquetar el .wasm y el servidor de desarrollo
// debe aislar el origen (COOP/COEP) para que exista SharedArrayBuffer. En producción esas cabeceras
// salen de public/_headers.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("wasm")) config.resolver.assetExts.push("wasm");

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
