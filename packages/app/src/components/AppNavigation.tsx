import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Text, useTheme } from '@mibbeacon/ui';
import type { EngineInfo } from '@mibbeacon/core/client';
import type { NavigationTab } from '../navigation';
import type { Tab } from '../store';
import { MibBeaconMark } from './MibBeaconMark';
import { PacketActivityLights } from './PacketConsole';

export const NAVIGATION_ITEM_MIN_HEIGHT = 46;
export const NAVIGATION_ACTION_MIN_HEIGHT = 42;

function NavigationItem({
  item,
  active,
  expanded,
  badgeCount,
  onPress,
  onLayout,
  onHoverChange,
}: {
  item: NavigationTab;
  active: boolean;
  expanded: boolean;
  badgeCount?: number;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const t = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onLayout={onLayout}
      onHoverIn={() => {
        setHovered(true);
        onHoverChange(true);
      }}
      onHoverOut={() => {
        setHovered(false);
        onHoverChange(false);
      }}
      style={({ pressed }) => [
        styles.navItem,
        expanded ? styles.navItemExpanded : styles.navItemRail,
        {
          backgroundColor: active
            ? t.components.selected.background
            : hovered || pressed
              ? t.components.hover.background
              : 'transparent',
          borderColor: active
            ? t.components.selected.border
            : hovered || pressed
              ? t.components.hover.border
              : 'transparent',
        },
      ]}
    >
      <View style={styles.navGlyphWrap}>
        <Text
          style={[
            styles.navGlyph,
            {
              color: active
                ? t.components.selected.icon
                : hovered
                  ? t.components.hover.icon
                  : expanded
                    ? t.workbench.sideBarForeground
                    : t.workbench.activityBarForeground,
            },
          ]}
        >
          {item.glyph}
        </Text>
        {badgeCount ? (
          <View style={[styles.badge, { backgroundColor: t.components.badge.background }]}>
            <Text style={[styles.badgeText, { color: t.components.badge.foreground }]}>
              {badgeCount > 99 ? '99+' : badgeCount}
            </Text>
          </View>
        ) : null}
      </View>
      {expanded ? (
        <Text
          style={[
            styles.navLabel,
            {
              color: active
                ? t.components.selected.foreground
                : hovered
                  ? t.components.hover.foreground
                  : t.workbench.sideBarForeground,
            },
          ]}
        >
          {item.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function AppNavigation({
  tabs,
  expanded,
  tab,
  trapCount,
  info,
  onSelect,
  onNewWindow,
  onCommands,
  onShortcuts,
}: {
  tabs: NavigationTab[];
  expanded: boolean;
  tab: Tab;
  trapCount: number;
  info: EngineInfo | null;
  onSelect: (tab: Tab) => void;
  onNewWindow?: () => void;
  onCommands: () => void;
  onShortcuts: () => void;
}) {
  const t = useTheme();
  const [scrollRegionY, setScrollRegionY] = useState(0);
  const [scrollOffsetY, setScrollOffsetY] = useState(0);
  const [itemLayouts, setItemLayouts] = useState<Record<string, { y: number; height: number }>>({});
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const hoveredLayout = hoveredLabel ? itemLayouts[hoveredLabel] : undefined;
  const tooltipTop = hoveredLayout
    ? scrollRegionY + hoveredLayout.y - scrollOffsetY + (hoveredLayout.height - 36) / 2
    : null;
  return (
    <View
      nativeID={expanded ? 'app-sidebar-navigation' : 'app-rail-navigation'}
      style={[
        styles.sidebar,
        expanded ? styles.sidebarExpanded : styles.sidebarRail,
        {
          backgroundColor: expanded
            ? t.workbench.sideBarBackground
            : t.workbench.activityBarBackground,
          borderRightColor: t.workbench.panelBorder,
        },
      ]}
    >
      <View style={expanded ? styles.brandLockup : styles.brandRail}>
        <MibBeaconMark size={38} />
        {expanded ? (
          <View style={styles.brandCopy}>
            <Text style={[styles.brandTitle, { color: t.workbench.sideBarForeground }]}>
              MIB Beacon
            </Text>
            <Text style={[styles.brandKicker, { color: t.textDim }]}>Network workbench</Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        nativeID="app-navigation-scroll-region"
        accessibilityLabel="Workbench navigation and actions"
        style={styles.navigationScroll}
        contentContainerStyle={styles.navigationScrollContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
        scrollEventThrottle={16}
        onLayout={(event) => setScrollRegionY(event.nativeEvent.layout.y)}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) =>
          setScrollOffsetY(event.nativeEvent.contentOffset.y)
        }
        onScrollBeginDrag={() => setHoveredLabel(null)}
      >
        <View style={styles.navItems}>
          {tabs.map((item) => (
            <NavigationItem
              key={item.key}
              item={item}
              active={item.key === tab}
              expanded={expanded}
              badgeCount={item.key === 'traps' ? trapCount : undefined}
              onPress={() => onSelect(item.key)}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                setItemLayouts((current) => {
                  const previous = current[item.label];
                  if (previous?.y === y && previous.height === height) return current;
                  return { ...current, [item.label]: { y, height } };
                });
              }}
              onHoverChange={(hovered) => setHoveredLabel(hovered ? item.label : null)}
            />
          ))}
        </View>
        <View style={styles.sidebarFooter}>
          <View style={styles.packetLightsDesktop}>
            <PacketActivityLights compact={!expanded} />
          </View>
          <NavigationAction
            label="Command palette"
            glyph="⌘"
            expanded={expanded}
            onPress={onCommands}
          />
          <NavigationAction
            label="Keyboard shortcuts"
            glyph="?"
            expanded={expanded}
            onPress={onShortcuts}
          />
          {onNewWindow ? (
            <NavigationAction
              label="New window"
              glyph="＋"
              expanded={expanded}
              onPress={onNewWindow}
            />
          ) : null}
          {expanded && info ? (
            <View style={[styles.engineStatus, { borderTopColor: t.border }]}>
              <View style={[styles.statusDot, { backgroundColor: t.ok }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.engineTitle, { color: t.text }]}>Engine ready</Text>
                <Text style={[styles.engineMeta, { color: t.textDim }]} numberOfLines={1}>
                  {info.platform} · net-snmp {info.netSnmpVersion}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {!expanded && hoveredLabel && tooltipTop !== null ? (
        <View
          nativeID="app-navigation-rail-tooltip"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.navTooltip,
            { top: tooltipTop, backgroundColor: t.surfaceAlt, borderColor: t.border },
          ]}
        >
          <Text style={[styles.navTooltipText, { color: t.text }]}>{hoveredLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

function NavigationAction({
  label,
  glyph,
  expanded,
  onPress,
}: {
  label: string;
  glyph: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationAction,
        expanded ? styles.navItemExpanded : styles.navItemRail,
        { backgroundColor: pressed ? t.surfaceAlt : 'transparent', borderColor: t.border },
      ]}
    >
      <Text style={[styles.navigationActionGlyph, { color: t.accent }]}>{glyph}</Text>
      {expanded ? (
        <Text style={[styles.navLabel, { color: t.text }]}>
          {label === 'Command palette'
            ? 'Commands'
            : label === 'Keyboard shortcuts'
              ? 'Shortcuts'
              : label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    borderRightWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 0,
    zIndex: 1,
  },
  sidebarExpanded: { width: 220, paddingHorizontal: 10 },
  sidebarRail: { width: 64, paddingHorizontal: 7 },
  brandLockup: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 5,
  },
  brandRail: { marginBottom: 14 },
  brandCopy: { flex: 1, minWidth: 0 },
  brandTitle: { fontSize: 15, fontWeight: '800' },
  brandKicker: { fontSize: 8, fontWeight: '800', letterSpacing: 1.15, marginTop: 2 },
  navigationScroll: { flex: 1, minHeight: 0, alignSelf: 'stretch' },
  navigationScrollContent: { flexGrow: 1, overflow: 'visible' },
  navItems: { flexGrow: 1, flexShrink: 0, alignSelf: 'stretch', gap: 5 },
  navItem: {
    minHeight: NAVIGATION_ITEM_MIN_HEIGHT,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navItemExpanded: { borderRadius: 9, paddingHorizontal: 12, gap: 11 },
  navItemRail: { borderRadius: 10, justifyContent: 'center', paddingHorizontal: 0 },
  navGlyphWrap: { width: 26, alignItems: 'center' },
  navGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  navTooltip: {
    position: 'absolute',
    left: 64,
    minHeight: 36,
    minWidth: 96,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  navTooltipText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  navLabel: { fontSize: 13, fontWeight: '700' },
  sidebarFooter: { flexShrink: 0, alignSelf: 'stretch', gap: 8, marginTop: 12 },
  packetLightsDesktop: { minHeight: 22, alignItems: 'center', justifyContent: 'center' },
  navigationAction: {
    minHeight: NAVIGATION_ACTION_MIN_HEIGHT,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navigationActionGlyph: { width: 26, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  engineStatus: {
    borderTopWidth: 1,
    paddingHorizontal: 5,
    paddingTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  engineTitle: { fontSize: 10, fontWeight: '700' },
  engineMeta: { fontSize: 9, marginTop: 1 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -12,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
