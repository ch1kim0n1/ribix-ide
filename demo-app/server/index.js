// !! DEMO APP — INTENTIONALLY SIMPLE FOR QA TESTING !!
// This server exists solely so Ribix agents have a target to test against.
// It must NEVER be deployed to production or exposed publicly.
// The bugs below (P0-P3) are deliberate and are used by the agent test suite.
const express = require('express');
const app = express();
app.use(express.json());

// Guard: refuse to start in production-like environments.
if (process.env.NODE_ENV === 'production' || process.env.DEMO_APP_ALLOW_PROD !== '1') {
  console.error('[demo-app] Refusing to start — this app is for local testing only. Set DEMO_APP_ALLOW_PROD=1 to override.');
  process.exit(1);
}

let products = [
  { id: 1, name: 'Widget A', price: 29.99 },
  { id: 2, name: 'Widget B', price: 49.99 },
];

let cart = [];

app.get('/api/products', (req, res) => {
  // BUG P2: no pagination — returns all products with no limit/offset support
  res.json(products);
});

app.post('/api/cart/add', (req, res) => {
  const { productId, quantity } = req.body;
  const product = products.find(p => p.id === productId);
  if (product) {
    cart.push({ ...product, quantity });
    res.json({ success: true, cart });
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

app.post('/api/checkout', (req, res) => {
  try {
    // BUG P0: crashes when cart is empty — reduce with no initial value on empty array throws TypeError
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity);
    cart = [];
    res.json({ success: true, orderId: Math.random().toString(36).substr(2, 9), total });
  } catch (err) {
    // BUG P3: exposes full stack trace to clients in error responses
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // BUG P1: auth bypass — any password works for the admin account; password is never checked
  if (username === 'admin') {
    res.json({ token: 'admin-token-12345', role: 'admin' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.listen(3001, () => console.log('Demo server on http://localhost:3001 (LOCAL TESTING ONLY)'));
