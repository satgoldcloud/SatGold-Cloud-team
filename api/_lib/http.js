export function send(res, status, body) {
  res.status(status).json(body);
}

export function method(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    send(res, 405, { error: 'Method not allowed.' });
    return false;
  }
  return true;
}

export function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

