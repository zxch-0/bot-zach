'use strict';

/**
 * Faux serveur Ollama (API native + API compatible OpenAI) utilisé pour :
 *   • la démo hors-ligne (`npm run demo`)
 *   • les tests automatisés (`npm test`)
 *
 * Il ne charge aucun modèle : il diffuse du texte mot par mot pour imiter
 * le streaming d'un vrai Ollama.
 */

const http = require('node:http');

const MODELS = [
  { name: 'demo:mini', size: 402653184, family: 'llama', parameterSize: '0.5B', quantization: 'Q4_K_M' },
  { name: 'qwen2.5:0.5b', size: 397807360, family: 'qwen2', parameterSize: '0.5B', quantization: 'Q4_K_M' },
  { name: 'llama3.2:1b', size: 1321098329, family: 'llama', parameterSize: '1.2B', quantization: 'Q8_0' },
  { name: 'qwen3:4b', size: 2497152108, family: 'qwen3', parameterSize: '4.0B', quantization: 'Q4_K_M' },
  { name: 'gemma3:4b', size: 3338801804, family: 'gemma3', parameterSize: '4.3B', quantization: 'Q4_K_M' },
  { name: 'deepseek-r1:7b', size: 4680218625, family: 'qwen2', parameterSize: '7.6B', quantization: 'Q4_K_M' },
];

const WORDS_PER_REPLY = 90;

function lastUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function buildReply(prompt, model) {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  const excerpt = clean.length > 220 ? `${clean.slice(0, 220)}…` : clean;
  const wantsCode = /code|javascript|python|fonction|script|fonctionne/i.test(clean);

  const parts = [];
  parts.push('🧪 **(mode démo)** Ce texte est produit par le faux serveur Ollama de `npm run demo` —');
  parts.push('aucun modèle réel n’est chargé. L’interface, le streaming et le rendu markdown sont en revanche authentiques.');
  parts.push('');
  parts.push(`Vous avez écrit : « ${excerpt || '(message vide)'} »`);
  parts.push('');
  parts.push('Pour obtenir de vraies réponses, branchez un vrai Ollama :');
  parts.push('');
  parts.push('1. **Ollama Cloud** — clé gratuite sur `ollama.com/settings/keys`, puis `OLLAMA_CLOUD_API_KEY=…` ;');
  parts.push('2. **Ollama distant** — Colab/VPS + tunnel, puis `OLLAMA_REMOTE_URL=https://…` ;');
  parts.push('3. **Ollama local** — `ollama serve` sur la même machine que ce site.');
  parts.push('');

  if (wantsCode) {
    parts.push('Exemple de bloc de code (bouton « Copier » en haut à droite) :');
    parts.push('');
    parts.push('```js');
    parts.push('const reponse = await fetch("/api/chat", {');
    parts.push('  method: "POST",');
    parts.push('  headers: { "Content-Type": "application/json" },');
    parts.push('  body: JSON.stringify({');
    parts.push(`    model: "${model}",`);
    parts.push('    messages: [{ role: "user", content: "Bonjour !" }],');
    parts.push('  }),');
    parts.push('});');
    parts.push('```');
    parts.push('');
  }

  parts.push('> Astuce : le menu de gauche permet de changer de fournisseur et de modèle sans redémarrer le site.');
  return parts.join('\n');
}

function buildThinking(prompt) {
  const clean = prompt.replace(/\s+/g, ' ').trim().slice(0, 120);
  return [
    `L’utilisateur demande : « ${clean} ».`,
    'Je suis un faux modèle : je vais l’annoncer clairement puis expliquer comment brancher un vrai Ollama.',
    'Je structure la réponse en liste, puis j’ajoute un exemple de code si la demande s’y prête.',
  ].join('\n');
}

/** Découpe le texte en petits morceaux diffusables (≈ du token par token). */
function chunkify(text) {
  const chunks = [];
  const regex = /\s*\S+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    chunks.push(match[0]);
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startMock({ port = 0, host = '127.0.0.1', verbose = false, speed = 1 } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = (req.method || 'GET').toUpperCase();
    const pathname = url.pathname;
    if (verbose) console.log(`  [mock] ${method} ${pathname}`);

    const sendJson = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    const readBody = () =>
      new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
          } catch {
            resolve({});
          }
        });
      });

    const tagsPayload = () => ({
      models: MODELS.map((m) => ({
        name: m.name,
        model: m.name,
        modified_at: new Date(Date.now() - 86400000).toISOString(),
        size: m.size,
        digest: 'demo'.repeat(16),
        details: {
          parent_model: '',
          format: 'gguf',
          family: m.family,
          families: [m.family],
          parameter_size: m.parameterSize,
          quantization_level: m.quantization,
        },
      })),
    });

    if (pathname === '/api/version') return sendJson(200, { version: '0.9.0-demo' });
    if (pathname === '/api/tags') return sendJson(200, tagsPayload());
    if (pathname === '/v1/models') {
      return sendJson(200, {
        object: 'list',
        data: MODELS.map((m) => ({ id: m.name, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'demo' })),
      });
    }

    if (pathname === '/api/pull' && method === 'POST') {
      readBody().then(async (body) => {
        const model = body.model || body.name || 'demo:mini';
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        let closed = false;
        req.on('close', () => { closed = true; });
        const total = 1024 * 1024 * 512;
        const statuses = ['pulling manifest', 'pulling 8934d96d3f08', 'verifying sha256 digest', 'writing manifest', 'success'];
        for (const status of statuses) {
          if (closed) return;
          if (status === 'success') {
            res.write(`${JSON.stringify({ status: 'success', model })}\n`);
            break;
          }
          res.write(`${JSON.stringify({ status })}\n`);
          await sleep(400 / speed);
        }
        for (let progress = 0; progress <= 100; progress += 5) {
          if (closed) return;
          res.write(`${JSON.stringify({ status: 'pulling 8934d96d3f08', digest: 'demo', total, completed: Math.round((progress / 100) * total) })}\n`);
          await sleep(60 / speed);
        }
        res.end();
      });
      return undefined;
    }

    if (pathname === '/api/chat' && method === 'POST') {
      readBody().then(async (body) => {
        const model = body.model || MODELS[0].name;
        const prompt = lastUserMessage(body.messages);
        const reply = buildReply(prompt, model);
        const wantsThinking = /r1|qwen3|thinking|o1/i.test(model);
        const stream = body.stream !== false;

        if (!stream) {
          return sendJson(200, {
            model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: reply },
            done: true,
            eval_count: WORDS_PER_REPLY,
            prompt_eval_count: prompt.split(/\s+/).length,
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        let closed = false;
        req.on('close', () => { closed = true; });

        await sleep(350 / speed);
        if (wantsThinking && !closed) {
          for (const chunk of chunkify(buildThinking(prompt))) {
            if (closed) return;
            res.write(`${JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: 'assistant', content: '', thinking: chunk }, done: false })}\n`);
            await sleep(18 / speed);
          }
        }
        const started = Date.now();
        for (const chunk of chunkify(reply)) {
          if (closed) return;
          res.write(`${JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: 'assistant', content: chunk }, done: false })}\n`);
          await sleep(22 / speed);
        }
        const evalDuration = (Date.now() - started) * 1e6;
        res.write(`${JSON.stringify({
          model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
          total_duration: evalDuration + 400 * 1e6,
          load_duration: 300 * 1e6,
          prompt_eval_count: prompt.split(/\s+/).length,
          eval_count: WORDS_PER_REPLY,
          eval_duration: evalDuration,
        })}\n`);
        res.end();
      });
      return undefined;
    }

    if (pathname === '/v1/chat/completions' && method === 'POST') {
      readBody().then(async (body) => {
        const model = body.model || MODELS[0].name;
        const prompt = lastUserMessage(body.messages);
        const reply = buildReply(prompt, model);
        const stream = body.stream !== false;

        if (!stream) {
          return sendJson(200, {
            id: 'chatcmpl-demo',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
            usage: { prompt_tokens: prompt.split(/\s+/).length, completion_tokens: WORDS_PER_REPLY, total_tokens: WORDS_PER_REPLY + 10 },
          });
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        let closed = false;
        req.on('close', () => { closed = true; });
        const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
        const base = { id: 'chatcmpl-demo', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };

        await sleep(250 / speed);
        for (const chunk of chunkify(reply)) {
          if (closed) return;
          write({ ...base, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] });
          await sleep(20 / speed);
        }
        write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: WORDS_PER_REPLY, total_tokens: WORDS_PER_REPLY + 12 } });
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return undefined;
    }

    return sendJson(404, { error: 'not found', path: pathname });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
        models: MODELS,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (require.main === module) {
  startMock({ port: Number(process.env.MOCK_PORT || 11434), host: '127.0.0.1', verbose: true }).then((mock) => {
    console.log(`\n🧪 Faux Ollama en écoute sur ${mock.url}`);
    console.log(`   API native     : ${mock.url}/api/tags`);
    console.log(`   API OpenAI     : ${mock.url}/v1/models`);
    console.log(`   Modèles joués  : ${mock.models.map((m) => m.name).join(', ')}\n`);
  });
}

module.exports = { startMock, buildReply, MODELS };
