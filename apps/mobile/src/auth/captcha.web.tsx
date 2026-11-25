import { useEffect, useState } from "react";
import { Body, Button } from "../components/ui";
import { useI18n } from "../i18n/i18n";
import { CAPTCHA_CHANNEL, captchaUrl, parseCaptchaMessage } from "./captcha-core";

export interface CaptchaProps {
  readonly siteKey: string;
  readonly lang: string;
  readonly onToken: (token: string | null) => void;
}

/**
 * Turnstile en la web. La app corre aislada (COEP require-corp) y el iframe de Cloudflare no lo
 * permite, así que el widget se abre en una ventana del mismo origen que devuelve el token por
 * `BroadcastChannel`.
 */
export function Captcha({ siteKey, lang, onToken }: CaptchaProps) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CAPTCHA_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const message = parseCaptchaMessage(event.data);
      if (!message) return;
      const token = message.type === "token" ? message.token : null;
      setDone(token !== null);
      onToken(token);
    };
    return () => channel.close();
  }, [onToken]);

  return done ? (
    <Body muted>{t("signIn.captchaDone")}</Body>
  ) : (
    <Button
      variant="plain"
      label={t("signIn.captcha")}
      onPress={() => {
        window.open(
          captchaUrl(window.location.origin, siteKey, lang),
          "lukas-captcha",
          "popup,width=360,height=420",
        );
      }}
    />
  );
}
