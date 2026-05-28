export const generateRealtimeServerHelperCode = (): string => {
  return `const REALTIME_SERVER_URL = process.env.REALTIME_SERVER_URL;
const REALTIME_SERVER_API_KEY = process.env.REALTIME_SERVER_API_KEY;

async function realtimeServerFetch(path, options) {
  const url = REALTIME_SERVER_URL + '/api/realtime' + path;
  const mergedHeaders = Object.assign(
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + REALTIME_SERVER_API_KEY },
    (options && options.headers) || {}
  );
  const response = await fetch(url, Object.assign({}, options || {}, { headers: mergedHeaders }));
  return response;
}

module.exports = { realtimeServerFetch: realtimeServerFetch };
`
}

export const generateRealtimeClientCode = (): string => {
  return `const Ably = require('ably');

let _ablyClient = null;
let _namespace = null;
let _userId = null;
let _userName = null;
let _channelRefCounts = {};
let _readyCallbacks = [];
let _isReady = false;

function _notifyReady() {
  _isReady = true;
  const cbs = _readyCallbacks.slice();
  _readyCallbacks = [];
  for (let i = 0; i < cbs.length; i++) cbs[i]();
}

function whenReady() {
  if (_isReady && _namespace) return Promise.resolve();
  return new Promise(function(resolve) { _readyCallbacks.push(resolve); });
}

function _getOrCreateAnonId() {
  if (typeof window === 'undefined') return 'anon_server';
  let id = sessionStorage.getItem('__realtime_anon_id');
  if (!id) {
    id = 'anon_' + (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substr(2, 16));
    sessionStorage.setItem('__realtime_anon_id', id);
  }
  return id;
}

function getUserId() { return _userId || _getOrCreateAnonId(); }
function getUserName() { return _userName || 'Anonymous'; }
function setUser(userId, userName) { _userId = userId; _userName = userName; }
function getNamespace() { return _namespace; }

function getNamespacedChannelName(channelName) {
  if (!_namespace) return channelName;
  return _namespace + ':' + channelName;
}

function _createAuthCallback(initialTokenRequest) {
  let firstToken = initialTokenRequest || null;
  return function(tokenParams, callback) {
    if (firstToken) {
      const t = firstToken;
      firstToken = null;
      callback(null, t);
      return;
    }
    fetch('/api/realtime/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getUserId() })
    }).then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.namespace) _namespace = data.namespace;
        if (data.tokenRequest) {
          if (!_isReady) _notifyReady();
          callback(null, data.tokenRequest);
        } else {
          callback(new Error((data.error && data.error.message) || 'Token request failed'), null);
        }
      }).catch(function(err) { callback(err, null); });
  };
}

function getAblyClient() {
  if (_ablyClient) return _ablyClient;
  if (typeof window === 'undefined') return null;

  _ablyClient = new Ably.Realtime({ authCallback: _createAuthCallback(null) });

  _ablyClient.connection.on('connected', function() {
    if (_namespace && !_isReady) _notifyReady();
  });

  return _ablyClient;
}

function initializeClient(joinData) {
  if (joinData && joinData.namespace) _namespace = joinData.namespace;
  if (_ablyClient) {
    if (_namespace && !_isReady) _notifyReady();
    return _ablyClient;
  }
  if (typeof window === 'undefined') return null;

  const tokenRequest = joinData && joinData.tokenRequest ? joinData.tokenRequest : null;
  _ablyClient = new Ably.Realtime({ authCallback: _createAuthCallback(tokenRequest) });

  _ablyClient.connection.on('connected', function() {
    if (_namespace && !_isReady) _notifyReady();
  });

  return _ablyClient;
}

function closeClient() {
  if (_ablyClient) {
    _ablyClient.close();
    _ablyClient = null;
  }
  _namespace = null;
  _channelRefCounts = {};
  _isReady = false;
  _readyCallbacks = [];
}

function incrementChannelRef(channelName) {
  _channelRefCounts[channelName] = (_channelRefCounts[channelName] || 0) + 1;
  return _channelRefCounts[channelName];
}

function decrementChannelRef(channelName) {
  const count = (_channelRefCounts[channelName] || 1) - 1;
  _channelRefCounts[channelName] = Math.max(0, count);
  return _channelRefCounts[channelName];
}

function getChannelRefCount(channelName) {
  return _channelRefCounts[channelName] || 0;
}

const _exports = {
  getAblyClient: getAblyClient,
  initializeClient: initializeClient,
  closeClient: closeClient,
  whenReady: whenReady,
  getNamespace: getNamespace,
  getNamespacedChannelName: getNamespacedChannelName,
  getUserId: getUserId,
  getUserName: getUserName,
  setUser: setUser,
  incrementChannelRef: incrementChannelRef,
  decrementChannelRef: decrementChannelRef,
  getChannelRefCount: getChannelRefCount
};

if (typeof window !== 'undefined') {
  window.__teleportRealtime = _exports;
  window.addEventListener('beforeunload', function() {
    closeClient();
  });
}

module.exports = _exports;
`
}

export const generateRealtimeTokenRoute = (): string => {
  return `const realtimeServer = require('../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await realtimeServer.realtimeServerFetch('/auth/token', {
      method: 'POST',
      body: JSON.stringify({ userId: body.userId })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime token error:', error);
    res.status(500).json({ error: 'Failed to get realtime token' });
  }
};
`
}

export const generateRealtimeJoinRoute = (): string => {
  return `const realtimeServer = require('../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await realtimeServer.realtimeServerFetch('/channels/join', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime join error:', error);
    res.status(500).json({ error: 'Failed to join channel' });
  }
};
`
}

export const generateRealtimeLeaveRoute = (): string => {
  return `const realtimeServer = require('../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await realtimeServer.realtimeServerFetch('/channels/leave', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime leave error:', error);
    res.status(500).json({ error: 'Failed to leave channel' });
  }
};
`
}

export const generateRealtimeMessageRoute = (): string => {
  return `const realtimeServer = require('../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await realtimeServer.realtimeServerFetch('/channels/message', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};
`
}

export const generateRealtimeEventRoute = (): string => {
  return `const realtimeServer = require('../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const response = await realtimeServer.realtimeServerFetch('/channels/event', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime event error:', error);
    res.status(500).json({ error: 'Failed to send event' });
  }
};
`
}

export const generateRealtimeChannelsListRoute = (): string => {
  return `const realtimeServer = require('../../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let query = '';
    if (body.filterByUser) query += 'filterByUser=true';
    if (body.userId) query += (query ? '&' : '') + 'userId=' + encodeURIComponent(body.userId);
    const response = await realtimeServer.realtimeServerFetch('/channels' + (query ? '?' + query : ''), {
      method: 'GET'
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime list channels error:', error);
    res.status(500).json({ error: 'Failed to list channels' });
  }
};
`
}

export const generateRealtimeChannelsMembersRoute = (): string => {
  return `const realtimeServer = require('../../../../utils/realtime/server');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const channelName = body.channelName;
    if (!channelName) {
      res.status(400).json({ error: 'channelName is required' });
      return;
    }
    const response = await realtimeServer.realtimeServerFetch(
      '/channels/' + encodeURIComponent(channelName) + '/members',
      { method: 'GET' }
    );
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Realtime list members error:', error);
    res.status(500).json({ error: 'Failed to list channel members' });
  }
};
`
}
