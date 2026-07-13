import { View, Text, StyleSheet } from 'react-native';
import { Button, Card, Label, Mono, Pill, Row, SectionTitle, useTheme } from '@mibbeacon/ui';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { lookupUnknownOid } from '../actions';

/** Explicit, one-OID-at-a-time external lookup. It never starts without a user press. */
export function OidLookupPanel({ oid, compact = false }: { oid: string; compact?: boolean }) {
  const engine = useEngine();
  const t = useTheme();
  const normalized = oid.trim().replace(/^\./, '');
  const lookup = useAppStore((s) => s.oidLookups[normalized]);
  const running = Boolean(useAppStore((s) => s.lookupHandles[normalized]));
  const valid = /^\d+(?:\.\d+)+$/.test(normalized);
  if (!valid) return null;
  const content = (
    <>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <SectionTitle>External OID evidence</SectionTitle>
          <Mono dim size={10} numberOfLines={1}>{normalized}</Mono>
        </View>
        <Button
          title={running ? 'Looking up…' : lookup?.result ? 'Refresh' : 'Resolve'}
          small
          variant="ghost"
          disabled={running}
          onPress={() => void lookupUnknownOid(engine, normalized)}
        />
      </View>
      {running ? <Label tone="dim" size={11}>Checking loaded MIBs and waiting for permitted external sources…</Label> : null}
      {lookup?.error ? <Label tone="error" size={11}>{lookup.error}</Label> : null}
      {lookup?.result ? (
        <View style={styles.results}>
          <Row style={styles.wrap}>
            <Pill text={lookup.result.fromCache ? 'cached lookup' : 'fresh lookup'} color={lookup.result.fromCache ? t.warn : t.ok} />
            {lookup.result.loaded ? <Pill text={`loaded · ${lookup.result.loaded.name}`} color={t.ok} /> : null}
          </Row>
          {lookup.result.enterprise ? (
            <Evidence title={`IANA enterprise ${lookup.result.enterprise.number}`} value={lookup.result.enterprise.organization} />
          ) : null}
          {lookup.result.oidBase ? (
            <Evidence title="OID-base" value={lookup.result.oidBase.asn1Notation ?? lookup.result.oidBase.description ?? 'Registry match'} />
          ) : null}
          {lookup.result.oidRef ? (
            <Evidence title="OIDref" value={lookup.result.oidRef.title ?? lookup.result.oidRef.description ?? 'Reference match'} />
          ) : null}
          {lookup.result.candidates.length ? (
            <View>
              <Label tone="dim" size={10}>Candidate indexed MIBs</Label>
              {lookup.result.candidates.slice(0, 12).map((candidate, index) => (
                <Text key={`${candidate.sourceId}-${candidate.module}-${index}`} style={{ color: t.text, fontSize: 11 }}>
                  {candidate.module} · {candidate.sourceId}{candidate.location ? ` · ${candidate.location}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {!lookup.result.loaded && !lookup.result.enterprise && !lookup.result.oidBase && !lookup.result.oidRef && !lookup.result.candidates.length ? (
            <Label tone="dim" size={11}>No matching loaded definition or external registry evidence was found.</Label>
          ) : null}
        </View>
      ) : null}
    </>
  );
  return compact ? <View style={[styles.compact, { borderColor: t.border }]}>{content}</View> : <Card>{content}</Card>;
}

function Evidence({ title, value }: { title: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.evidence}>
      <Text style={{ color: t.textDim, fontSize: 10, fontWeight: '800' }}>{title}</Text>
      <Text style={{ color: t.text, fontSize: 11, lineHeight: 16 }} numberOfLines={3}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 5, marginTop: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  results: { gap: 6 },
  wrap: { flexWrap: 'wrap' },
  evidence: { borderLeftWidth: 2, borderLeftColor: '#4f8ef7', paddingLeft: 7 },
});
