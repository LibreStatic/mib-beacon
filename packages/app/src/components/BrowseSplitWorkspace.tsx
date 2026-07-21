import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, useTheme } from '@mibbeacon/ui';
import {
  BROWSE_CATALOG_SPLIT_MINIMUMS,
  BROWSE_NAVIGATOR_SPLIT_MINIMUMS,
} from '../responsive-layout';
import { ContainerAwareSplitWorkspace } from './SplitWorkspace';

export interface BrowseDrawerControl {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  accessibilityLabel: string;
  openLabel: string;
  closeLabel: string;
}

export function BrowseSplitWorkspace({
  expanded,
  selected,
  moduleStrip,
  catalog,
  navigator,
  inspector,
  treeDrawer,
  catalogDrawer,
}: {
  expanded: boolean;
  selected: boolean;
  moduleStrip: ReactNode;
  catalog: ReactNode;
  navigator: ReactNode;
  inspector: ReactNode;
  treeDrawer: BrowseDrawerControl;
  catalogDrawer: BrowseDrawerControl;
}) {
  const t = useTheme();
  const navigatorPane = (
    <View style={styles.navigatorPane}>
      <View style={expanded ? styles.hidden : null}>{moduleStrip}</View>
      <View style={styles.paneContent}>{navigator}</View>
    </View>
  );
  const browser = (
    <ContainerAwareSplitWorkspace
      workspace="browse"
      {...BROWSE_NAVIGATOR_SPLIT_MINIMUMS}
      inactivePane={selected ? 'secondary' : 'primary'}
      inactiveSecondaryHeader={
        selected ? (
          <View style={[styles.drawerBar, { borderBottomColor: t.border }]}>
            <Button
              title={treeDrawer.openLabel}
              small
              variant="ghost"
              onPress={treeDrawer.onOpen}
            />
          </View>
        ) : undefined
      }
      primaryDrawer={
        selected
          ? {
              open: treeDrawer.open,
              onClose: treeDrawer.onClose,
              accessibilityLabel: treeDrawer.accessibilityLabel,
              closeLabel: treeDrawer.closeLabel,
            }
          : undefined
      }
      primary={navigatorPane}
      secondary={inspector}
    />
  );

  return (
    <ContainerAwareSplitWorkspace
      workspace="mibModules"
      {...BROWSE_CATALOG_SPLIT_MINIMUMS}
      splitEnabled={expanded}
      inactivePane="secondary"
      inactiveSecondaryHeader={
        <View style={[styles.drawerBar, { borderBottomColor: t.border }]}>
          <Button
            title={catalogDrawer.openLabel}
            small
            variant="ghost"
            onPress={catalogDrawer.onOpen}
          />
        </View>
      }
      primaryDrawer={{
        open: catalogDrawer.open,
        onClose: catalogDrawer.onClose,
        accessibilityLabel: catalogDrawer.accessibilityLabel,
        closeLabel: catalogDrawer.closeLabel,
      }}
      primary={catalog}
      secondary={browser}
    />
  );
}

const styles = StyleSheet.create({
  navigatorPane: { flex: 1, minWidth: 0, minHeight: 0 },
  paneContent: { flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: 'none' },
  drawerBar: {
    minHeight: 48,
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
});
