const FILE_STORAGE_NODE_TYPES = new Set([
  'file-storage-upload',
  'file-storage-list',
  'file-storage-get-details',
  'file-storage-delete',
])

export const needsRuntimeStorageRoute = (usedNodeTypes: Set<string>): boolean => {
  for (const nt of usedNodeTypes) {
    if (FILE_STORAGE_NODE_TYPES.has(nt)) {
      return true
    }
  }
  return false
}

export const generateRuntimeStorageUploadRoute = (): string => {
  return `var RUNTIME_STORAGE_URL = process.env.RUNTIME_STORAGE_URL;
var RUNTIME_STORAGE_API_KEY = process.env.RUNTIME_STORAGE_API_KEY;
var RUNTIME_STORAGE_PROJECT_ID = process.env.RUNTIME_STORAGE_PROJECT_ID;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!RUNTIME_STORAGE_URL || !RUNTIME_STORAGE_API_KEY || !RUNTIME_STORAGE_PROJECT_ID) {
    res.status(500).json({ error: 'Runtime storage is not configured' });
    return;
  }

  try {
    var targetUrl = RUNTIME_STORAGE_URL + '/project/' + RUNTIME_STORAGE_PROJECT_ID + '/upload';

    var headers = {
      'Authorization': 'Bearer ' + RUNTIME_STORAGE_API_KEY,
    };

    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }
    if (req.headers['content-length']) {
      headers['content-length'] = req.headers['content-length'];
    }

    var storageRes = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: req,
      duplex: 'half',
    });

    var data = await storageRes.json();
    res.status(storageRes.status).json(data);
  } catch (err) {
    console.error('Runtime storage upload proxy error:', err);
    res.status(500).json({ error: 'Upload proxy failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
`
}
