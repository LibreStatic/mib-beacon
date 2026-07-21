import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { Button, Label, Row } from '@mibbeacon/ui';
import type { EngineAPI } from '@mibbeacon/core/client';
import {
  agentCollectionStatusText,
  agentPersistentCollectionsController,
} from '../agent-persistent-collections';

export function AgentCollectionRecovery({
  engine,
  owns,
}: {
  engine: EngineAPI;
  owns: () => boolean;
}) {
  const controller = agentPersistentCollectionsController(engine, owns);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  if (snapshot.phase === 'confirmed') return null;
  const blocked = ['error-reverted', 'uncertain', 'conflict'].includes(snapshot.phase);
  return (
    <View accessibilityLiveRegion="polite">
      <Label
        tone={
          snapshot.phase === 'error-reverted' || snapshot.phase === 'conflict' ? 'error' : 'dim'
        }
      >
        {agentCollectionStatusText(snapshot)}
      </Label>
      {blocked ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Button
            title="Reconcile agents"
            small
            variant="ghost"
            onPress={() => void controller.reconcile().catch(() => undefined)}
          />
          {snapshot.phase === 'error-reverted' ? (
            <Button
              title="Acknowledge and re-enter"
              small
              variant="ghost"
              onPress={() => controller.acknowledge()}
            />
          ) : snapshot.canAcknowledgeUncertainty ? (
            <Button
              title="Acknowledge uncertainty"
              small
              variant="ghost"
              onPress={() => controller.acknowledgeUncertainty()}
            />
          ) : snapshot.phase === 'conflict' ? (
            <Button
              title="Acknowledge conflict"
              small
              variant="ghost"
              onPress={() => controller.acknowledge()}
            />
          ) : null}
        </Row>
      ) : null}
    </View>
  );
}
