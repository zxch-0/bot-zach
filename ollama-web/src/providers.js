'use strict';

/**
 * Couche "fournisseurs" : parle à un Ollama (API native /api/*) ou à une API
 * compatible OpenAI (/v1/*). Tout passe par fetch natif de Node 18+.
 */

const DEFAULT_MODELS_HINT = {
  cloud: 'gpt-oss:120b',
};

function authHeaders(provider, extra = {}) {
  const headers = { ...extra };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

/** URL de base effective : les API compatibles OpenAI sont préfixées par /v1. */
function openaiBase(provider) {
  const base = provider.baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? base : `${base}/v1`;
}

function endpoint(provider, route) {
  // route commence par "/" ; pour le type openai on préfixe avec /v1
  if (provider.kind === 'openai') {
    return `${openaiBase(provider)}${route}`;
  }
  return `${provider.baseUrl}${route}`;
}

/** Extrait un message d'erreur lisible d'un corps de réponse. */
function describeBody(text) {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    const message =
      parsed.error?.message ||
      parsed.error ||
      parsed.message ||
      '';
    if (typeof message === 'string' && message) return message.slice(0, 400);
  } catch {
    /* pas du JSON */
  }
  return String(text).replace(/\s+/g, ' ').slice(0, 400);
}

/**
 * undici (le fetch de Node) emballe les erreurs réseau dans
 * `TypeError: fetch failed` avec la vraie cause dans `error.cause`.
 */
function unwrapNetworkError(error) {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current.code || current.status || current.errno) return current;
    if (current.name === 'AbortError' || current.name === 'TimeoutError') return current;
    current = current.cause;
  }
  return error;
}

/** Transforme une erreur réseau / HTTP en message clair (en français). */
function friendlyError(rawError, provider) {
  const error = unwrapNetworkError(rawError);
  if (!error) return { message: 'Erreur inconnue', hint: '' };
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return { message: 'Requête annulée ou délai dépassé', hint: 'Le modèle a mis trop de temps à répondre.' };
  }
  if (/bad port/i.test(error.message || '')) {
    return {
      message: `Port invalide dans « ${provider?.baseUrl || '?' } »`,
      hint: 'Node refuse certains ports (1-1024, ports réservés). Utilisez par exemple 11434.',
    };
  }
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    return {
      message: `Nom de domaine introuvable : ${provider?.baseUrl || '?'}`,
      hint: 'Vérifiez l’URL du fournisseur dans vos variables d’environnement.',
    };
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'EPIPE') {
    return {
      message: `Connexion refusée par ${provider?.baseUrl || '?'}`,
      hint: 'Aucun serveur Ollama n’écoute à cette adresse. Lancez « ollama serve » (ou vérifiez l’URL distante).',
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      message: 'Clé API refusée (401/403)',
      hint: 'Vérifiez OLLAMA_CLOUD_API_KEY / OPENAI_API_KEY, ou la clé attendue par votre serveur distant.',
    };
  }
  if (error.status === 404) {
    return {
      message: 'Modèle ou route introuvable (404)',
      hint: 'Le modèle demandé n’est pas installé sur ce serveur, ou l’URL de base est erronée.',
    };
  }
  if (error.status === 429) {
    return {
      message: 'Trop de requêtes (429)',
      hint: 'Quota gratuit atteint côté fournisseur. Patientez quelques minutes.',
    };
  }
  if (error.status === 503) {
    return { message: 'Modèle en cours de chargement (503)', hint: 'Réessayez dans quelques secondes.' };
  }
  if (error.status >= 500) {
    return { message: `Erreur serveur (${error.status})`, hint: describeBody(error.body) };
  }
  if (error.status) {
    return { message: `Erreur HTTP ${error.status}`, hint: describeBody(error.body) };
  }
  if (error.code === 'ETIMEDOUT' || /timeout/i.test(error.message || '')) {
    return { message: 'Délai dépassé en contactant le serveur Ollama', hint: 'Le serveur ne répond pas assez vite (modèle en cours de chargement ?).' };
  }
  return { message: rawError?.message || String(rawError), hint: '' };
}

async function readError(res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  const error = new Error(`HTTP ${res.status}`);
  error.status = res.status;
  error.body = body;
  return error;
}

/** Combine plusieurs AbortSignal (équivalent de AbortSignal.any). */
function linkSignals(signals) {
  const controller = new AbortController();
  const list = signals.filter(Boolean);
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Lecture d'un flux NDJSON ou SSE, ligne par ligne. */
async function readLines(res, onLine) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.trim()) await onLine(line);
      }
    }
    const rest = buffer.trim();
    if (rest) await onLine(rest);
  } catch (error) {
    // On libère la connexion amont avant de propager l'erreur.
    try {
      await reader.cancel();
    } catch {
      /* déjà fermée */
    }
    throw error;
  }
}

function normalizeOllamaModel(entry) {
  const name = entry.name || entry.model || '';
  const details = entry.details || {};
  return {
    name,
    sizeBytes: Number(entry.size || 0),
    family: details.family || '',
    parameterSize: details.parameter_size || '',
    quantization: details.quantization_level || '',
    modifiedAt: entry.modified_at || '',
  };
}

function normalizeOpenaiModel(entry) {
  const name = entry.id || entry.name || '';
  return {
    name,
    sizeBytes: 0,
    family: entry.owned_by ? String(entry.owned_by) : 'openai-compatible',
    parameterSize: '',
    quantization: '',
    modifiedAt: entry.created ? new Date(entry.created * 1000).toISOString() : '',
  };
}

/** Liste les modèles disponibles chez un fournisseur. */
async function listModels(provider, opts = {}) {
  const { signal, timeoutMs = 15000 } = opts;
  const t = timeoutSignal(timeoutMs);
  const started = Date.now();
  try {
    const route = provider.kind === 'openai' ? '/models' : '/api/tags';
    const res = await fetch(endpoint(provider, route), {
      headers: authHeaders(provider, { Accept: 'application/json' }),
      signal: linkSignals([signal, t.signal]),
    });
    if (!res.ok) throw await readError(res);
    const data = await res.json();
    const raw = provider.kind === 'openai' ? data.data || [] : data.models || [];
    const models = raw
      .map(provider.kind === 'openai' ? normalizeOpenaiModel : normalizeOllamaModel)
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { ok: true, models, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, models: [], latencyMs: Date.now() - started, error: friendlyError(error, provider) };
  } finally {
    t.clear();
  }
}

/** Test de disponibilité rapide (utilisé pour choisir le fournisseur par défaut). */
async function probe(provider, opts = {}) {
  const { timeoutMs = 4000 } = opts;
  const result = await listModels(provider, { timeoutMs });
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    reachable: result.ok,
    latencyMs: result.latencyMs,
    modelCount: result.models.length,
    error: result.ok ? null : result.error.message,
  };
}

/** Nettoie les messages reçus du navigateur. */
function sanitizeMessages(messages, limits = {}) {
  const maxMessages = limits.maxMessages || 60;
  const maxContextChars = limits.maxContextChars || 48000;
  const out = [];
  if (!Array.isArray(messages)) return out;
  for (const message of messages.slice(-maxMessages)) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || '').toLowerCase();
    if (!['system', 'user', 'assistant'].includes(role)) continue;
    let content = message.content;
    if (Array.isArray(content)) {
      content = content
        .map((part) => (typeof part === 'string' ? part : part?.text || ''))
        .join('\n');
    }
    content = String(content ?? '');
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  // On garde la fin de la conversation si elle est trop longue.
  let total = out.reduce((sum, m) => sum + m.content.length, 0);
  while (out.length > 1 && total > maxContextChars) {
    const removed = out.shift();
    total -= removed.content.length;
  }
  if (out.length && total > maxContextChars) {
    const last = out[out.length - 1];
    last.content = last.content.slice(-maxContextChars);
  }
  return out;
}

function cleanOptions(raw = {}) {
  const options = {};
  const temperature = Number(raw.temperature);
  if (Number.isFinite(temperature)) options.temperature = Math.min(2, Math.max(0, temperature));
  const topP = Number(raw.topP);
  if (Number.isFinite(topP)) options.top_p = Math.min(1, Math.max(0.01, topP));
  const numCtx = Number.parseInt(raw.numCtx, 10);
  if (Number.isFinite(numCtx)) options.num_ctx = Math.min(262144, Math.max(512, numCtx));
  const numPredict = Number.parseInt(raw.numPredict, 10);
  if (Number.isFinite(numPredict) && numPredict > 0) {
    options.num_predict = Math.min(32768, numPredict);
  }
  const keepAlive = String(raw.keepAlive || '').trim();
  return { options, keepAlive: /^[0-9]+[smh]?$|^-1$/.test(keepAlive) ? keepAlive : '' };
}

/**
 * Chat en streaming.
 * @param {object} provider
 * @param {object} payload { model, messages, options, keepAlive }
 * @param {object} opts { signal, timeoutMs, onEvent }
 */
async function chatStream(provider, payload, opts = {}) {
  const { signal, timeoutMs = 300000, onEvent } = opts;
  const emit = (event) => {
    if (typeof onEvent === 'function') onEvent(event);
  };
  const t = timeoutSignal(timeoutMs);
  const model = String(payload.model || '').trim();
  if (!model) {
    const error = new Error('Aucun modèle sélectionné');
    error.status = 400;
    throw error;
  }
  const { options, keepAlive } = cleanOptions(payload.options);

  const isOpenai = provider.kind === 'openai';
  const body = isOpenai
    ? {
        model,
        messages: payload.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(Number.isFinite(options.temperature) ? { temperature: options.temperature } : {}),
        ...(Number.isFinite(options.top_p) ? { top_p: options.top_p } : {}),
        ...(Number.isFinite(options.num_predict) ? { max_tokens: options.num_predict } : {}),
      }
    : {
        model,
        messages: payload.messages,
        stream: true,
        ...(Object.keys(options).length ? { options } : {}),
        ...(keepAlive ? { keep_alive: keepAlive } : {}),
      };

  const route = isOpenai ? '/chat/completions' : '/api/chat';

  let res;
  try {
    res = await fetch(endpoint(provider, route), {
      method: 'POST',
      headers: authHeaders(provider, {
        'Content-Type': 'application/json',
        Accept: isOpenai ? 'text/event-stream' : 'application/x-ndjson',
      }),
      body: JSON.stringify(body),
      signal: linkSignals([signal, t.signal]),
    });
  } catch (error) {
    throw Object.assign(new Error(friendlyError(error, provider).message), { cause: error });
  }

  if (!res.ok || !res.body) {
    const error = await readError(res);
    throw error;
  }

  const stats = {};
  let gotContent = false;

  const handleOllamaLine = (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    if (data.error) {
      const error = new Error(String(data.error));
      error.status = 502;
      throw error;
    }
    const message = data.message || {};
    if (message.thinking) emit({ type: 'thinking', text: message.thinking });
    if (message.content) {
      gotContent = true;
      emit({ type: 'delta', text: message.content });
    }
    if (data.done) {
      stats.promptTokens = data.prompt_eval_count ?? null;
      stats.outputTokens = data.eval_count ?? null;
      stats.totalDurationMs = data.total_duration ? Math.round(data.total_duration / 1e6) : null;
      stats.loadDurationMs = data.load_duration ? Math.round(data.load_duration / 1e6) : null;
      stats.evalDurationMs = data.eval_duration ? Math.round(data.eval_duration / 1e6) : null;
      stats.doneReason = data.done_reason || 'stop';
    }
  };

  let openaiBuffer = '';
  const handleOpenaiChunk = (chunk) => {
    openaiBuffer += chunk;
    let index;
    while ((index = openaiBuffer.indexOf('\n')) >= 0) {
      const line = openaiBuffer.slice(0, index).trim();
      openaiBuffer = openaiBuffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const payloadText = line.slice(5).trim();
      if (!payloadText || payloadText === '[DONE]') continue;
      let data;
      try {
        data = JSON.parse(payloadText);
      } catch {
        continue;
      }
      if (data.error) {
        const error = new Error(data.error.message || String(data.error));
        error.status = 502;
        throw error;
      }
      const choice = (data.choices || [])[0] || {};
      const delta = choice.delta || {};
      const text = typeof delta.content === 'string' ? delta.content : '';
      if (delta.reasoning_content) emit({ type: 'thinking', text: String(delta.reasoning_content) });
      if (text) {
        gotContent = true;
        emit({ type: 'delta', text });
      }
      if (choice.finish_reason) stats.doneReason = choice.finish_reason;
      if (data.usage) {
        stats.promptTokens = data.usage.prompt_tokens ?? null;
        stats.outputTokens = data.usage.completion_tokens ?? null;
      }
    }
  };

  try {
    if (isOpenai) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        handleOpenaiChunk(decoder.decode(value, { stream: true }));
      }
      handleOpenaiChunk('\n');
    } else {
      await readLines(res, handleOllamaLine);
    }
  } catch (error) {
    t.clear();
    throw error.status ? error : Object.assign(error, friendlyError(error, provider));
  } finally {
    t.clear();
  }

  if (!gotContent) {
    emit({
      type: 'notice',
      message: 'Le modèle n’a renvoyé aucun texte (modèle de raisonnement, ou réponse vide).',
    });
  }
  emit({ type: 'done', stats });
  return stats;
}

/** Téléchargement d'un modèle (uniquement sur un Ollama joignable). */
async function pullStream(provider, model, opts = {}) {
  const { signal, timeoutMs = 3600000, onEvent } = opts;
  if (provider.kind === 'openai') {
    const error = new Error('Le téléchargement de modèles n’existe pas sur une API compatible OpenAI');
    error.status = 400;
    throw error;
  }
  if (!provider.allowPull) {
    const error = new Error(`${provider.label} ne permet pas de télécharger des modèles depuis l’interface`);
    error.status = 400;
    throw error;
  }
  const name = String(model || '').trim();
  if (!/^[a-z0-9][a-z0-9._:/-]{0,120}$/i.test(name)) {
    const error = new Error('Nom de modèle invalide');
    error.status = 400;
    throw error;
  }
  const t = timeoutSignal(timeoutMs);
  let res;
  try {
    res = await fetch(endpoint(provider, '/api/pull'), {
      method: 'POST',
      headers: authHeaders(provider, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ model: name, name, stream: true }),
      signal: linkSignals([signal, t.signal]),
    });
  } catch (error) {
    t.clear();
    throw new Error(friendlyError(error, provider).message);
  }
  if (!res.ok || !res.body) {
    t.clear();
    throw await readError(res);
  }
  try {
    await readLines(res, (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.error) throw new Error(String(data.error));
      const completed = Number(data.completed || 0);
      const total = Number(data.total || 0);
      onEvent?.({
        type: 'progress',
        status: data.status || '',
        completed,
        total,
        percent: total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : null,
      });
    });
  } finally {
    t.clear();
  }
  onEvent?.({ type: 'done', model: name });
}

/** Détermine le meilleur modèle par défaut pour un fournisseur. */
function suggestedModel(provider, models) {
  if (provider.defaultModel) return provider.defaultModel;
  const names = models.map((m) => m.name);
  if (provider.id === 'cloud') {
    const preferred = [DEFAULT_MODELS_HINT.cloud, 'gemma3:4b'];
    for (const candidate of preferred) {
      if (names.includes(candidate)) return candidate;
    }
  }
  return names[0] || provider.defaultModel || '';
}

module.exports = {
  authHeaders,
  chatStream,
  endpoint,
  friendlyError,
  listModels,
  probe,
  pullStream,
  sanitizeMessages,
  suggestedModel,
  cleanOptions,
};
