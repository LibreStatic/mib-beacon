import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Field,
  Label,
  Mono,
  Pill,
  Row,
  SectionTitle,
  useTheme,
} from '@mibbeacon/ui';
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
import { InlineAgentProfileSetup } from '../components/InlineAgentProfileSetup';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
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
    setTestResult(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = agentDraftFromEditor(editor);
      if (editingId) await engine.agents.update(editingId, draft);
      else await engine.agents.create(draft);
      await refreshAgentProfiles(engine);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (id: string) => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      setTestResult(await engine.agents.test(id));
      await refreshAgentProfiles(engine);
    } catch (caught) {
      const detail = caught as { message?: string; hint?: string };
      setError(`${detail.message ?? String(caught)}${detail.hint ? ` — ${detail.hint}` : ''}`);
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
            if (editingId === profile.id) reset();
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
            <Button title="New profile" small variant="ghost" onPress={reset} />
          </View>
          {profiles.length === 0 ? (
            <Label tone="dim">No saved profiles yet.</Label>
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
                      setTestResult(null);
                    }}
                  />
                  <Button title="Delete" small variant="danger" onPress={() => remove(profile)} />
                </Row>
              </View>
            ))
          )}
          {testResult ? (
            <View style={[styles.result, { borderColor: t.ok }]}>
              <Label tone="ok">Connection succeeded · {testResult.latencyMs} ms</Label>
              {testResult.varbinds.map((varbind) => (
                <Mono key={varbind.oid} size={11}>
                  {varbind.name ?? varbind.oid} = {String(varbind.value)}
                </Mono>
              ))}
            </View>
          ) : null}
        </Card>

        <InlineAgentProfileSetup
          editor={editor}
          error={error}
          editing={Boolean(editingId)}
          info={info}
          busy={busy}
          onCancel={editingId ? reset : undefined}
          onEditorChange={setEditor}
          onSubmit={() => void save()}
        />

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
