import { Platform } from "react-native";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./bridge";

/** Registra el manejador de widgets antes de que arranque la app (Android lo llama sin UI). */
export function registerWidgets(): void {
  if (Platform.OS === "android") registerWidgetTaskHandler(widgetTaskHandler);
}
