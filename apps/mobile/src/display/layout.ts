/** Desde este ancho (px) la web usa el diseño de escritorio: menú lateral y contenido centrado. */
export const DESKTOP_MIN_WIDTH = 900;
/** Ancho máximo del contenido en escritorio, para que las listas no queden de lado a lado. */
export const CONTENT_MAX_WIDTH = 760;

export const isDesktop = (width: number): boolean => width >= DESKTOP_MIN_WIDTH;
