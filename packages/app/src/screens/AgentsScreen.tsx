import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Card, Chip, Field, Label, Mono, Pill, Row, SectionTitle, Text, useTheme } from '@mibbeacon/ui';
import type {
  AgentGroup,
  AgentProfile,
  AgentTestResult,
  EngineInfo,
} from '@mibbeacon/core/client';
import { useEngine } from '../engine-context';
import { refreshAgentProfiles } from '../actions';
import { useAppStore } from '../store';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { AgentProfileDialog } from '../components/AgentProfileDialog';
import {
  agentDraftFromEditor,
  editAgentProfile,
  EMPTY_AGENT_EDITOR,
} from '../agent-profile-form';

export function AgentsScreen({ info }: { info: EngineInfo | null }) {
  const engine = useEngine();
  const t = useTheme();
  const profiles = useAppStore((state) => state.agentProfiles);
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState(EMPTY_AGENT_EDITOR);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<{
    profileId: string;
    result: AgentTestResult | null;
    error: string | null;
  } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);

  const refreshGroups = useCallback(async () => {
    const next = await engine.agents.groups.list();
    setGroups(next);
    useAppStore.getState().setAgentGroups(next);
  }, [engine]);
  useEffect(() => {
    void refreshAgentProfiles(engine);
    void refreshGroups();
  }, [engine, refreshGroups]);

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
    setBusy(true);
    setError(null);
    try {
      const draft = agentDraftFromEditor(editor);
      if (editingId) await engine.agents.update(editingId, draft);
      else await engine.agents.create(draft);
      await refreshAgentProfiles(engine);
      useAppStore.getState().pushToast({
        tone: 'success',
        message: editingId ? 'Profile saved' : 'Profile created',
      });
      closeEditor();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      useAppStore.getState().pushToast({ tone: 'error', message });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (id: string) => {
    setBusy(true);
    setTestState(null);
    try {
      const result = await engine.agents.test(id);
      setTestState({ profileId: id, result, error: null });
      await refreshAgentProfiles(engine);
    } catch (caught) {
      const detail = caught as { message?: string; hint?: string };
      setTestState({
        profileId: id,
        result: null,
        error: `${detail.message ?? String(caught)}${detail.hint ? ` — ${detail.hint}` : ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = (profile: AgentProfile) =>
    Alert.alert('Delete agent profile?', `${profile.name} and its saved credentials will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void engine.agents.delete(profile.id).then(async () => {
            await Promise.all([refreshAgentProfiles(engine), refreshGroups()]);
            if (editingId === profile.id) closeEditor();
          }),
      },
    ]);

  return (
    <View style={styles.root}>
      <WorkspaceHeader
        title="Agent profiles"
        subtitle="ENCRYPTED CREDENTIALS · CONNECTION TESTS · REUSABLE GROUPS"
        actions={<Pill text={`${profiles.length} SAVED`} color={t.accent} />}
      />
      <ScrollView contentContainerStyle={styles.content}>
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
                    {profile.lastUsedAt ? `Last used ${new Date(profile.lastUsedAt).toLocaleString()}` : 'Never used'}
                  </Label>
                </View>
                <Row style={styles.wrap}>
                  <Button title="Test" small disabled={busy} onPress={() => void runTest(profile.id)} />
                  <Button
                    title="Edit"
                    small
                    variant="ghost"
                    onPress={() => {
                      setEditingId(profile.id);
                      setEditor(editAgentProfile(profile));
                      setError(null);
                      setEditorOpen(true);
                    }}
                  />
                  <Button title="Delete" small variant="danger" onPress={() => remove(profile)} />
                </Row>
                {testState?.profileId === profile.id ? (
                  testState.error ? (
                    <View style={[styles.result, { borderColor: t.error }]}>
                      <Label tone="error">{testState.error}</Label>
                    </View>
                  ) : testState.result ? (
                    <View style={[styles.result, { borderColor: t.ok }]}>
                      <Label tone="ok">Connection succeeded · {testState.result.latencyMs} ms</Label>
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

        <Card style={styles.card}>
          <SectionTitle>Agent groups</SectionTitle>
          <Field label="Group name" value={groupName} onChangeText={setGroupName} />
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
          <Button
            title="Create group"
            small
            disabled={!groupName.trim()}
            onPress={() =>
              void engine.agents.groups
                .create({ name: groupName, agentIds: groupMembers })
                .then(async () => {
                  setGroupName('');
                  setGroupMembers([]);
                  await refreshGroups();
                })
            }
          />
          {groups.map((group) => (
            <View key={group.id} style={[styles.groupRow, { borderColor: t.border }]}>
              <View style={styles.profileCopy}>
                <Text style={{ color: t.text, fontWeight: '700' }}>{group.name}</Text>
                <Label tone="dim" size={11}>{group.agentIds.length} agents</Label>
              </View>
              <Button title="Delete" small variant="danger" onPress={() => void engine.agents.groups.delete(group.id).then(refreshGroups)} />
            </View>
          ))}
        </Card>
      </ScrollView>
      <AgentProfileDialog
        visible={editorOpen}
        editing={Boolean(editingId)}
        editor={editor}
        error={error}
        info={info}
        busy={busy}
        onEditorChange={setEditor}
        onSubmit={() => void save()}
        onClose={closeEditor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  content: { padding: 14, paddingBottom: 40, maxWidth: 1050, width: '100%', alignSelf: 'center' },
  card: { marginBottom: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileRow: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8, gap: 8 },
  profileCopy: { flex: 1, minWidth: 180, gap: 2 },
  groupRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  result: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10, gap: 4 },
  wrap: { flexWrap: 'wrap' },
  stack: { gap: 8 },
});
