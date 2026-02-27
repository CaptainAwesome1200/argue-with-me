const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !system) return res.status(400).json({ error: 'Missing fields' });
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('Argue With Me running on http://localhost:' + PORT);
});


