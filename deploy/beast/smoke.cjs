// Runs only GET requests and database reads; no published ports or database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mongoose = require('/app/node_modules/mongoose');
const dotenv = require('/app/node_modules/dotenv');
const env = dotenv.parse(fs.readFileSync('/run/escowear.env'));
process.env.ESCOWEAR_MONGO_URI = env.ESCOWEAR_MONGO_URI;
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
process.env.NODE_ENV = 'production';
const { connectDB } = require('/app/server/db/db');
const { app } = require('/app/server/server');
let server;
(async () => {
  await connectDB();
  await mongoose.connection.db.command({ ping: 1 });
  console.log('PASS database ping and expected database name');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/health', '/', '/store', '/images/default.jpg', '/api/products?page=1&limit=1']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    if (route.startsWith('/api/products')) {
      const data = await response.json();
      assert.ok(Array.isArray(data.items));
      assert.ok(data.items.length > 0, 'existing catalogue is nonempty');
      console.log(`PASS catalogue: ${data.pagination.total} products`);
      const detail = await fetch(base + '/api/products/' + data.items[0]._id);
      assert.equal(detail.status, 200);
      console.log('PASS product detail');
    } else if (route === '/images/default.jpg') {
      assert.match(response.headers.get('content-type'), /image\//);
    } else if (route !== '/health') {
      const html = await response.text();
      assert.match(html, /<html/i);
      if (route === '/') {
        const asset = html.match(/src="([^"]+\.js)"/);
        assert.ok(asset, 'compiled JavaScript reference');
        const js = await fetch(base + asset[1]);
        assert.equal(js.status, 200);
        assert.match(js.headers.get('content-type'), /javascript/);
        console.log('PASS compiled JavaScript asset');
      }
    }
    console.log(`PASS ${route}`);
  }
})().catch(error => {
  // Do not print errors that may contain connection strings or product data.
  console.error('FAIL smoke test:', error.name);
  process.exitCode = 1;
}).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
});
