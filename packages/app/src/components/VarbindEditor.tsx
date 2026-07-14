import { View, Text, StyleSheet } from 'react-native';
import { Button, Chip, Field, Label, Row, useTheme } from '@mibbeacon/ui';
import { validateVarbindInput } from '@mibbeacon/core/client';
import type { MibNodeDetail, SnmpVarbindInput, SnmpWireType } from '@mibbeacon/core/client';
import { bitIsSelected, mibRangeError, toggleBitHex } from '../mib-set-editor';

const TYPES: SnmpWireType[] = [
  'Integer',
  'OctetString',
  'ObjectIdentifier',
  'IpAddress',
  'Counter',
  'Gauge',
  'TimeTicks',
  'Opaque',
  'Counter64',
];

export function VarbindEditor({
  value,
  onChange,
  onRemove,
  compact,
  metadata,
}: {
  value: SnmpVarbindInput;
  onChange: (patch: Partial<SnmpVarbindInput>) => void;
  onRemove?: () => void;
  compact?: boolean;
  metadata?: MibNodeDetail | null;
}) {
  const t = useTheme();
  const binary = value.type === 'OctetString' || value.type === 'Opaque';
  const validationError = validateVarbindInput(value) ?? mibRangeError(metadata, value.value);
  const isBits = /^BITS\b/i.test(metadata?.syntax ?? '');
  return (
    <View style={[styles.editor, { borderColor: t.border, backgroundColor: t.surfaceAlt }]}>
      <Row style={styles.head}>
        <Text style={[styles.title, { color: t.textDim }]}>Typed varbind</Text>
        {onRemove ? <Button title="Remove" small variant="danger" onPress={onRemove} /> : null}
      </Row>
      <Field
        label="OID"
        value={value.oid}
        placeholder="1.3.6.1…"
        onChangeText={(oid) => onChange({ oid })}
      />
      <Label tone="dim" size={11}>
        Wire type
      </Label>
      <Row style={styles.types}>
        {TYPES.map((type) => (
          <Chip
            key={type}
            label={type === 'ObjectIdentifier' ? 'OID' : type}
            active={value.type === type}
            onPress={() => onChange({ type })}
          />
        ))}
      </Row>
      {metadata?.enumValues && !isBits ? (
        <>
          <Label tone="dim" size={11}>MIB enum values</Label>
          <Row style={styles.types}>
            {Object.entries(metadata.enumValues).map(([label, number]) => (
              <Chip
                key={label}
                label={`${label} (${number})`}
                active={value.value === String(number)}
                onPress={() => onChange({ type: 'Integer', value: String(number) })}
              />
            ))}
          </Row>
        </>
      ) : null}
      {isBits && metadata?.enumValues ? (
        <>
          <Label tone="dim" size={11}>BITS values</Label>
          <Row style={styles.types}>
            {Object.entries(metadata.enumValues).map(([label, position]) => (
              <Chip
                key={label}
                label={label}
                active={bitIsSelected(value.value, position)}
                onPress={() =>
                  onChange({
                    type: 'OctetString',
                    encoding: 'hex',
                    value: toggleBitHex(value.value, position),
                  })
                }
              />
            ))}
          </Row>
        </>
      ) : null}
      {metadata?.displayHint ? (
        <Label tone="dim" size={11}>DISPLAY-HINT input: {metadata.displayHint}</Label>
      ) : null}
      {binary ? (
        <Row>
          <Chip
            label="Text"
            active={(value.encoding ?? 'text') === 'text'}
            onPress={() => onChange({ encoding: 'text' })}
          />
          <Chip
            label="Hex bytes"
            active={value.encoding === 'hex'}
            onPress={() => onChange({ encoding: 'hex' })}
          />
        </Row>
      ) : null}
      <Field
        label="Value"
        value={value.value}
        multiline={!compact && (value.type === 'OctetString' || value.type === 'Opaque')}
        placeholder={
          value.encoding === 'hex'
            ? 'de ad be ef'
            : value.type === 'IpAddress'
              ? '192.0.2.1'
              : 'Value'
        }
        onChangeText={(next) => onChange({ value: next })}
      />
      {validationError ? (
        <Label tone="error" size={11}>
          {validationError}
        </Label>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  head: { justifyContent: 'space-between' },
  title: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  types: { flexWrap: 'wrap' },
});
