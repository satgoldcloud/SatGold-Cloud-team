import { send, method } from './_lib/http.js';

export default (req, res) => {
  if (!method(req, res, ['GET'])) return;
  return send(res, 200, { status: 'ok', app: process.env.APP_NAME || 'SatGold Cloud', timestamp: new Date().toISOString() });
};
