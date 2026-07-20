import { Linking, View, Text, StyleSheet } from 'react-native';
import { useState } from 'react';
import { Button, Card, Dialog, Label, Mono, Pill, Row, SectionTitle, useTheme } from '@mibbeacon/ui';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { browseVendorMibs, loadLookupCandidate, lookupUnknownOid } from '../actions';
import { observiumSearchUrl } from '../oid-lookup';
import { shouldOfferVendorMibBrowse, vendorMibImportAction } from '../vendor-mib-browser';

/** Explicit, one-OID-at-a-time external lookup. It never starts without a user press. */
export function OidLookupPanel({ oid, compact = false }: { oid: string; compact?: boolean }) {
  const engine = useEngine();
  const t = useTheme();
  const normalized = oid.trim().replace(/^\./, '');
  const lookup = useAppStore((s) => s.oidLookups[normalized]);
  const running = Boolean(useAppStore((s) => s.lookupHandles[normalized]));
  const vendorBrowse = useAppStore((s) => s.vendorMibBrowses[normalized]);
  const vendorBrowseRunning = Boolean(useAppStore((s) => s.vendorMibBrowseHandles[normalized]));
  const importing = useAppStore((s) => s.importBusy);
  const [vendorBrowserOpen, setVendorBrowserOpen] = useState(false);
  const [vendorBrowseStarting, setVendorBrowseStarting] = useState(false);
  const [startingCandidate, setStartingCandidate] = useState<string | null>(null);
  const valid = /^\d+(?:\.\d+)+$/.test(normalized);
  if (!valid) return null;
  const vendorPrompt = lookup?.result
    ? shouldOfferVendorMibBrowse(lookup.result)
    : null;
  const openVendorBrowser = () => {
    if (!vendorPrompt || !lookup?.result?.enterprise || vendorBrowseStarting) return;
    setVendorBrowserOpen(true);
    setVendorBrowseStarting(true);
    void browseVendorMibs(engine, normalized, vendorPrompt.vendor).finally(() =>
      setVendorBrowseStarting(false),
    );
  };
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
            {lookup.result.cached ? <Pill text={`cached · ${lookup.result.cached.name}`} color={t.warn} /> : null}
          </Row>
          {lookup.result.cached?.module ? (
            <Row>
              <View style={{ flex: 1 }}>
                <Label tone="dim" size={10}>Cached but not loaded</Label>
                <Mono size={10}>{lookup.result.cached.module}</Mono>
              </View>
              <Button
                title="Load cached"
                small
                disabled={importing}
                onPress={() => void loadLookupCandidate(engine, lookup.result!.cached!.module!, true)}
              />
            </Row>
          ) : null}
          {lookup.result.enterprise ? (
            <Evidence title={`IANA enterprise ${lookup.result.enterprise.number}`} value={lookup.result.enterprise.organization} />
          ) : null}
          {vendorPrompt ? (
            <View style={styles.vendorPrompt}>
              <Label tone="dim" size={11}>No such OID in our MIB database.</Label>
              <Button
                title={vendorPrompt.label}
                small
                variant="ghost"
                onPress={openVendorBrowser}
              />
            </View>
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
                <Row key={`${candidate.sourceId}-${candidate.module}-${index}`} style={styles.candidate}>
                  <Text style={{ color: t.text, fontSize: 11, flex: 1 }}>
                    {candidate.module} · {candidate.sourceId}{candidate.location ? ` · ${candidate.location}` : ''}
                  </Text>
                  <Button
                    title="Fetch"
                    small
                    variant="ghost"
                    disabled={importing}
                    onPress={() => void loadLookupCandidate(engine, candidate.module)}
                  />
                </Row>
              ))}
            </View>
          ) : null}
          <Button
            title="Search Observium"
            small
            variant="ghost"
            onPress={() => void Linking.openURL(observiumSearchUrl(normalized))}
          />
          {!lookup.result.loaded && !lookup.result.enterprise && !lookup.result.oidBase && !lookup.result.oidRef && !lookup.result.candidates.length ? (
            <Label tone="dim" size={11}>No matching loaded definition or external registry evidence was found.</Label>
          ) : null}
        </View>
      ) : null}
    </>
  );
  return (
    <>
      {compact ? <View style={[styles.compact, { borderColor: t.border }]}>{content}</View> : <Card>{content}</Card>}
      <Dialog
        visible={vendorBrowserOpen}
        onRequestClose={() => setVendorBrowserOpen(false)}
        title={vendorPrompt ? `MIBs for ${vendorPrompt.vendor}` : 'Vendor MIBs'}
        subtitle={`Explore sources for ${normalized}`}
        maxWidth={680}
      >
        {vendorBrowseRunning || vendorBrowseStarting ? <Label tone="dim" size={11}>Searching configured MIB sources and verifying OID ownership…</Label> : null}
        {vendorBrowse?.error ? <Label tone="error" size={11}>{vendorBrowse.error}</Label> : null}
        {vendorBrowse?.result?.fromCache ? <Pill text="cached-only results" color={t.warn} /> : null}
        {vendorBrowse?.result?.candidates.map((candidate) => {
          const action = vendorMibImportAction(vendorBrowse.result!.fromCache, candidate);
          const candidateKey = `${candidate.sourceId}-${candidate.module}`;
          return (
            <View key={candidateKey} style={[styles.browserCandidate, { borderColor: t.border }]}>
              <View style={styles.browserCandidateCopy}>
                <Row style={styles.wrap}>
                  <Mono size={11}>{candidate.module}</Mono>
                  <Pill
                    text={candidate.verified ? 'verified OID owner' : 'possible vendor module'}
                    color={candidate.verified ? t.ok : t.warn}
                  />
                </Row>
                <Label tone="dim" size={10}>{candidate.sourceName}</Label>
                {candidate.matchName ? <Label tone="dim" size={10}>{candidate.matchName}{candidate.matchOid ? ` · ${candidate.matchOid}` : ''}</Label> : null}
                {candidate.reason && !candidate.verified ? <Label tone="dim" size={10}>{candidate.reason}</Label> : null}
              </View>
              <Button
                title={action.label}
                small
                disabled={importing || startingCandidate !== null || action.disabled}
                onPress={() => {
                  if (action.disabled) return;
                  setStartingCandidate(candidateKey);
                  void loadLookupCandidate(
                    engine,
                    candidate.module,
                    action.mode === 'cached',
                    action.mode === 'download' ? candidate.sourceId : undefined,
                  ).finally(() => setStartingCandidate(null));
                }}
              />
            </View>
          );
        })}
        {vendorBrowse?.result && vendorBrowse.result.candidates.length === 0 && !vendorBrowseRunning && !vendorBrowseStarting ? (
          <Label tone="dim" size={11}>No matching MIB candidates were found in the available sources.</Label>
        ) : null}
      </Dialog>
    </>
  );
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
  vendorPrompt: { gap: 2, paddingVertical: 2 },
  browserCandidate: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  browserCandidateCopy: { flex: 1, minWidth: 0, gap: 3 },
  evidence: { borderLeftWidth: 2, borderLeftColor: '#4f8ef7', paddingLeft: 7 },
  candidate: { alignItems: 'center', gap: 6 },
});
