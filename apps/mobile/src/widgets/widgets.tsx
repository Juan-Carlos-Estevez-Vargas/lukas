import type { ColorTokens } from "@lukas/ui";
import { dark, light } from "@lukas/ui";
import { FlexWidget, type HexColor, TextWidget } from "react-native-android-widget";
import { QUICK_CATEGORIES, quickEntryUri, type WidgetSnapshot } from "./snapshot";

const hex = (c: string): HexColor => (c.startsWith("#") ? (c as HexColor) : "#000000");

const open = (uri: string) => ({ clickAction: "OPEN_URI", clickActionData: { uri } }) as const;

function Available({ s, c }: { readonly s: WidgetSnapshot; readonly c: ColorTokens }) {
  return (
    <FlexWidget
      {...open("lukas://")}
      style={{
        height: "match_parent",
        width: "match_parent",
        padding: 12,
        borderRadius: 16,
        backgroundColor: hex(c.surface),
        justifyContent: "space-between",
      }}
    >
      <TextWidget text={s.label} style={{ fontSize: 13, color: hex(c.textMuted) }} />
      <TextWidget
        text={s.amount}
        style={{ fontSize: 26, fontWeight: "700", color: hex(s.negative ? c.expense : c.text) }}
      />
      <FlexWidget
        style={{
          flexDirection: "row",
          width: "match_parent",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <TextWidget text={s.hint} style={{ fontSize: 12, color: hex(c.textMuted) }} />
        <FlexWidget
          {...open(quickEntryUri("expense"))}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
            backgroundColor: hex(c.primary),
          }}
        >
          <TextWidget
            text="+"
            style={{ fontSize: 18, fontWeight: "700", color: hex(c.onPrimary) }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

/** Widget de disponible del mes, en tema claro y oscuro. */
export const availableWidget = (s: WidgetSnapshot) => ({
  light: <Available s={s} c={light} />,
  dark: <Available s={s} c={dark} />,
});

function Quick({ label, c }: { readonly label: string; readonly c: ColorTokens }) {
  const chip = (uri: string, text: string, main = false) => (
    <FlexWidget
      {...open(uri)}
      style={{
        height: "match_parent",
        flex: main ? 2 : 1,
        marginHorizontal: 3,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: hex(main ? c.primary : c.background),
      }}
    >
      <TextWidget
        text={text}
        style={{
          fontSize: main ? 15 : 18,
          fontWeight: "700",
          color: hex(main ? c.onPrimary : c.text),
        }}
      />
    </FlexWidget>
  );
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        padding: 6,
        borderRadius: 18,
        flexDirection: "row",
        backgroundColor: hex(c.surface),
      }}
    >
      {chip(quickEntryUri("expense"), label, true)}
      {QUICK_CATEGORIES.map((q) => chip(quickEntryUri("expense", q.id), q.icon))}
    </FlexWidget>
  );
}

/** Widget de gasto rápido: un botón grande y tres categorías frecuentes. */
export const quickExpenseWidget = (label: string) => ({
  light: <Quick label={label} c={light} />,
  dark: <Quick label={label} c={dark} />,
});
