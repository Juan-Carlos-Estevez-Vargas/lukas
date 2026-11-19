import * as SecureStore from "expo-secure-store";
import { requestWidgetUpdate, type WidgetTaskHandler } from "react-native-android-widget";
import { EMPTY_SNAPSHOT, parseSnapshot, type WidgetSnapshot } from "./snapshot";
import { availableWidget, quickExpenseWidget } from "./widgets";

/** Nombres declarados en el plugin de app.json. */
export const AVAILABLE_WIDGET = "MonthAvailable";
export const QUICK_WIDGET = "QuickExpense";

// El último resumen se guarda cifrado (Keystore) para pintar el widget sin abrir la base.
const KEY = "widget.available";

interface Texts {
  readonly quick: string;
  readonly empty: WidgetSnapshot;
}

let texts: Texts = {
  quick: "+ Gasto",
  empty: EMPTY_SNAPSHOT("Disponible este mes", "Abre Lukas para actualizar"),
};

/** La app actualiza los widgets cada vez que calcula el disponible. */
export async function updateWidgets(snapshot: WidgetSnapshot, quickLabel: string): Promise<void> {
  texts = { ...texts, quick: quickLabel };
  await SecureStore.setItemAsync(KEY, JSON.stringify(snapshot));
  await requestWidgetUpdate({
    widgetName: AVAILABLE_WIDGET,
    renderWidget: () => availableWidget(snapshot),
  });
  await requestWidgetUpdate({
    widgetName: QUICK_WIDGET,
    renderWidget: () => quickExpenseWidget(quickLabel),
  });
}

/** Android pide pintar un widget (al agregarlo, al cambiar de tamaño o por tiempo). */
export const widgetTaskHandler: WidgetTaskHandler = async ({
  widgetInfo,
  widgetAction,
  renderWidget,
}) => {
  if (widgetAction === "WIDGET_DELETED" || widgetAction === "WIDGET_CLICK") return;
  if (widgetInfo.widgetName === QUICK_WIDGET) {
    renderWidget(quickExpenseWidget(texts.quick));
    return;
  }
  const stored = parseSnapshot(await SecureStore.getItemAsync(KEY).catch(() => null));
  renderWidget(availableWidget(stored ?? texts.empty));
};
