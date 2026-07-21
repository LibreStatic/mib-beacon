import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Text,
  useTheme,
} from '@mibbeacon/ui';
import type { AgentProfile, AgentTestResult, EngineInfo } from '@mibbeacon/core/client';
import { useEngine, useEngineOwnership } from '../engine-context';
import {
  deleteAgentProfile,
  refreshAgentGroups,
  refreshAgentProfiles,
  saveAgentProfile,
  testAgentProfile,
} from '../actions';
import { useAppStore } from '../store';
import { useResponsiveLayout } from '../responsive-context';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { AgentProfileDialog } from '../components/AgentProfileDialog';
import { agentDraftFromEditor, editAgentProfile, EMPTY_AGENT_EDITOR } from '../agent-profile-form';
import {
  agentCollectionStatusText,
  agentPersistentCollectionsController,
} from '../agent-persistent-collections';

type AgentManagementSection = 'profiles' | 'groups';

export function AgentsScreen({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const ownsEngine = useEngineOwnership();
  const t = useTheme();
  const { mode } = useResponsiveLayout();
  const profiles = useAppStore((state) => state.agentProfiles);
  const groups = useAppStore((state) => state.agentGroups);
  const [managementSection, setManagementSection] = useState<AgentManagementSection>('profiles');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState(EMPTY_AGENT_EDITOR);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<AgentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{
    profileId: string;
    result: AgentTestResult | null;
    error: string | null;
  } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const collections = agentPersistentCollectionsController(engine, ownsEngine);
  const collectionState = useSyncExternalStore(
    collections.subscribe,
    collections.snapshot,
    collections.snapshot,
  );
  const collectionBlocked = [
    'queued',
    'updating',
    'error-reverted',
    'uncertain',
    'conflict',
  ].includes(collectionState.phase);

  const refreshGroups = useCallback(
    () => refreshAgentGroups(engine, ownsEngine),
    [engine, ownsEngine],
  );
  useEffect(() => {
    void refreshAgentProfiles(engine, ownsEngine).catch(() => undefined);
    void refreshGroups().catch(() => undefined);
  }, [engine, ownsEngine, refreshGroups]);

  const reset = () => {
    setEditingId(null);
    setEditor(EMPTY_AGENT_EDITOR);
    setError(null);
  };
  const openCreate = () => {
    reset();
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    reset();
  };

  const save = async () => {
    if (collectionBlocked) return;
    setEditorBusy(true);
    setError(null);
    try {
      const draft = agentDraftFromEditor(editor);
      const outcome = await saveAgentProfile(engine, editingId, draft, ownsEngine);
      if (!ownsEngine()) return;
      const state = useAppStore.getState();
      state.pushToast({
        tone: 'success',
        message: editingId ? 'Profile saved' : 'Profile created',
      });
      closeEditor();
      if (outcome.refreshError) {
        state.pushToast({
          tone: 'warn',
          message:
            'Profile saved, but the list could not be refreshed. Confirmed values are shown.',
        });
      }
    } catch (caught) {
      if (!ownsEngine()) return;
      setEditor((current) => ({ ...current, community: '', authKey: '', privKey: '' }));
      const originalMessage = caught instanceof Error ? caught.message : String(caught);
      let message = editingId
        ? originalMessage
        : `${originalMessage} — The create outcome could not be confirmed. Check the list before retrying.`;
      if (editingId) {
        try {
          await collections.reconcile();
          if (!ownsEngine()) return;
          const confirmed = collections
            .snapshot()
            .profiles.find((profile) => profile.id === editingId);
          if (confirmed) {
            setEditor(editAgentProfile(confirmed));
            message = `${originalMessage} — Restored the last confirmed profile values.`;
          } else {
            closeEditor();
            message = `${originalMessage} — The profile no longer exists.`;
          }
        } catch {
          if (!ownsEngine()) return;
          message = `${originalMessage} — The save outcome could not be confirmed. Retry or reopen the profile.`;
        }
      }
      if (!ownsEngine()) return;
      setError(message);
      useAppStore.getState().pushToast({ tone: 'error', message });
    } finally {
      if (ownsEngine()) setEditorBusy(false);
    }
  };

  const runTest = async (id: string) => {
    setTestingId(id);
    setTestState(null);
    try {
      const { result, refreshError } = await testAgentProfile(engine, id, ownsEngine);
      if (!ownsEngine()) return;
      setTestState({ profileId: id, result, error: null });
      if (refreshError) {
        useAppStore.getState().pushToast({
          tone: 'warn',
          message: 'Connection succeeded, but profile metadata could not be refreshed.',
        });
      }
    } catch (caught) {
      if (!ownsEngine()) return;
      const detail = caught as { message?: string; hint?: string };
      setTestState({
        profileId: id,
        result: null,
        error: `${detail.message ?? String(caught)}${detail.hint ? ` — ${detail.hint}` : ''}`,
      });
    } finally {
      if (ownsEngine()) setTestingId(null);
    }
  };

  const confirmDeleteProfile = async (profile: AgentProfile) => {
    setDeletingId(profile.id);
    let message: string | null = null;
    let refreshWarning = false;
    try {
      const outcome = await deleteAgentProfile(engine, profile.id, ownsEngine);
      if (!ownsEngine()) return;
      refreshWarning = outcome.refreshErrors.length > 0;
    } catch (caught) {
      if (!ownsEngine()) return;
      const originalMessage = caught instanceof Error ? caught.message : String(caught);
      message = `${originalMessage} — The delete outcome could not be confirmed.`;
      await Promise.allSettled([refreshAgentProfiles(engine, ownsEngine), refreshGroups()]);
      if (!ownsEngine()) return;
      if (!useAppStore.getState().agentProfiles.some(({ id }) => id === profile.id)) {
        message = null;
      }
    } finally {
      if (ownsEngine()) setDeletingId(null);
    }

    if (!ownsEngine()) return;
    if (message) {
      useAppStore.getState().pushToast({ tone: 'error', message });
      return;
    }
    if (useAppStore.getState().selectedAgentId === profile.id) {
      useAppStore.getState().selectAgentProfile(null);
    }
    if (editingId === profile.id) closeEditor();
    if (testState?.profileId === profile.id) setTestState(null);
    setDeleteCandidate(null);
    useAppStore.getState().pushToast({ tone: 'success', message: 'Profile deleted' });
    if (refreshWarning) {
      useAppStore.getState().pushToast({
        tone: 'warn',
        message: 'Profile deleted, but related lists could not be refreshed.',
      });
    }
  };

  const remove = (profile: AgentProfile) => setDeleteCandidate(profile);

  const compact = mode === 'compact';
  const showProfiles = !compact || managementSection === 'profiles';
  const showGroups = !compact || managementSection === 'groups';

  return (
    <View style={styles.root}>
      <WorkspaceHeader
        title="Agent profiles"
        subtitle="ENCRYPTED CREDENTIALS · CONNECTION TESTS · REUSABLE GROUPS"
        actions={<Pill text={`${profiles.length} SAVED`} color={t.accent} />}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View accessibilityLiveRegion="polite">
          <Label
            tone={
              collectionState.phase === 'error-reverted' || collectionState.phase === 'conflict'
                ? 'error'
                : 'dim'
            }
          >
            {agentCollectionStatusText(collectionState)}
          </Label>
        </View>
        {['error-reverted', 'uncertain', 'conflict'].includes(collectionState.phase) ? (
          <Row style={styles.wrap}>
            <Button
              title="Reconcile"
              small
              variant="ghost"
              onPress={() => void collections.reconcile().catch(() => undefined)}
            />
            {collectionState.phase === 'error-reverted' && collectionState.retryable ? (
              <Button
                title="Retry"
                small
                onPress={() => void collections.retryFailed().catch(() => undefined)}
              />
            ) : null}
            {collectionState.phase === 'uncertain' && collectionState.canAcknowledgeUncertainty ? (
              <Button
                title="Acknowledge uncertainty"
                small
                variant="ghost"
                onPress={() => collections.acknowledgeUncertainty()}
              />
            ) : collectionState.phase !== 'uncertain' ? (
              <Button
                title="Acknowledge"
                small
                variant="ghost"
                onPress={() => collections.acknowledge()}
              />
            ) : null}
          </Row>
        ) : null}
        {compact ? (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Agent management section"
            style={[styles.sectionTabs, { borderColor: t.border }]}
          >
            {(
              [
                ['profiles', `Profiles (${profiles.length})`],
                ['groups', `Groups (${groups.length})`],
              ] as const
            ).map(([section, label]) => {
              const selected = managementSection === section;
              return (
                <Pressable
                  key={section}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  onPress={() => setManagementSection(section)}
                  style={({ pressed }) => [
                    styles.sectionTab,
                    {
                      backgroundColor: selected || pressed ? t.accentSoft : 'transparent',
                      borderColor: selected ? t.accent : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.sectionTabText, { color: selected ? t.accent : t.textDim }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {showProfiles ? (
          <Card style={styles.card}>
            <View style={styles.heading}>
              <SectionTitle>Saved agents</SectionTitle>
              <Button title="New profile" small variant="ghost" onPress={openCreate} />
            </View>
            {profiles.length === 0 ? (
              <View style={styles.stack}>
                <Label tone="dim">No saved profiles yet.</Label>
                <Row>
                  <Button title="Add profile" small onPress={openCreate} />
                </Row>
              </View>
            ) : (
              profiles.map((profile) => (
                <View key={profile.id} style={[styles.profileRow, { borderColor: t.border }]}>
                  <View style={styles.profileCopy}>
                    <Text style={{ color: t.text, fontWeight: '700' }}>{profile.name}</Text>
                    <Mono dim size={11}>
                      {profile.host}:{profile.port} · {profile.transport} · {profile.version}
                    </Mono>
                    <Label tone="dim" size={10}>
                      {profile.lastUsedAt
                        ? `Last used ${new Date(profile.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
                    </Label>
                  </View>
                  <Row style={styles.wrap}>
                    <Button
                      title="Edit"
                      small
                      disabled={deletingId === profile.id}
                      onPress={() => {
                        setEditingId(profile.id);
                        setEditor(editAgentProfile(profile));
                        setError(null);
                        setEditorOpen(true);
                      }}
                    />
                    <Button
                      title="Test"
                      small
                      variant="ghost"
                      loading={testingId === profile.id}
                      loadingTitle="Testing…"
                      disabled={testingId !== null || deletingId === profile.id}
                      onPress={() => void runTest(profile.id)}
                    />
                    <Button
                      title="Delete"
                      small
                      variant="danger"
                      loading={deletingId === profile.id}
                      loadingTitle="Deleting…"
                      disabled={deletingId !== null || testingId === profile.id}
                      onPress={() => remove(profile)}
                    />
                  </Row>
                  {testState?.profileId === profile.id ? (
                    testState.error ? (
                      <View style={[styles.result, { borderColor: t.error }]}>
                        <Label tone="error">{testState.error}</Label>
                      </View>
                    ) : testState.result ? (
                      <View style={[styles.result, { borderColor: t.ok }]}>
                        <Label tone="ok">
                          Connection succeeded · {testState.result.latencyMs} ms
                        </Label>
                        {testState.result.varbinds.map((varbind) => (
                          <Mono key={varbind.oid} size={11}>
                            {varbind.name ?? varbind.oid} = {String(varbind.value)}
                          </Mono>
                        ))}
                      </View>
                    ) : null
                  ) : null}
                </View>
              ))
            )}
          </Card>
        ) : null}

        {showGroups ? (
          <Card style={styles.card}>
            <SectionTitle>Agent groups</SectionTitle>
            <Field label="Group name" value={groupName} onChangeText={setGroupName} />
            {!profiles.length ? (
              <Label tone="dim">Create a saved profile here before assembling a group.</Label>
            ) : null}
            <Row style={styles.wrap}>
              {profiles.map((profile) => (
                <Chip
                  key={profile.id}
                  label={profile.name}
                  active={groupMembers.includes(profile.id)}
                  onPress={() =>
                    setGroupMembers((current) =>
                      current.includes(profile.id)
                        ? current.filter((id) => id !== profile.id)
                        : [...current, profile.id],
                    )
                  }
                />
              ))}
            </Row>
            {!groupMembers.length ? (
              <Label tone="warn" size={11}>
                Select at least one saved profile before creating a group.
              </Label>
            ) : null}
            <Button
              title="Create group"
              small
              disabled={!groupName.trim() || !groupMembers.length || collectionBlocked}
              onPress={() =>
                void collections
                  .createGroup({ name: groupName, agentIds: groupMembers }, ownsEngine)
                  .then(async () => {
                    if (!ownsEngine()) return;
                    setGroupName('');
                    setGroupMembers([]);
                    await refreshGroups();
                  })
                  .catch((caught) => {
                    if (!ownsEngine()) return;
                    useAppStore.getState().pushToast({
                      tone: 'error',
                      message: caught instanceof Error ? caught.message : String(caught),
                    });
                  })
              }
            />
            {groups.map((group) => (
              <View key={group.id} style={[styles.groupRow, { borderColor: t.border }]}>
                <View style={styles.profileCopy}>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{group.name}</Text>
                  <Label tone="dim" size={11}>
                    {group.agentIds.length} agents
                  </Label>
                </View>
                <Button
                  title="Delete"
                  small
                  variant="danger"
                  disabled={collectionBlocked}
                  onPress={() =>
                    void collections
                      .deleteGroup(group.id, ownsEngine)
                      .then(refreshGroups)
                      .catch((caught) => {
                        if (!ownsEngine()) return;
                        useAppStore.getState().pushToast({
                          tone: 'error',
                          message: caught instanceof Error ? caught.message : String(caught),
                        });
                      })
                  }
                />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
      <AgentProfileDialog
        visible={editorOpen}
        editing={Boolean(editingId)}
        editor={editor}
        error={error}
        info={info}
        busy={editorBusy || collectionBlocked}
        onEditorChange={setEditor}
        onSubmit={() => void save()}
        onClose={closeEditor}
      />
      <Dialog
        visible={Boolean(deleteCandidate)}
        title="Delete agent profile?"
        subtitle={deleteCandidate?.name}
        scrollable={false}
        dismissable={deletingId === null}
        onRequestClose={() => {
          if (deletingId === null) setDeleteCandidate(null);
        }}
        footer={
          <>
            <Button
              title="Cancel"
              variant="ghost"
              disabled={deletingId !== null}
              onPress={() => setDeleteCandidate(null)}
            />
            <Button
              title="Delete"
              variant="danger"
              loading={deletingId !== null}
              loadingTitle="Deleting…"
              onPress={() => {
                if (deleteCandidate) void confirmDeleteProfile(deleteCandidate);
              }}
            />
          </>
        }
      >
        <Label tone="warn">
          This removes the saved target and its encrypted credentials. Agent groups will be
          refreshed automatically.
        </Label>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  content: { padding: 14, paddingBottom: 40, maxWidth: 1050, width: '100%', alignSelf: 'center' },
  card: { marginBottom: 14 },
  sectionTabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    gap: 3,
  },
  sectionTab: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  sectionTabText: { fontSize: 12, fontWeight: '800' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileRow: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8, gap: 8 },
  profileCopy: { flex: 1, minWidth: 180, gap: 2 },
  groupRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  result: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10, gap: 4 },
  wrap: { flexWrap: 'wrap' },
  stack: { gap: 8 },
});
