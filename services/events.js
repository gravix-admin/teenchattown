const clients = new Map();

function addClient(userId, res) {
  clients.set(res, { userId });
  res.write("event: ready\ndata: true\n\n");
}

function removeClient(res) {
  clients.delete(res);
}

function send(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload, filter = null) {
  for (const [res, meta] of clients.entries()) {
    if (!filter || filter(meta)) send(res, event, payload);
  }
}

function notifyUser(userId, event, payload) {
  broadcast(event, payload, (meta) => Number(meta.userId) === Number(userId));
}

module.exports = { addClient, removeClient, broadcast, notifyUser };
