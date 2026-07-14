import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAPI } from '@mibbeacon/core/client';
import { numericOid, prepareSetReview } from './actions';
import { useAppStore } from './store';

describe('multi-varbind Set staging', () => {
  beforeEach(() => {
    useAppStore.setState({
      setDraft: { oid: '1.3.6.1.2.1.1.5.0', type: 'OctetString', value: 'edge' },
      setStaging: [],
      setPreviousValues: [],
      setReview: false,
      queryGroupMode: false,
      selectedAgentId: null,
      agent: { ...useAppStore.getState().agent, host: '127.0.0.1', community: 'private' },
    });
  });

  it('edits and removes independent rows in one staged request', () => {
    const state = useAppStore.getState();
    state.addSetDraftToStaging();
    state.updateSetDraft({ oid: '1.3.6.1.2.1.1.6.0', value: 'lab' });
    state.addSetDraftToStaging();
    state.updateStagedVarbind(1, { value: 'dc-1' });
    expect(useAppStore.getState().setStaging.map(({ value }) => value)).toEqual(['edge', 'dc-1']);
    state.removeStagedVarbind(0);
    expect(useAppStore.getState().setStaging).toMatchObject([
      { oid: '1.3.6.1.2.1.1.6.0', value: 'dc-1' },
    ]);
  });

  it('fetches old values for every staged OID before confirmation', async () => {
    const state = useAppStore.getState();
    state.addSetDraftToStaging();
    state.updateSetDraft({ oid: '1.3.6.1.2.1.1.6.0', value: 'lab' });
    state.addSetDraftToStaging();
    const get = vi.fn().mockResolvedValue([
      { oid: '1.3.6.1.2.1.1.5.0', type: 4, typeName: 'OctetString', value: 'old-name', isError: false },
      { oid: '1.3.6.1.2.1.1.6.0', type: 4, typeName: 'OctetString', value: 'old-place', isError: false },
    ]);

    await prepareSetReview({ ops: { get } } as unknown as EngineAPI);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ oids: ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.6.0'] }),
    );
    expect(useAppStore.getState()).toMatchObject({
      setReview: true,
      setPreviousValues: [{ value: 'old-name' }, { value: 'old-place' }],
    });
  });

  it('accepts symbolic and module-qualified operation targets through MIB translation', async () => {
    const translate = vi.fn().mockResolvedValue({ oid: '1.3.6.1.2.1.1.5.0' });
    await expect(
      numericOid({ mibs: { translate } } as unknown as EngineAPI, 'SNMPv2-MIB::sysName.0'),
    ).resolves.toBe('1.3.6.1.2.1.1.5.0');
    expect(translate).toHaveBeenCalledWith('SNMPv2-MIB::sysName.0');
  });
});
