// Empty module for Node builtins that net-snmp references but the mobile spike
// does not exercise (fs/path via the MIB module reader). MIB parsing lands in
// plan 03 with a proper RN-compatible reader.
module.exports = {};
