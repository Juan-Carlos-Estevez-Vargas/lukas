// Turnstile para pedir el código de acceso (FIN-413). La app lo abre en un WebView (Android/iOS)
// o en una ventana emergente (web) y recibe el token por postMessage o BroadcastChannel.
(() => {
  const params = new URLSearchParams(location.search);
  const sitekey = params.get("sitekey") ?? "";
  const send = (message) => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
      return;
    }
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("lukas-turnstile");
      channel.postMessage(message);
      channel.close();
    }
    if (message.type === "token") {
      document.getElementById("status").hidden = false;
      setTimeout(() => window.close(), 600);
    }
  };
  window.lukasTurnstile = () => {
    if (!/^[0-9A-Za-z_-]{10,64}$/.test(sitekey)) return send({ type: "error", code: "sitekey" });
    window.turnstile.render("#widget", {
      sitekey,
      action: "send-otp",
      language: params.get("lang") === "en" ? "en" : "es",
      callback: (token) => send({ type: "token", token }),
      "expired-callback": () => send({ type: "expired" }),
      "error-callback": (code) => send({ type: "error", code: String(code) }),
    });
  };
  // Cloudflare cambia api.js sin aviso y pide no fijarlo con SRI ni copiarlo: se carga desde su
  // dominio, que es lo único que permite la CSP de esta página.
  const script = document.createElement("script");
  script.src =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=lukasTurnstile";
  script.async = true;
  document.head.appendChild(script);
})();
