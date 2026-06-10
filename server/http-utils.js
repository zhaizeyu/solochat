export function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
  return true;
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON 格式无效'));
      }
    });
    req.on('error', reject);
  });
}
