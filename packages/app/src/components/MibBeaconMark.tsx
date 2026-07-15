import { SvgXml } from 'react-native-svg';
import { MIB_BEACON_MARK_SVG } from '../mib-beacon-mark';

export function MibBeaconMark({ size = 38 }: { size?: number }) {
  return (
    <SvgXml xml={MIB_BEACON_MARK_SVG} width={size} height={size} accessibilityLabel="MIB Beacon" />
  );
}
