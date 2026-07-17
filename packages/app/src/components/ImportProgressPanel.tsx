import { StyleSheet, View } from 'react-native';
import { Button, Label, Mono, Pill, useTheme } from '@mibbeacon/ui';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { cancelImport } from '../actions';

/** Live import progress plus the last import outcome, fed from the shared store. */
export function ImportProgressPanel() {
  const engine = useEngine();
  const t = useTheme();
  const busy = useAppStore((s) => s.importBusy);
  const lastImport = useAppStore((s) => s.lastImport);
  const importStatus = useAppStore((s) => s.importStatus);
  const progress = useAppStore((s) => s.importProgress);
  const completed = useAppStore((s) => s.importCompleted);
  const total = useAppStore((s) => s.importTotal);
  return (
    <>
      {busy || importStatus ? (
        <View
          style={[styles.progressPanel, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}
        >
          <View style={styles.eyebrowRow}>
            <Label tone={importStatus?.state === 'error' ? 'error' : 'dim'} size={11}>
              {busy
                ? (importStatus?.state ?? 'starting resolver')
                : (importStatus?.state ?? 'finished')}
            </Label>
            {total > 0 ? <Pill text={`${completed}/${total}`} color={t.accent} /> : null}
          </View>
          {progress.slice(-6).map((item) => (
            <View key={item.id} style={styles.progressRow}>
              <Pill text={item.kind.replaceAll('-', ' ')} />
              <Mono dim size={10} numberOfLines={1}>
                {[item.module, item.sourceId, item.location ?? item.message]
                  .filter(Boolean)
                  .join(' · ')}
              </Mono>
            </View>
          ))}
          {importStatus?.loadedModules.length ? (
            <Label tone="ok" size={11}>
              Resolved: {importStatus.loadedModules.join(', ')}
            </Label>
          ) : null}
          {importStatus?.failures.map((failure, index) => (
            <Label key={`${failure.module}-${index}`} tone="error" size={11}>
              {failure.module ? `${failure.module}: ` : ''}
              {failure.message}
            </Label>
          ))}
          {busy ? (
            <Button
              title="Cancel resolution"
              small
              variant="danger"
              onPress={() => void cancelImport(engine)}
            />
          ) : null}
        </View>
      ) : null}
      {lastImport ? (
        <View style={styles.importResult}>
          {lastImport.loaded.length ? (
            <Label tone="ok" size={12}>
              Loaded: {lastImport.loaded.join(', ')}
            </Label>
          ) : null}
          {lastImport.errors.map((e, i) => (
            <Label key={i} tone="error" size={12}>
              {e.name}: {e.message}
            </Label>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  eyebrowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  importResult: { marginTop: 4, gap: 2 },
  progressPanel: { borderWidth: 1, borderRadius: 9, padding: 9, gap: 6 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
});
