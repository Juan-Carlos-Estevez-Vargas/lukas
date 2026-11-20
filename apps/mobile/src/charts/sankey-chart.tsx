import { layoutSankey, SANKEY_TOTAL } from "@lukas/charts";
import { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Svg, { Path, Rect, Text as SvgText } from "react-native-svg";

export interface SankeyItem {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly value: bigint;
}

export interface SankeyChartProps {
  /** De dónde entró la plata (columna izquierda). */
  readonly sources: readonly SankeyItem[];
  /** A dónde se fue (columna derecha). */
  readonly targets: readonly SankeyItem[];
  readonly totalColor: string;
  readonly height: number;
  readonly description: string;
  readonly textColor: string;
}

const NODE = 10;
const GAP = 8;
/** Alto mínimo de un nodo para ponerle nombre sin que se monte con el vecino. */
const MIN_LABEL = 13;
/** En la web el texto de un SVG sale con letra serif si no se le dice otra cosa. */
const FONT = Platform.OS === "web" ? { fontFamily: "system-ui, sans-serif" } : {};

/** Sankey con SVG, igual en el teléfono y en la web. Los nombres van sobre las cintas. */
export function SankeyChart(props: SankeyChartProps) {
  const { sources, targets, totalColor, height, description, textColor } = props;
  const [width, setWidth] = useState(0);
  const layout = useMemo(
    () => layoutSankey(sources, targets, { width, height, nodeWidth: NODE, gap: GAP }),
    [sources, targets, width, height],
  );
  const items = useMemo(
    () => new Map([...sources, ...targets].map((i) => [i.key, i])),
    [sources, targets],
  );
  const colorOf = (key: string) =>
    key === SANKEY_TOTAL ? totalColor : (items.get(key)?.color ?? totalColor);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={description}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {layout.links.map((link) => (
            <Path
              key={link.key}
              d={link.path}
              fill={colorOf(link.from === SANKEY_TOTAL ? link.to : link.from)}
              fillOpacity={0.28}
            />
          ))}
          {layout.nodes.map((node) => (
            <Rect
              key={node.key}
              x={node.x}
              y={node.y}
              width={node.width}
              height={Math.max(1, node.height)}
              rx={2}
              fill={colorOf(node.key)}
            />
          ))}
          {layout.nodes
            .filter((n) => n.column !== 1 && n.height >= MIN_LABEL)
            .map((node) => (
              <SvgText
                key={`label-${node.key}`}
                x={node.column === 0 ? node.x + node.width + 4 : node.x - 4}
                y={node.y + node.height / 2 + 4}
                fontSize={11}
                {...FONT}
                fill={textColor}
                textAnchor={node.column === 0 ? "start" : "end"}
              >
                {items.get(node.key)?.label ?? ""}
              </SvgText>
            ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
