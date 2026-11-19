// Solo lo que se usa: barras, líneas, cuadrícula, tooltip y el dibujo en SVG (sin canvas ni eval:
// cumple la CSP). Metro no descarta código sin usar, así que se importa pieza por pieza en vez de
// `echarts/charts`, que arrastraría todos los tipos de gráfico.
import "echarts/lib/chart/bar";
import "echarts/lib/chart/line";
import "echarts/lib/component/gridSimple";
import "echarts/lib/component/tooltip";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([SVGRenderer]);

export { echarts };
