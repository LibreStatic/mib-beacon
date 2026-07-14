import { useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { PollSample } from '@mibbeacon/core/client';
import { Button, Label, Mono, Row, useTheme } from '@mibbeacon/ui';
import { chartPoints, polylinePoints } from '../tool-chart';

export interface ToolChartSeries {
  id: string;
  name: string;
  color: string;
  samples: PollSample[];
}

export function ToolLineChart({
  series,
  title = 'Performance history',
}: {
  series: ToolChartSeries[];
  title?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(520);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<{
    x: number;
    name: string;
    sample: PollSample;
    color: string;
  } | null>(null);
  const svgRef = useRef<{
    elementRef?: { current?: SVGSVGElement | null };
    toDataURL?: (
      callback: (value: string) => void,
      options?: { width?: number; height?: number },
    ) => void;
  } | null>(null);
  const visible = series.filter((item) => !hidden.has(item.id));
  const bounds = useMemo(() => {
    const samples = visible
      .flatMap((item) => item.samples)
      .filter(
        (sample): sample is PollSample & { value: number } =>
          sample.value !== null && Number.isFinite(sample.value),
      );
    if (!samples.length) return null;
    return {
      minTime: Math.min(...samples.map((sample) => sample.sampledAt)),
      maxTime: Math.max(...samples.map((sample) => sample.sampledAt)),
      minValue: Math.min(...samples.map((sample) => sample.value)),
      maxValue: Math.max(...samples.map((sample) => sample.value)),
    };
  }, [visible]);
  const plotWidth = Math.max(120, width - 44);
  const plotHeight = 190;
  const rendered = visible.map((item) => ({
    ...item,
    points: bounds ? chartPoints(item.samples, plotWidth, plotHeight, bounds) : [],
  }));

  const selectNearest = (event: GestureResponderEvent) => {
    const x = Math.max(0, Math.min(plotWidth, event.nativeEvent.locationX - 36));
    const candidates = rendered.flatMap((item) =>
      item.points.map((point) => ({ ...point, name: item.name, color: item.color })),
    );
    const nearest = candidates.reduce<(typeof candidates)[number] | undefined>(
      (best, point) => (!best || Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best),
      undefined,
    );
    if (nearest)
      setCursor({ x: nearest.x, name: nearest.name, sample: nearest.sample, color: nearest.color });
  };

  const exportPng = () => {
    const downloadName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'chart'}.png`;
    const downloadBlob = (blob: Blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.click();
      // Chromium starts blob-backed downloads asynchronously. Revoking on
      // the next tick can produce a successful zero-byte download.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const source = svgRef.current?.elementRef?.current;
      if (!source) return;
      const clone = source.cloneNode(true) as SVGSVGElement;
      const exportWidth = Math.max(1, Math.round(width));
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(exportWidth));
      clone.setAttribute('height', '230');
      const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      background.setAttribute('width', '100%');
      background.setAttribute('height', '100%');
      background.setAttribute('fill', t.surface);
      clone.insertBefore(background, clone.firstChild);
      const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: 'image/svg+xml;charset=utf-8',
      });
      const svgUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(svgUrl);
        const canvas = document.createElement('canvas');
        canvas.width = exportWidth;
        canvas.height = 230;
        canvas.getContext('2d')?.drawImage(image, 0, 0, exportWidth, 230);
        canvas.toBlob((blob) => {
          if (blob) downloadBlob(blob);
        }, 'image/png');
      };
      image.src = svgUrl;
      return;
    }
    svgRef.current?.toDataURL?.((base64) => {
      const url = `data:image/png;base64,${base64}`;
      void Share.share({ url, title: `${title}.png` });
    }, { width: Math.max(1, Math.round(width)), height: 230 });
  };

  return (
    <View style={styles.root} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Row style={styles.head}>
        <View style={{ flex: 1 }}>
          <Label tone="dim" size={10}>
            {title.toUpperCase()}
          </Label>
        </View>
        <Button title="PNG" small variant="ghost" onPress={exportPng} />
      </Row>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={selectNearest}
        onResponderMove={selectNearest}
      >
        <Svg
          ref={svgRef as never}
          width={width}
          height={230}
          accessibilityLabel={`${title} line chart`}
        >
          <Line x1={36} y1={8} x2={36} y2={198} stroke={t.border} />
          <Line x1={36} y1={198} x2={36 + plotWidth} y2={198} stroke={t.border} />
          {bounds ? (
            <>
              <SvgText x={2} y={14} fill={t.textDim} fontSize={9}>
                {formatNumber(bounds.maxValue)}
              </SvgText>
              <SvgText x={2} y={198} fill={t.textDim} fontSize={9}>
                {formatNumber(bounds.minValue)}
              </SvgText>
              <SvgText x={36} y={216} fill={t.textDim} fontSize={9}>
                {new Date(bounds.minTime).toLocaleTimeString()}
              </SvgText>
              <SvgText x={Math.max(36, width - 86)} y={216} fill={t.textDim} fontSize={9}>
                {new Date(bounds.maxTime).toLocaleTimeString()}
              </SvgText>
            </>
          ) : null}
          {rendered.map((item) => (
            <Polyline
              key={item.id}
              points={polylinePoints(item.points)}
              fill="none"
              stroke={item.color}
              strokeWidth={2}
            />
          ))}
          {cursor ? (
            <>
              <Line
                x1={36 + cursor.x}
                y1={8}
                x2={36 + cursor.x}
                y2={198}
                stroke={t.textDim}
                strokeDasharray="3 3"
              />
              {rendered
                .flatMap((item) => item.points)
                .filter((point) => point.sample.id === cursor.sample.id)
                .slice(0, 1)
                .map((point) => (
                  <Circle
                    key={point.sample.id}
                    cx={36 + point.x}
                    cy={8 + point.y}
                    r={4}
                    fill={cursor.color}
                  />
                ))}
            </>
          ) : null}
        </Svg>
      </View>
      {cursor ? (
        <Mono size={10}>
          {cursor.name} · {cursor.sample.value} ·{' '}
          {new Date(cursor.sample.sampledAt).toLocaleString()}
        </Mono>
      ) : null}
      <Row style={styles.legend}>
        {series.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${hidden.has(item.id) ? 'Show' : 'Hide'} chart series ${item.name}`}
            accessibilityState={{ selected: !hidden.has(item.id) }}
            onPress={() =>
              setHidden((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
            style={[
              styles.legendItem,
              { minHeight: t.density.controlMinHeight, opacity: hidden.has(item.id) ? 0.4 : 1 },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={{ color: t.text, fontSize: 10 }}>{item.name}</Text>
          </Pressable>
        ))}
      </Row>
    </View>
  );
}

export function ToolSparkline({ samples, color }: { samples: PollSample[]; color: string }) {
  const points = chartPoints(samples.slice(-80), 210, 44);
  return (
    <Svg width="100%" height={48} viewBox="0 0 210 48" accessibilityLabel="Recent watch values">
      <Polyline points={polylinePoints(points)} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function formatNumber(value: number): string {
  return Math.abs(value) >= 1_000_000
    ? value.toExponential(2)
    : value.toFixed(2).replace(/\.00$/, '');
}

const styles = StyleSheet.create({
  root: { gap: 5, minWidth: 0 },
  head: { alignItems: 'center' },
  legend: { flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
