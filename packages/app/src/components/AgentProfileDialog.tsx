import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Label } from '@mibbeacon/ui';
import type { EngineInfo } from '@mibbeacon/core/client';
import type { AgentEditorState } from '../agent-profile-form';
import { AgentProfileFormFields } from './AgentProfileFormFields';

interface AgentProfileDialogProps {
  visible: boolean;
  editing?: boolean;
  editor: AgentEditorState;
  info: EngineInfo | null;
  busy?: boolean;
  error?: string | null;
  title?: string;
  subtitle?: string;
  submitTitle?: string;
  onEditorChange: (next: AgentEditorState) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/** SNMP agent profile create/edit form presented as an overlay dialog. */
export function AgentProfileDialog({
  visible,
  editing = false,
  editor,
  info,
  busy = false,
  error = null,
  title,
  subtitle,
  submitTitle,
  onEditorChange,
  onSubmit,
  onClose,
}: AgentProfileDialogProps) {
  return (
    <Dialog
      visible={visible}
      onRequestClose={onClose}
      title={title ?? (editing ? 'Edit profile' : 'Add profile')}
      subtitle={subtitle}
      dismissable={!busy}
      footer={
        <>
          {error ? (
            <View style={styles.footerMessage}>
              <Label tone="error">{error}</Label>
            </View>
          ) : null}
          <Button title="Cancel" variant="ghost" onPress={onClose} />
          <Button
            title={submitTitle ?? (editing ? 'Save changes' : 'Create profile')}
            disabled={busy}
            onPress={onSubmit}
          />
        </>
      }
    >
      <AgentProfileFormFields
        editor={editor}
        editing={editing}
        info={info}
        onEditorChange={onEditorChange}
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  footerMessage: { flexBasis: '100%', flexShrink: 1 },
});
