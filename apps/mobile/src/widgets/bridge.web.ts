import type { WidgetSnapshot } from "./snapshot";

/** En la web no hay widgets. */
export async function updateWidgets(
  _snapshot: WidgetSnapshot,
  _quickLabel: string,
): Promise<void> {}
