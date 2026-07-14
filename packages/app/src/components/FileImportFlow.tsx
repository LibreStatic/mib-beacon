import { useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, Card, Label, Mono, Pill, SectionTitle, useTheme } from '@mibbeacon/ui';
import { useEngine } from '../engine-context';
import { useAppStore } from '../store';
import { importReviewedFiles } from '../actions';
import {
  createInitialFileSelection,
  acquireWithVisibleFailure,
  stageAcquiredFileImport,
  validateFileImportSelection,
  type AcquisitionResult,
} from '../file-import';
import { useFileImportAdapter } from '../file-import-context';

const keyForGroup = (modules: readonly string[]) => [...modules].sort().join('|');
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export function FileImportFlow({ busy }: { busy: boolean }) {
  const engine = useEngine();
  const adapter = useFileImportAdapter();
  const modules = useAppStore((state) => state.modules);
  const t = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);

  const stage = async (result: AcquisitionResult) => {
    if (result.status === 'cancelled') return;
    if (result.status === 'unsupported') {
      setMessage(result.message);
      return;
    }
    setStaging(true);
    setMessage(null);
    try {
      const next = await stageAcquiredFileImport(result, modules, (module) =>
        engine.mibs.replacementGroup(module),
      );
      useAppStore.getState().setFileImportDraft({
        review: next,
        selected: [...createInitialFileSelection(next)],
        replacements: [],
        handleId: null,
        visible: true,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStaging(false);
    }
  };

  const dropProps = adapter.acquireDrop
    ? {
        onDragOver: (event: { preventDefault(): void }) => event.preventDefault(),
        onDrop: (event: {
          preventDefault(): void;
          dataTransfer?: DataTransfer;
          nativeEvent?: { dataTransfer?: DataTransfer };
        }) => {
          event.preventDefault();
          if (busy || staging) return;
          const transfer = event.dataTransfer ?? event.nativeEvent?.dataTransfer;
          if (transfer)
            void acquireWithVisibleFailure(
              () => adapter.acquireDrop!(transfer),
              'Dropped files',
            ).then(stage);
        },
      }
    : {};

  return (
    <View
      {...dropProps}
      style={[styles.dropZone, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}
    >
      <Label size={12}>Files, folders, or ZIP archives</Label>
      <Label tone="dim" size={11}>
        Review everything locally before it is sent to the engine.
      </Label>
      <View style={styles.actions}>
        <Button
          title={staging ? 'Reading…' : 'Choose files'}
          small
          disabled={busy || staging}
          onPress={() =>
            void acquireWithVisibleFailure(adapter.acquireFiles, 'File picker').then(stage)
          }
        />
        <Button
          title="Choose folder"
          small
          variant="ghost"
          disabled={busy || staging}
          onPress={() =>
            void acquireWithVisibleFailure(adapter.acquireDirectory, 'Folder picker').then(stage)
          }
        />
      </View>
      {adapter.acquireDrop ? (
        <Label tone="dim" size={11}>
          Or drop files and folders here
        </Label>
      ) : null}
      {adapter.platform === 'ios' ? (
        <Label tone="dim" size={11}>
          iOS: choose multiple files or a ZIP archive; direct folder selection is unavailable.
        </Label>
      ) : null}
      {message ? (
        <Label tone="warn" size={11}>
          {message}
        </Label>
      ) : null}
    </View>
  );
}

/** Mounted once at the app shell so OS associations can open review from any route. */
export function FileImportReviewModal() {
  const engine = useEngine();
  const adapter = useFileImportAdapter();
  const draft = useAppStore((state) => state.fileImportDraft);
  const setDraft = useAppStore((state) => state.setFileImportDraft);
  const updateDraft = useAppStore((state) => state.updateFileImportDraft);
  const acceptDraft = useAppStore((state) => state.acceptFileImportDraft);
  const t = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const reviewHeading = useRef<View>(null);
  const review = draft?.review ?? null;
  const selected = useMemo(() => new Set(draft?.selected ?? []), [draft?.selected]);
  const replacements = useMemo(() => new Set(draft?.replacements ?? []), [draft?.replacements]);

  const validation = useMemo(
    () => (review ? validateFileImportSelection(review, selected, replacements) : null),
    [review, replacements, selected],
  );
  const selectedBytes = useMemo(
    () =>
      review?.files
        .filter((file) => selected.has(file.id))
        .reduce((sum, file) => sum + file.candidate.size, 0) ?? 0,
    [review, selected],
  );

  const focusReviewHeading = () => {
    const handle = findNodeHandle(reviewHeading.current);
    if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const toggleFile = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateDraft({ selected: [...next] });
  };
  const toggleReplacement = (group: string[]) => {
    const key = keyForGroup(group);
    const enabling = !replacements.has(key);
    const nextReplacements = new Set(replacements);
    if (enabling) nextReplacements.add(key);
    else nextReplacements.delete(key);
    const nextSelected = new Set(selected);
    for (const file of review?.files ?? []) {
      if (file.modules.some((module) => group.includes(module))) {
        if (enabling && !file.blocked) nextSelected.add(file.id);
        if (!enabling) nextSelected.delete(file.id);
      }
    }
    updateDraft({ replacements: [...nextReplacements], selected: [...nextSelected] });
  };
  const confirm = async () => {
    if (!review || !validation || validation.errors.length) return;
    setSubmitting(true);
    try {
      const handleId = await importReviewedFiles(
        engine,
        validation.files,
        validation.replaceModules,
        `File import (${validation.files.length} source${validation.files.length === 1 ? '' : 's'})`,
      );
      if (handleId) acceptDraft(handleId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={Boolean(review && draft?.visible)}
      transparent
      animationType="slide"
      onShow={focusReviewHeading}
      onRequestClose={() => !submitting && setDraft(null)}
    >
      <View
        style={styles.backdrop}
        accessibilityViewIsModal
        accessibilityLabel="Review MIB file import"
      >
        <Card style={styles.sheet}>
          <View
            ref={reviewHeading}
            style={styles.heading}
            accessible
            accessibilityRole="header"
            accessibilityLabel="Review MIB file import"
          >
            <View style={styles.headingText}>
              <SectionTitle>Review file import</SectionTitle>
              <Label tone="dim" size={11}>
                Destination: {adapter.destinationLabel ?? 'Connected engine'}
              </Label>
            </View>
            <Pill
              text={`${review?.files.length ?? 0} candidates · ${formatBytes(selectedBytes)} selected / ${formatBytes(review?.totalBytes ?? 0)} expanded`}
            />
          </View>
          {adapter.platform === 'web' || adapter.platform === 'desktop' ? (
            <Label tone="warn" size={11}>
              No selected file content has been uploaded. Confirming Import sends only the checked
              MIB sources to {adapter.destinationLabel ?? 'the connected engine'}.
            </Label>
          ) : null}
          {draft?.reopenMessage ? (
            <Label tone="warn" size={11}>
              {draft.reopenMessage}
            </Label>
          ) : null}
          <ScrollView
            style={styles.reviewScroll}
            contentContainerStyle={styles.reviewContent}
            keyboardShouldPersistTaps="handled"
          >
            {review?.duplicateDefinitions.map((duplicate) => (
              <View key={duplicate.module} style={[styles.notice, { borderColor: t.warn }]}>
                <Label tone="warn" size={11}>
                  Choose exactly one source for {duplicate.module}:{' '}
                  {duplicate.files
                    .map((id) => review.files.find((file) => file.id === id)?.path ?? id)
                    .join(', ')}
                </Label>
              </View>
            ))}
            {review?.files.map((file) => {
              const checked = selected.has(file.id);
              return (
                <View
                  key={file.id}
                  style={[styles.fileCard, { borderColor: file.blocked ? t.error : t.border }]}
                >
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`Include ${file.path}`}
                    accessibilityState={{ checked, disabled: file.blocked }}
                    disabled={file.blocked}
                    onPress={() => toggleFile(file.id)}
                    style={styles.fileHeader}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: t.border,
                          backgroundColor: checked ? t.accent : 'transparent',
                        },
                      ]}
                    >
                      <Text style={{ color: t.accentText, fontWeight: '900' }}>
                        {checked ? '✓' : ''}
                      </Text>
                    </View>
                    <View style={styles.fileTitle}>
                      <Mono size={11} numberOfLines={2}>
                        {file.path}
                      </Mono>
                      {file.candidate.archive ? (
                        <Label tone="dim" size={10}>
                          From {file.candidate.archive}
                        </Label>
                      ) : null}
                      <Label tone="dim" size={10}>
                        {formatBytes(file.candidate.size)}
                      </Label>
                    </View>
                    <Pill
                      text={file.blocked ? 'blocked' : checked ? 'included' : 'skipped'}
                      color={file.blocked ? t.error : checked ? t.ok : undefined}
                    />
                  </Pressable>
                  <Label size={11}>Modules: {file.modules.join(', ') || 'none'}</Label>
                  <Label tone="dim" size={10}>
                    Imports:{' '}
                    {file.imports
                      .map((item) => `${item.module} (${item.symbols.join(', ')})`)
                      .join(' · ') || 'none'}
                  </Label>
                  {file.warnings.map((warning) => (
                    <Label key={warning} tone="warn" size={10}>
                      {warning}
                    </Label>
                  ))}
                  {file.errors.map((error) => (
                    <Label key={error} tone="error" size={10}>
                      {error}
                    </Label>
                  ))}
                  {file.collisions
                    .filter((collision) => collision.kind === 'base')
                    .map((collision) => (
                      <Label key={`base-${collision.module}`} tone="error" size={10}>
                        {collision.module} is a bundled base module and cannot be replaced.
                      </Label>
                    ))}
                  {[
                    ...new Map(
                      file.collisions
                        .filter((collision) => collision.kind === 'loaded-user')
                        .map((collision) => {
                          const group = collision.replacementGroup ?? [collision.module];
                          return [keyForGroup(group), group] as const;
                        }),
                    ).entries(),
                  ].map(([key, group]) => (
                    <View key={key} style={styles.replaceRow}>
                      <Label tone="warn" size={10}>
                        Already loaded: {group.join(', ')}
                      </Label>
                      <Button
                        title={replacements.has(key) ? 'Keep existing' : 'Replace'}
                        small
                        variant={replacements.has(key) ? 'danger' : 'ghost'}
                        onPress={() => toggleReplacement(group)}
                      />
                    </View>
                  ))}
                </View>
              );
            })}
            {review?.externalMissingImports.length ? (
              <View style={[styles.notice, { borderColor: t.border }]}>
                <Label tone="dim" size={11}>
                  External dependencies (the resolver may search after confirmation):
                </Label>
                {review.externalMissingImports.map((dependency) => (
                  <Mono key={dependency.module} dim size={10}>
                    {dependency.module} · {dependency.symbols.join(', ')}
                  </Mono>
                ))}
              </View>
            ) : null}
            <Label tone="dim" size={10}>
              Local semantic validation uses temporary dependency stubs, so it cannot verify
              external dependency contents. The engine validates the confirmed batch and resolved
              dependencies again.
            </Label>
            {review?.rejections.map((rejection, index) => (
              <View
                key={`${rejection.path}-${index}`}
                style={[styles.rejection, { borderColor: t.error }]}
              >
                <Mono size={10}>{rejection.path}</Mono>
                <Label tone="error" size={10}>
                  {rejection.message}
                </Label>
              </View>
            ))}
            {validation?.errors.map((error) => (
              <Label key={error} tone="error" size={11}>
                {error}
              </Label>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <Button
              title="Close review"
              variant="ghost"
              disabled={submitting}
              onPress={() => setDraft(null)}
            />
            <Button
              title={submitting ? 'Starting…' : `Import ${validation?.files.length ?? 0} files`}
              disabled={submitting || Boolean(validation?.errors.length)}
              onPress={() => void confirm()}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dropZone: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, padding: 12, gap: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5,9,16,0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  sheet: { width: '100%', maxWidth: 720, height: '92%', minHeight: 0, paddingBottom: 12 },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  headingText: { flex: 1, gap: 3 },
  reviewScroll: { flex: 1, minHeight: 0 },
  reviewContent: { gap: 8, paddingVertical: 4 },
  fileCard: { borderWidth: 1, borderRadius: 9, padding: 9, gap: 5 },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileTitle: { flex: 1, minWidth: 0 },
  checkbox: {
    width: 21,
    height: 21,
    borderWidth: 1,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 3 },
  rejection: { borderLeftWidth: 2, paddingLeft: 8, gap: 2 },
  replaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4 },
});
