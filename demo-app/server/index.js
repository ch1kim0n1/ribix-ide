const express = require('express');
const app = express();
app.use(express.json());

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

app.listen(3001, () => console.log('Demo server on http://localhost:3001'));
