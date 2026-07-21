import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import type { PatternTraceEvent, PatternTraceSession, PollSample } from '@mibbeacon/core/client';
import { Button, Label, Mono, Row, Text, useTheme } from '@mibbeacon/ui';
import { chartPoints, patternLatencyPoints, patternMarkerX, polylinePoints } from '../tool-chart';

export interface ToolChartSeries {
  id: string;
  name: string;
  color: string;
  samples: PollSample[];
}

export interface ChartPngExport {
  fileName: string;
  base64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}

export function ToolLineChart({
  series,
  title = 'Performance history',
  patternSessions = [],
  patternEvents = {},
  hiddenPatternSessionIds,
  onTogglePatternSession,
  sharePng,
}: {
  series: ToolChartSeries[];
  title?: string;
  patternSessions?: PatternTraceSession[];
  patternEvents?: Record<string, PatternTraceEvent[]>;
  hiddenPatternSessionIds?: string[];
  onTogglePatternSession?: (sessionId: string) => void;
  sharePng?: (capture: ChartPngExport) => Promise<void>;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(520);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenPatterns, setHiddenPatterns] = useState<Set<string>>(new Set());
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
  const visiblePatterns = patternSessions.filter(
    (session) => !(hiddenPatternSessionIds ?? [...hiddenPatterns]).includes(session.id),
  );
  const traceEvents = visiblePatterns.flatMap((session) =>
    uniquePatternEvents(patternEvents[session.id] ?? []),
  );
  const bounds = useMemo(() => {
    const samples = visible
      .flatMap((item) => item.samples)
      .filter(
        (sample): sample is PollSample & { value: number } =>
          sample.value !== null && Number.isFinite(sample.value),
      );
    const traceTimes = traceEvents.map((event) => event.hitAt);
    if (!samples.length && !traceTimes.length) return null;
    return {
      minTime: Math.min(
        ...samples.map((sample) => sample.sampledAt),
        ...(traceTimes.length ? traceTimes : [Number.POSITIVE_INFINITY]),
      ),
      maxTime: Math.max(
        ...samples.map((sample) => sample.sampledAt),
        ...(traceTimes.length ? traceTimes : [Number.NEGATIVE_INFINITY]),
      ),
      minValue: samples.length ? Math.min(...samples.map((sample) => sample.value)) : 0,
      maxValue: samples.length ? Math.max(...samples.map((sample) => sample.value)) : 1,
    };
  }, [traceEvents, visible]);
  const plotWidth = Math.max(120, width - 44);
  const plotHeight = 190;
  const rendered = visible.map((item) => ({
    ...item,
    points: bounds ? chartPoints(item.samples, plotWidth, plotHeight, bounds) : [],
  }));
  const maxLatency = Math.max(
    1,
    ...traceEvents.flatMap((event) =>
      event.latencyMs !== undefined && Number.isFinite(event.latencyMs) ? [event.latencyMs] : [],
    ),
  );
  const renderedPatterns = visiblePatterns.map((session) => ({
    session,
    events: limitPatternEvents(uniquePatternEvents(patternEvents[session.id] ?? []), plotWidth),
    latencyPoints: patternLatencyPoints(
      limitPatternEvents(uniquePatternEvents(patternEvents[session.id] ?? []), plotWidth),
      plotWidth,
      plotHeight,
      {
        minTime: bounds?.minTime ?? 0,
        maxTime: bounds?.maxTime ?? 1,
        maxLatency,
      },
    ),
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
    const exportWidth = Math.max(1, Math.round(width));
    svgRef.current?.toDataURL?.(
      (base64) => {
        void sharePng?.({
          fileName: downloadName,
          base64,
          mimeType: 'image/png',
          width: exportWidth,
          height: 230,
        });
      },
      { width: exportWidth, height: 230 },
    );
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
              {traceEvents.some((event) => event.latencyMs !== undefined) ? (
                <>
                  <Line x1={36 + plotWidth} y1={8} x2={36 + plotWidth} y2={198} stroke={t.border} />
                  <SvgText x={Math.max(36, width - 34)} y={14} fill={t.textDim} fontSize={9}>
                    {formatNumber(maxLatency)}ms
                  </SvgText>
                  <SvgText x={Math.max(36, width - 25)} y={198} fill={t.textDim} fontSize={9}>
                    0ms
                  </SvgText>
                </>
              ) : null}
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
          {bounds
            ? renderedPatterns.flatMap(({ session, events }) =>
                events.map((event) => {
                  const x = 36 + patternMarkerX(event, plotWidth, bounds);
                  return (
                    <Line
                      key={`${session.id}-${event.id}`}
                      x1={x}
                      y1={8}
                      x2={x}
                      y2={198}
                      stroke={session.color}
                      strokeOpacity={0.7}
                      strokeDasharray="2 4"
                    />
                  );
                }),
              )
            : null}
          {renderedPatterns.map(({ session, latencyPoints }) => (
            <Polyline
              key={`${session.id}-latency`}
              points={polylinePoints(latencyPoints)}
              fill="none"
              stroke={session.color}
              strokeDasharray="5 3"
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
              {
                minHeight: t.density.controlMinHeight,
                backgroundColor: hidden.has(item.id)
                  ? t.components.disabled.background
                  : 'transparent',
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: hidden.has(item.id) ? t.components.disabled.border : item.color,
                },
              ]}
            />
            <Text
              style={{
                color: hidden.has(item.id) ? t.components.disabled.foreground : t.text,
                fontSize: 10,
              }}
            >
              {item.name}
            </Text>
          </Pressable>
        ))}
        {patternSessions.map((session) => {
          const isHidden = (hiddenPatternSessionIds ?? [...hiddenPatterns]).includes(session.id);
          return (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`${isHidden ? 'Show' : 'Hide'} pattern trace ${session.name}`}
              accessibilityState={{ selected: !isHidden }}
              onPress={() => {
                if (onTogglePatternSession) {
                  onTogglePatternSession(session.id);
                } else {
                  setHiddenPatterns((current) => {
                    const next = new Set(current);
                    if (next.has(session.id)) next.delete(session.id);
                    else next.add(session.id);
                    return next;
                  });
                }
              }}
              style={[
                styles.legendItem,
                {
                  backgroundColor: isHidden ? t.components.disabled.background : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: isHidden ? t.components.disabled.border : session.color,
                  },
                ]}
              />
              <Text
                style={{
                  color: isHidden ? t.components.disabled.foreground : t.text,
                  fontSize: 10,
                }}
              >
                Pattern: {session.name}
              </Text>
            </Pressable>
          );
        })}
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

function limitPatternEvents(events: PatternTraceEvent[], width: number): PatternTraceEvent[] {
  if (events.length <= 2_000) return events;
  const stride = Math.ceil(events.length / Math.max(1, width * 4));
  return events.filter((_event, index) => index % stride === 0);
}

function uniquePatternEvents(events: PatternTraceEvent[]): PatternTraceEvent[] {
  const unique = new Map<string, PatternTraceEvent>();
  for (const event of events) unique.set(`${event.hitIndex}:${event.hitAt}`, event);
  return [...unique.values()];
}

const styles = StyleSheet.create({
  root: { gap: 5, minWidth: 0 },
  head: { alignItems: 'center' },
  legend: { flexWrap: 'wrap', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
