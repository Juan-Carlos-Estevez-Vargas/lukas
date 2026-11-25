import { View } from "react-native";
import { WebView } from "react-native-webview";
import { webUrl } from "../config";
import { CAPTCHA_PATH, captchaUrl, parseCaptchaMessage } from "./captcha-core";

export interface CaptchaProps {
  readonly siteKey: string;
  readonly lang: string;
  /** Token nuevo, o `null` cuando vence o falla. */
  readonly onToken: (token: string | null) => void;
}

/** Turnstile en Android e iOS: la página de la web dentro de un WebView. */
export function Captcha({ siteKey, lang, onToken }: CaptchaProps) {
  if (!webUrl) return null;
  const base = webUrl;
  return (
    <View style={{ height: 80 }} testID="signin-captcha">
      <WebView
        source={{ uri: captchaUrl(base, siteKey, lang) }}
        originWhitelist={[base, "https://challenges.cloudflare.com"]}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        style={{ backgroundColor: "transparent" }}
        onShouldStartLoadWithRequest={(req) =>
          req.url.startsWith(`${base}${CAPTCHA_PATH}`) ||
          req.url.startsWith("https://challenges.cloudflare.com") ||
          req.url.startsWith("about:")
        }
        onMessage={(event) => {
          const message = parseCaptchaMessage(event.nativeEvent.data);
          if (message) onToken(message.type === "token" ? message.token : null);
        }}
      />
    </View>
  );
}
