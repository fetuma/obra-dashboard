const express = require('express');
const jwt     = require('jsonwebtoken');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: ['https://www.fc.arq.br', 'http://localhost'] }));

const JWT_SECRET = process.env.JWT_SECRET;
const PORT       = process.env.PORT || 3000;

// Carrega clientes das env vars:
// CLIENT_0_USER, CLIENT_0_PASS, CLIENT_0_SCRIPT_URL
// CLIENT_1_USER, CLIENT_1_PASS, CLIENT_1_SCRIPT_URL ...
function carregarClientes() {
  const clientes = [];
  let i = 0;
  while (process.env[`CLIENT_${i}_USER`]) {
    clientes.push({
      user:      process.env[`CLIENT_${i}_USER`].toLowerCase(),
      pass:      process.env[`CLIENT_${i}_PASS`],
      scriptUrl: process.env[`CLIENT_${i}_SCRIPT_URL`]
    });
    i++;
  }
  return clientes;
}

// POST /login
app.post('/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ erro: 'Dados ausentes' });

  const clientes = carregarClientes();
  const cliente  = clientes.find(c => c.user === user.toLowerCase() && c.pass === pass);
  if (!cliente) return res.status(401).json({ erro: 'Credenciais inválidas' });

  const token = jwt.sign({ scriptUrl: cliente.scriptUrl }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// GET /dados
app.get('/dados', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Token ausente' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  try {
    const r    = await fetch(payload.scriptUrl);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ erro: 'Erro ao buscar dados do Apps Script' });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`StudioFC API na porta ${PORT}`));
