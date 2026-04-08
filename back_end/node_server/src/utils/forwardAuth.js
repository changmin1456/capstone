function authHeaders(req) {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  return h ? { authorization: h } : {};
}

module.exports = {
  authHeaders,
};
