require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- USAGE TRACKING (in-memory, resets on redeploy) ----
// For production you'd use a database, but this works fine to start
const usageStore = {};

function getUsageKey(ip) {
  const today = new Date().toISOString().split('T')[0];
  return ip + '_' + today;
}

function getUsageCount(ip) {
  return usageStore[getUsageKey(ip)] || 0;
}

function incrementUsage(ip) {
  const key = getUsageKey(ip);
  usageStore[key] = (usageStore[key] || 0) + 1;
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

// ---- CHECK USAGE ----
app.get('/api/usage', (req, res) => {
  const ip = getClientIP(req);
  const count = getUsageCount(ip);
  res.json({ count, limit: 3, remaining: Math.max(0, 3 - count) });
});

// ---- CHAT ENDPOINT ----
app.post('/api/chat', async (req, res) => {
  const { messages, system, proToken, isNewSession } = req.body;
  if (!messages || !system) return res.status(400).json({ error: 'Missing fields' });

  const ip = getClientIP(req);
  const isPro = await verifyProToken(proToken);

  if (!isPro) {
    const count = getUsageCount(ip);
    // Only count usage when a new session starts (first message of a game)
    if (isNewSession) {
      if (count >= 3) {
        return res.status(429).json({ error: 'LIMIT_REACHED', message: 'Daily limit reached' });
      }
      incrementUsage(ip);
    }
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: 1000,
        temperature: 0.9
      })
    });
    const data = await response.json();
    console.log('Groq response:', JSON.stringify(data));
    const text = data.choices[0].message.content;
    res.json({ content: [{ type: 'text', text }] });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- STRIPE: CREATE CHECKOUT SESSION ----
app.post('/api/create-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: (req.headers.origin || 'https://www.banterbox.co') + '/?pro=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (req.headers.origin || 'https://www.banterbox.co') + '/?pro=cancelled',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment setup failed' });
  }
});

// ---- STRIPE: VERIFY SESSION (get customer/subscription ID as pro token) ----
app.post('/api/verify-pro', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing session ID' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid' || session.status === 'complete') {
      const token = session.subscription || session.customer;
      res.json({ valid: true, token });
    } else {
      res.json({ valid: false });
    }
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ---- VERIFY PRO TOKEN (subscription still active) ----
async function verifyProToken(token) {
  if (!token) return false;
  try {
    // Try as subscription ID first
    if (token.startsWith('sub_')) {
      const subscription = await stripe.subscriptions.retrieve(token);
      return subscription.status === 'active';
    }
    // Try as customer ID
    if (token.startsWith('cus_')) {
      const subscriptions = await stripe.subscriptions.list({ customer: token, status: 'active' });
      return subscriptions.data.length > 0;
    }
    return false;
  } catch (err) {
    return false;
  }
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('Banterbox running on http://localhost:' + PORT);
});
