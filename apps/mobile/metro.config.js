// Metro config: monorepo-aware + Node-builtin aliasing so node-net-snmp's
// internal require('dgram')/require('crypto')/... resolve to React Native
// equivalents. See docs/plans/01-architecture.md §Metro aliasing.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo and resolve hoisted deps from the root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// Map Node core modules used by net-snmp to RN backends / polyfills.
const empty = path.resolve(projectRoot, 'shims/empty.js');
config.resolver.extraNodeModules = {
  dgram: require.resolve('react-native-udp'),
  net: require.resolve('react-native-tcp-socket'),
  tls: require.resolve('react-native-tcp-socket'),
  crypto: require.resolve('react-native-quick-crypto'),
  buffer: require.resolve('buffer'),
  stream: require.resolve('readable-stream'),
  events: require.resolve('events'),
  // net-snmp's MIB module reader pulls fs/path; not used on mobile in the spike.
  fs: empty,
  path: empty,
};

module.exports = config;
