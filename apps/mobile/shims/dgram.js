// dgram shim for React Native (Metro aliases 'dgram' -> this file).
//
// node-net-snmp uses Node's dgram, which auto-binds a socket on first send.
// react-native-udp instead THROWS ERR_SOCKET_BAD_PORT if send() is called on an
// unbound socket, and net-snmp only binds its client socket when a sourcePort is
// configured. This shim restores Node's behavior: auto-bind to an ephemeral port
// on the first send (queuing sends until the bind completes), while leaving an
// explicit bind() — as the trap receiver does — untouched.
const rnUdp = require('react-native-udp');
const UdpSockets = rnUdp.default || rnUdp;

function createSocket(options) {
  const opts = typeof options === 'string' ? { type: options } : options || { type: 'udp4' };
  const socket = UdpSockets.createSocket(opts);

  const _bind = socket.bind.bind(socket);
  const _send = socket.send.bind(socket);
  let state = 'unbound'; // 'unbound' | 'binding' | 'bound'
  const pending = [];

  socket.bind = function (...args) {
    state = 'bound'; // explicit bind (e.g. trap receiver)
    return _bind(...args);
  };

  socket.send = function (...args) {
    if (state === 'bound') return _send(...args);
    pending.push(args);
    if (state === 'unbound') {
      state = 'binding';
      _bind(0, () => {
        state = 'bound';
        for (const a of pending.splice(0)) _send(...a);
      });
    }
  };

  return socket;
}

module.exports = { createSocket };
module.exports.default = module.exports;
