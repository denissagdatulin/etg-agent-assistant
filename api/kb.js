const fs = require('node:fs/promises');
const path = require('node:path');

const KB_ROOT = path.join(process.cwd(), 'knowledge_base');
const ALLOWED_EXTENSIONS = new Set(['.md', '.json']);

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  const expectedToken = process.env.KB_TOKEN;

  if (!expectedToken) {
    return json(res, 500, { error: 'KB_TOKEN is not configured on the server.' });
  }

  if (req.headers['x-kb-token'] !== expectedToken) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const file = Array.isArray(req.query.file) ? req.query.file[0] : req.query.file;
  if (!file) {
    return json(res, 400, { error: 'Missing "file" query parameter.' });
  }

  const normalizedPath = path.posix.normalize(String(file)).replace(/^(\.\.(\/|\\|$))+/, '');
  const extension = path.posix.extname(normalizedPath);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return json(res, 400, { error: 'Unsupported file type.' });
  }

  const resolvedPath = path.resolve(KB_ROOT, normalizedPath);
  if (!resolvedPath.startsWith(`${KB_ROOT}${path.sep}`) && resolvedPath !== KB_ROOT) {
    return json(res, 400, { error: 'Invalid file path.' });
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf8');
    const contentType = extension === '.json'
      ? 'application/json; charset=utf-8'
      : 'text/markdown; charset=utf-8';

    res.status(200).setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return json(res, 404, { error: 'KB file not found.' });
    }

    return json(res, 500, { error: 'Failed to load KB file.' });
  }
};
