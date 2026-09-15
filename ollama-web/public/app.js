/* ============================================================
   Ollama Web — logique de l'interface (JavaScript natif)
   ============================================================ */
(() => {
  'use strict';

  // ----------------------------- utilitaires -----------------------------
  const $ = (id) => document.getElementById(id);
  const LS_CONV = 'ow.conversations.v1';
  const LS_PREFS = 'ow.prefs.v1';
  const LS_CURRENT = 'ow.current.v1';

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / navigation privée */
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  let toastTimer = 0;
  function toast(message, kind = '', details = '') {
    const host = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<span></span>${details ? '<small></small>' : ''}`;
    el.firstChild.textContent = message;
    if (details) el.querySelector('small').textContent = details;
    host.appendChild(el);
    const ttl = kind === 'err' ? 9000 : 4200;
    clearTimeout(toastTimer);
    setTimeout(() => el.remove(), ttl);
  }

  // ------------------------------ état local -----------------------------
  const DEFAULT_PREFS = {
    theme: 'dark',
    providerId: null,
    model: '',
    systemPrompt: '',
    temperature: 0.7,
    topP: 0.9,
    numCtx: '',
    showThinking: false,
  };

  let prefs = { ...DEFAULT_PREFS, ...readLS(LS_PREFS, {}) };
  let conversations = readLS(LS_CONV, []);
  let currentId = readLS(LS_CURRENT, null);
  let config = null;
  let streamState = null;
  let renderQueued = false;

  const currentConv = () => conversations.find((c) => c.id === currentId) || null;

  function saveConversations() {
    writeLS(LS_CONV, conversations.slice(0, 100));
  }

  function savePrefs() {
    writeLS(LS_PREFS, prefs);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  // --------------------------- rendu markdown ----------------------------
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineMarkdown(text) {
    let out = text;
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return out;
  }

  /**
   * Rendu markdown minimaliste, sans dépendance : titres, listes, citations,
   * blocs de code (avec bouton Copier), gras/italique/code inline, liens.
   * Le texte est échappé AVANT le rendu : aucun HTML utilisateur n'est exécuté.
   */
  function renderMarkdown(source) {
    const blocks = [];
    let text = escapeHtml(source == null ? '' : source);

    const stash = (lang, code) => {
      blocks.push({ lang: (lang || '').trim().slice(0, 20), code: code.replace(/\n$/, '') });
      return `\u0000B${blocks.length - 1}\u0000`;
    };

    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => stash(lang, code));
    // Bloc de code non terminé (pendant le streaming)
    text = text.replace(/```([^\n`]*)\n?([\s\S]*)$/, (_, lang, code) => stash(lang, code));

    const lines = text.split('\n');
    const html = [];
    let list = null; // 'ul' | 'ol'
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join('<br />'))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (list) {
        html.push(`</${list}>`);
        list = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      if (/^\u0000B\d+\u0000$/.test(line.trim())) {
        flushParagraph();
        closeList();
        html.push(line.trim());
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = clamp(heading[1].length, 1, 6);
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        closeList();
        html.push('<hr />');
        continue;
      }
      const quote = line.match(/^\s*&gt;\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        flushParagraph();
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) {
          closeList();
          list = kind;
          html.push(`<${kind}>`);
        }
        html.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
    closeList();

    let output = html.join('\n');
    return output.replace(/\u0000B(\d+)\u0000/g, (_, index) => {
      const block = blocks[Number(index)];
      if (!block) return '';
      const lang = block.lang ? `<span class="code-lang">${escapeHtml(block.lang)}</span>` : '';
      return `<div class="code-wrap">${lang}<button class="copy-btn" type="button">Copier</button>` +
        `<pre><code>${block.code}</code></pre></div>`;
    });
  }

  // -------------------------------- API ----------------------------------
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const raw = await res.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { message: raw.slice(0, 300) };
      }
    }
    if (!res.ok) {
      if (res.status === 401) showLogin();
      const error = new Error(data.message || `Erreur HTTP ${res.status}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /** POST + lecture d'un flux SSE (data: {...}\n\n). */
  async function streamPost(path, body, onEvent, signal) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let data = {};
      try {
        data = JSON.parse(await res.text());
      } catch {
        /* ignore */
      }
      if (res.status === 401) showLogin();
      const error = new Error(data.message || `Erreur HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    if (!res.body) throw new Error('Réponse sans flux (navigateur trop ancien ?)');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const handleBlock = (chunk) => {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          /* bloc ignoré */
        }
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        handleBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    if (buffer.trim()) handleBlock(buffer);
  }

  // ------------------------------ rendu UI -------------------------------
  function renderConvList() {
    const host = $('convList');
    host.textContent = '';
    if (!conversations.length) {
      const empty = document.createElement('p');
      empty.className = 'conv-empty';
      empty.textContent = 'Aucune discussion pour le moment.';
      host.appendChild(empty);
      return;
    }
    for (const conv of conversations) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `conv-item${conv.id === currentId ? ' active' : ''}`;
      item.dataset.id = conv.id;

      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = conv.title || 'Discussion';

      const del = document.createElement('span');
      del.className = 'conv-del';
      del.dataset.del = conv.id;
      del.title = 'Supprimer';
      del.textContent = '✕';

      item.append(title, del);
      host.appendChild(item);
    }
  }

  function messageNode(message, index) {
    const wrap = document.createElement('article');
    wrap.className = `msg ${message.role === 'user' ? 'user' : 'assistant'}`;
    wrap.dataset.index = String(index);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = message.role === 'user' ? '🙋' : '🤖';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const head = document.createElement('div');
    head.className = 'msg-head';
    const role = document.createElement('span');
    role.className = 'msg-role';
    role.textContent = message.role === 'user' ? 'Vous' : (message.model || 'Assistant');
    const meta = document.createElement('span');
    meta.className = 'msg-meta';
    meta.textContent = message.stats
      ? statsLine(message.stats)
      : (message.ts ? formatTime(message.ts) : '');
    head.append(role, meta);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (message.error) bubble.classList.add('error');

    if (message.thinking && prefs.showThinking) {
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      thinking.textContent = message.thinking;
      bubble.appendChild(thinking);
    }

    const contentHost = document.createElement('div');
    contentHost.className = 'content';
    contentHost.innerHTML = renderMarkdown(message.content || '');
    bubble.appendChild(contentHost);

    if (message.error) {
      const err = document.createElement('p');
      err.style.color = 'var(--err)';
      err.textContent = `⚠️ ${message.error}`;
      bubble.appendChild(err);
    }

    body.append(head, bubble);
    wrap.append(avatar, body);
    return wrap;
  }

  function statsLine(stats) {
    const parts = [];
    if (stats.outputTokens) {
      parts.push(`${formatNumber(stats.outputTokens)} tokens`);
    }
    if (stats.evalDurationMs && stats.outputTokens) {
      const perSecond = stats.outputTokens / (stats.evalDurationMs / 1000);
      parts.push(`${perSecond.toFixed(1)} tok/s`);
    }
    if (stats.totalDurationMs) parts.push(`${(stats.totalDurationMs / 1000).toFixed(1)} s`);
    return parts.join(' · ') || formatTime(Date.now());
  }

  function isNearBottom(host) {
    return host.scrollHeight - host.scrollTop - host.clientHeight < 140;
  }

  function scrollToBottom() {
    const host = $('messages');
    host.scrollTop = host.scrollHeight;
  }

  function renderMessages(options = {}) {
    const host = $('messages');
    const conv = currentConv();
    const keepBottom = options.force || isNearBottom(host);
    host.textContent = '';

    if (!conv || !conv.messages.length) {
      host.appendChild(buildWelcome());
      updateComposerHint();
      return;
    }

    conv.messages.forEach((message, index) => {
      host.appendChild(messageNode(message, index));
    });
    updateComposerHint();
    if (keepBottom) requestAnimationFrame(scrollToBottom);
  }

  function buildWelcome() {
    const section = document.createElement('section');
    section.className = 'welcome';
    section.id = 'welcome';

    const h2 = document.createElement('h2');
    h2.textContent = 'Votre Ollama, maintenant dans le cloud ☁️';

    const p = document.createElement('p');
    p.innerHTML =
      'Cette interface pilote un serveur <strong>Ollama</strong> : celui de votre machine, un serveur ' +
      'distant (Colab, VPS, Docker…) ou les modèles hébergés d’<strong>Ollama Cloud</strong>.';

    const grid = document.createElement('div');
    grid.className = 'suggestions';
    const prompts = [
      ['🐳 Docker vs VM', 'Explique-moi la différence entre un conteneur Docker et une machine virtuelle, en 5 points.'],
      ['🧩 Fonction JS', 'Écris une fonction JavaScript qui met en majuscule la première lettre de chaque mot, avec un exemple.'],
      ['📚 Vulgariser un LLM', "Résume en 3 phrases ce qu'est un modèle de langage pour quelqu'un qui n'y connaît rien."],
      ['💡 Idées de noms', 'Donne-moi 5 idées de noms pour un projet de chat auto-hébergé, avec une justification courte.'],
    ];
    for (const [label, prompt] of prompts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggestion';
      btn.textContent = label;
      btn.dataset.prompt = prompt;
      grid.appendChild(btn);
    }

    section.append(h2, p, grid);

    const note = welcomeNoteText();
    if (note) {
      const box = document.createElement('div');
      box.className = 'welcome-note';
      box.innerHTML = note;
      section.appendChild(box);
    }
    return section;
  }

  function welcomeNoteText() {
    if (!config) return '';
    const ids = config.providers.map((p) => p.id);
    const healthById = {};
    for (const entry of (window.__health || [])) healthById[entry.id] = entry;

    if (!ids.length) {
      return '⚠️ <strong>Aucun fournisseur configuré.</strong> Ajoutez au moins ' +
        '<code>OLLAMA_CLOUD_API_KEY</code> (clé gratuite sur ollama.com/settings/keys) ou ' +
        '<code>OLLAMA_REMOTE_URL</code> dans les variables d’environnement, puis redémarrez le service.';
    }
    const reachable = Object.values(healthById).filter((h) => h.reachable);
    if (!reachable.length) {
      const list = Object.values(healthById)
        .map((h) => `<li><code>${h.label}</code> → ${escapeHtml(h.error || 'injoignable')}</li>`)
        .join('');
      return `⚠️ <strong>Aucun serveur Ollama ne répond pour l’instant.</strong><ul>${list}</ul>` +
        'Vérifiez la configuration (Réglages → Diagnostic serveur) : URL du serveur distant, clé API, ' +
        'ou démarrez Ollama avec <code>ollama serve</code>.';
    }
    const local = reachable.find((h) => h.id === 'local');
    if (local) {
      return `💡 Connecté à <strong>Ollama local</strong> (${local.modelCount} modèle(s)). ` +
        'Astuce : ce site peut aussi viser un Ollama distant ou Ollama Cloud — voir « À propos ».';
    }
    return '';
  }

  function updateComposerHint() {
    const conv = currentConv();
    const hint = $('composerHint');
    if (streamState) {
      hint.textContent = 'Génération en cours…';
    } else if (!config) {
      hint.textContent = '—';
    } else if (!config.providers.length) {
      hint.textContent = 'Aucun fournisseur configuré — voir la note ci-dessus.';
    } else if (!prefs.model) {
      hint.textContent = 'Choisissez un modèle dans le menu de gauche.';
    } else {
      hint.textContent = `${prefs.model} · prêt`;
    }
  }

  function updateTopbar() {
    const conv = currentConv();
    $('chatTitle').textContent = conv ? (conv.title || 'Discussion') : 'Nouvelle discussion';
    const provider = config?.providers.find((p) => p.id === prefs.providerId);
    $('chatSubtitle').textContent = provider
      ? `${provider.label}${prefs.model ? ` · ${prefs.model}` : ''}`
      : '—';
  }

  function updateStatusBadge() {
    const badge = $('statusBadge');
    const entries = window.__health || [];
    const entry = entries.find((h) => h.id === prefs.providerId);
    if (!entry) {
      badge.className = 'badge';
      badge.textContent = '● inconnu';
      badge.title = 'État du fournisseur inconnu';
      return;
    }
    badge.className = `badge ${entry.reachable ? 'ok' : 'err'}`;
    badge.textContent = entry.reachable
      ? `● en ligne${entry.latencyMs ? ` ${entry.latencyMs} ms` : ''}`
      : '● hors ligne';
    badge.title = entry.reachable
      ? `${entry.label} répond (${entry.modelCount} modèle(s))`
      : `${entry.label} : ${entry.error || 'injoignable'}`;
  }

  // --------------------------- fournisseurs/modèles ----------------------
  function buildProviderSelect() {
    const select = $('providerSelect');
    select.textContent = '';
    if (!config?.providers.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '— aucun —';
      select.appendChild(option);
      select.disabled = true;
      $('providerHint').textContent = 'Configurez un fournisseur (voir ci-contre).';
      return;
    }
    select.disabled = false;
    for (const provider of config.providers) {
      const option = document.createElement('option');
      option.value = provider.id;
      const tag = provider.isLocal ? ' (local)' : provider.hasKey ? '' : ' (sans clé)';
      option.textContent = `${provider.label}${tag}`;
      select.appendChild(option);
    }
    const wanted = prefs.providerId || config.recommendedProviderId || config.defaultProviderId;
    const exists = config.providers.some((p) => p.id === wanted);
    prefs.providerId = exists ? wanted : config.providers[0].id;
    select.value = prefs.providerId;
    savePrefs();
    updateProviderHint();
    updateStatusBadge();
  }

  function updateProviderHint() {
    const provider = config?.providers.find((p) => p.id === prefs.providerId);
    const hint = $('providerHint');
    const pullBtn = $('openPull');
    if (!provider) {
      hint.textContent = '—';
      return;
    }
    const entry = (window.__health || []).find((h) => h.id === provider.id);
    const status = entry
      ? entry.reachable
        ? `✅ en ligne (${entry.latencyMs} ms)`
        : `❌ ${entry.error || 'injoignable'}`
      : '…';
    hint.textContent = `${status} — ${provider.baseUrl}`;
    const canPull = config.allowPull && provider.allowPull;
    pullBtn.disabled = !canPull;
    pullBtn.title = canPull
      ? 'Télécharger un modèle (ollama pull)'
      : (provider.allowPull ? 'Téléchargement désactivé (ALLOW_PULL=false)' : 'Indisponible sur ce fournisseur');
  }

  async function loadModels({ silent = false } = {}) {
    const select = $('modelSelect');
    const hint = $('modelHint');
    if (!config?.providers.length || !prefs.providerId) return;
    select.disabled = true;
    hint.textContent = 'Chargement des modèles…';
    try {
      const data = await api(`/api/models?provider=${encodeURIComponent(prefs.providerId)}`);
      select.textContent = '';
      const models = data.models || [];
      if (!models.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = data.ok ? '— aucun modèle installé —' : '— serveur injoignable —';
        select.appendChild(option);
        prefs.model = '';
        savePrefs();
        hint.textContent = data.ok
          ? 'Aucun modèle : utilisez ⬇ pour en télécharger un.'
          : (data.error?.message || 'Serveur injoignable');
      } else {
        for (const model of models) {
          const option = document.createElement('option');
          option.value = model.name;
          const info = [model.parameterSize, model.quantization, formatBytes(model.sizeBytes)]
            .filter(Boolean)
            .join(' · ');
          option.textContent = info ? `${model.name}  (${info})` : model.name;
          select.appendChild(option);
        }
        const wanted = models.some((m) => m.name === prefs.model)
          ? prefs.model
          : (models.some((m) => m.name === data.suggested) ? data.suggested : models[0].name);
        prefs.model = wanted;
        select.value = wanted;
        savePrefs();
        hint.textContent =
          `${models.length} modèle(s) disponible(s) · ${data.latencyMs} ms` +
          (prefs.model.startsWith('gpt-oss') || /:cloud$/.test(prefs.model) ? ' · modèle cloud' : '');
      }
      select.disabled = false;
      updateTopbar();
      updateComposerHint();
    } catch (error) {
      select.disabled = false;
      hint.textContent = error.message;
      if (!silent) toast('Impossible de charger les modèles', 'err', error.message);
    }
  }

  async function refreshHealth({ silent = true, force = false } = {}) {
    try {
      const data = await api(`/api/health${force ? '?force=1' : ''}`);
      window.__health = data.providers || [];
      updateStatusBadge();
      updateProviderHint();
      if (!silent && !window.__health.some((p) => p.reachable)) {
        toast('Aucun serveur Ollama ne répond', 'err', 'Voir Réglages → Diagnostic serveur');
      }
    } catch (error) {
      if (!silent) toast('Diagnostic impossible', 'err', error.message);
    }
  }

  // ------------------------------ streaming ------------------------------
  function setStreaming(active) {
    $('sendBtn').hidden = active;
    $('stopBtn').hidden = !active;
    $('input').disabled = false;
    updateComposerHint();
  }

  function queueStreamUpdate() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const state = streamState;
      if (!state) return;
      const bubbleNode = state.bubbleNode;
      if (!bubbleNode) return;
      const content = bubbleNode.querySelector('.content');
      if (!content) return;
      content.innerHTML = renderMarkdown(state.message.content || '');
      content.classList.add('cursor');
      const meta = state.headNode;
      if (meta) meta.textContent = `${formatNumber((state.message.content || '').length)} caractères reçus…`;
      if (isNearBottom($('messages'))) scrollToBottom();
    });
  }

  async function sendMessage(text) {
    const conv = currentConv();
    const content = String(text || '').trim();
    if (!conv || !content || streamState) return;
    if (!config?.providers.length) {
      toast('Aucun fournisseur configuré', 'err', 'Voir Réglages → Diagnostic serveur');
      return;
    }
    if (!prefs.model) {
      toast('Aucun modèle sélectionné', 'err', 'Choisissez un modèle dans le menu de gauche.');
      return;
    }

    const providerId = prefs.providerId;
    const model = prefs.model;

    const payloadMessages = [];
    const systemPrompt = (prefs.systemPrompt || config.systemPrompt || '').trim();
    if (systemPrompt) payloadMessages.push({ role: 'system', content: systemPrompt });
    for (const message of conv.messages.slice(-config.limits.maxMessages + 1)) {
      if (message.role === 'user' || message.role === 'assistant') {
        if (message.content) payloadMessages.push({ role: message.role, content: message.content });
      }
    }
    payloadMessages.push({ role: 'user', content });

    conv.messages.push({ role: 'user', content, ts: Date.now() });
    if (!conv.title || conv.title === 'Nouvelle discussion') {
      conv.title = content.replace(/\s+/g, ' ').slice(0, 48) + (content.length > 48 ? '…' : '');
    }
    const assistant = { role: 'assistant', content: '', thinking: '', model, ts: Date.now(), stats: null, error: '' };
    conv.messages.push(assistant);
    conv.updatedAt = Date.now();
    saveConversations();
    renderConvList();
    updateTopbar();

    // On ajoute simplement les deux nouvelles bulles (le reste ne bouge pas).
    const host = $('messages');
    host.querySelector('.welcome')?.remove();
    host.appendChild(messageNode(conv.messages[conv.messages.length - 2], conv.messages.length - 2));

    // Bulle de l'assistant + indicateur de saisie
    const index = conv.messages.length - 1;
    const node = messageNode(assistant, index);
    const bubbleNode = node.querySelector('.bubble');
    const contentNode = node.querySelector('.content');
    const headNode = node.querySelector('.msg-meta');
    contentNode.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    host.appendChild(node);
    scrollToBottom();

    const controller = new AbortController();
    streamState = { controller, message: assistant, bubbleNode, headNode };
    setStreaming(true);

    try {
      await streamPost(
        '/api/chat',
        {
          providerId,
          model,
          messages: payloadMessages,
          options: {
            temperature: Number(prefs.temperature),
            topP: Number(prefs.topP),
            numCtx: prefs.numCtx ? Number(prefs.numCtx) : undefined,
          },
        },
        (event) => {
          if (event.type === 'start') {
            assistant.model = event.model;
          } else if (event.type === 'delta') {
            assistant.content += event.text;
            queueStreamUpdate();
          } else if (event.type === 'thinking') {
            assistant.thinking += event.text;
            assistant.content = assistant.content || '';
            if (prefs.showThinking) queueStreamUpdate();
          } else if (event.type === 'notice') {
            assistant.content += `\n\n_${event.message}_`;
            queueStreamUpdate();
          } else if (event.type === 'stats' || event.type === 'done') {
            assistant.stats = { ...(assistant.stats || {}), ...(event.stats || {}) };
            if (headNode) headNode.textContent = statsLine(assistant.stats);
          } else if (event.type === 'error') {
            assistant.error = event.hint ? `${event.message} — ${event.hint}` : event.message;
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        assistant.content += assistant.content ? '\n\n_[génération interrompue]_' : '_[génération interrompue]_';
      } else {
        assistant.error = error.message;
        toast('Erreur pendant la génération', 'err', error.message);
      }
    } finally {
      streamState = null;
      setStreaming(false);
      conv.updatedAt = Date.now();
      saveConversations();
      renderMessages({ force: true });
      if (assistant.error) toast('Le modèle a renvoyé une erreur', 'err', assistant.error);
    }
  }

  // ------------------------------ discussions ----------------------------
  function newConversation() {
    const conv = {
      id: uid(),
      title: 'Nouvelle discussion',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    conversations.unshift(conv);
    currentId = conv.id;
    saveConversations();
    writeLS(LS_CURRENT, currentId);
    renderConvList();
    renderMessages({ force: true });
    updateTopbar();
    closeNav();
    $('input').focus();
  }

  function openConversation(id) {
    currentId = id;
    writeLS(LS_CURRENT, id);
    renderConvList();
    renderMessages({ force: true });
    updateTopbar();
    closeNav();
  }

  function deleteConversation(id) {
    conversations = conversations.filter((c) => c.id !== id);
    if (currentId === id) {
      currentId = conversations[0]?.id || null;
      writeLS(LS_CURRENT, currentId);
    }
    if (!conversations.length) newConversation();
    else {
      saveConversations();
      renderConvList();
      renderMessages({ force: true });
      updateTopbar();
    }
  }

  function exportConversation() {
    const conv = currentConv();
    if (!conv) return;
    const lines = [`# ${conv.title}`, '', `_Exporté le ${new Date().toLocaleString('fr-FR')}_`, ''];
    for (const message of conv.messages) {
      lines.push(message.role === 'user' ? '## 🙋 Vous' : `## 🤖 Assistant (${message.model || ''})`);
      lines.push('');
      lines.push(message.content || '');
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${conv.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40) || 'discussion'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ------------------------------- réglages ------------------------------
  function openSettings() {
    $('systemPrompt').value = prefs.systemPrompt || '';
    $('temperature').value = String(prefs.temperature);
    $('temperatureOut').textContent = Number(prefs.temperature).toFixed(1);
    $('topP').value = String(prefs.topP);
    $('topPOut').textContent = Number(prefs.topP).toFixed(2);
    $('numCtx').value = prefs.numCtx || '';
    $('showThinking').checked = Boolean(prefs.showThinking);
    $('settingsOverlay').hidden = false;
    renderDiagnostics();
  }

  async function renderDiagnostics() {
    const box = $('diagContent');
    box.textContent = 'Diagnostic en cours…';
    try {
      const health = await api('/api/health?force=1');
      window.__health = health.providers || [];
      updateStatusBadge();
      updateProviderHint();
      const lines = [
        `Serveur web : ${health.version} · démarré depuis ${(health.uptimeMs / 60000).toFixed(1)} min`,
        `État global : ${health.status}`,
        '',
      ];
      for (const provider of health.providers) {
        lines.push(`${provider.reachable ? '✅' : '❌'} ${provider.label} (${provider.id})`);
        lines.push(`   url     : ${config.providers.find((p) => p.id === provider.id)?.baseUrl || '?'}`);
        lines.push(`   délai   : ${provider.latencyMs} ms · modèles : ${provider.modelCount}`);
        if (provider.error) lines.push(`   erreur  : ${provider.error}`);
      }
      if (!health.providers.length) {
        lines.push('Aucun fournisseur. Ajoutez OLLAMA_CLOUD_API_KEY ou OLLAMA_REMOTE_URL.');
      }
      box.textContent = lines.join('\n');
    } catch (error) {
      box.textContent = `Diagnostic indisponible : ${error.message}`;
    }
  }

  // ------------------------------- login ---------------------------------
  function showLogin() {
    $('app').hidden = true;
    $('loginOverlay').hidden = false;
    setTimeout(() => $('password').focus(), 50);
  }

  function hideLogin() {
    $('loginOverlay').hidden = true;
  }

  // ------------------------------ navigation -----------------------------
  function closeNav() {
    document.body.classList.remove('nav-open');
  }

  // -------------------------------- init ---------------------------------
  async function loadConfig() {
    config = await api('/api/config');
    if (config.authRequired && !config.authenticated) {
      showLogin();
      return false;
    }
    hideLogin();
    $('app').hidden = false;
    $('brandSubtitle').textContent = `v${config.version} · ${config.node}`;
    $('versionLabel').textContent = `${config.name} v${config.version} · Node ${config.node}`;
    $('logout').hidden = !config.authRequired;
    buildProviderSelect();
    return true;
  }

  async function afterLogin() {
    if (!currentId) {
      if (!conversations.length) newConversation();
      else {
        currentId = conversations[0].id;
        writeLS(LS_CURRENT, currentId);
      }
    }
    if (!conversations.some((c) => c.id === currentId)) {
      currentId = conversations[0]?.id || null;
      if (!currentId) newConversation();
    }
    applyTheme(prefs.theme);
    if (!prefs.systemPrompt) prefs.systemPrompt = config.systemPrompt || '';
    renderConvList();
    renderMessages({ force: true });
    updateTopbar();
    await refreshHealth({ silent: true, force: true });
    renderMessages({ force: true });
    await loadModels({ silent: true });
    setInterval(() => refreshHealth({ silent: true }), 60000);
  }

  function bindEvents() {
    $('composer').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('input').value;
      if (!value.trim()) return;
      $('input').value = '';
      autoGrow($('input'));
      $('charCount').textContent = '0';
      sendMessage(value);
    });

    $('input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $('composer').requestSubmit();
      }
    });

    $('input').addEventListener('input', () => {
      autoGrow($('input'));
      $('charCount').textContent = String($('input').value.length);
    });

    $('stopBtn').addEventListener('click', () => {
      streamState?.controller.abort();
      toast('Génération interrompue');
    });

    $('newChat').addEventListener('click', newConversation);
    $('menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    $('sidebarClose').addEventListener('click', closeNav);

    $('providerSelect').addEventListener('change', async (event) => {
      prefs.providerId = event.target.value;
      prefs.model = '';
      savePrefs();
      updateProviderHint();
      updateStatusBadge();
      updateTopbar();
      await loadModels();
    });

    $('modelSelect').addEventListener('change', (event) => {
      prefs.model = event.target.value;
      savePrefs();
      updateTopbar();
      updateComposerHint();
    });

    $('refreshModels').addEventListener('click', async () => {
      await refreshHealth({ silent: false, force: true });
      await loadModels();
      toast('Liste des modèles actualisée');
    });

    $('convList').addEventListener('click', (event) => {
      const del = event.target.closest('[data-del]');
      if (del) {
        event.stopPropagation();
        deleteConversation(del.dataset.del);
        return;
      }
      const item = event.target.closest('.conv-item');
      if (item) openConversation(item.dataset.id);
    });

    $('clearAll').addEventListener('click', () => {
      if (!confirm('Supprimer toutes les discussions ?')) return;
      conversations = [];
      currentId = null;
      writeLS(LS_CURRENT, null);
      saveConversations();
      newConversation();
    });

    $('clearChat').addEventListener('click', () => {
      const conv = currentConv();
      if (!conv) return;
      conv.messages = [];
      conv.title = 'Nouvelle discussion';
      saveConversations();
      renderConvList();
      renderMessages({ force: true });
      updateTopbar();
    });

    $('exportChat').addEventListener('click', exportConversation);
    $('themeToggle').addEventListener('click', () => {
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light';
      applyTheme(prefs.theme);
      savePrefs();
    });

    $('messages').addEventListener('click', async (event) => {
      const suggestion = event.target.closest('.suggestion');
      if (suggestion) {
        sendMessage(suggestion.dataset.prompt);
        return;
      }
      const copy = event.target.closest('.copy-btn');
      if (copy) {
        const code = copy.parentElement.querySelector('code');
        try {
          await navigator.clipboard.writeText(code.textContent);
          copy.textContent = 'Copié !';
          setTimeout(() => { copy.textContent = 'Copier'; }, 1500);
        } catch {
          toast('Copie impossible', 'err', 'Votre navigateur bloque le presse-papiers.');
        }
      }
    });

    // Réglages
    $('openSettings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', () => { $('settingsOverlay').hidden = true; });
    $('temperature').addEventListener('input', (event) => { $('temperatureOut').textContent = Number(event.target.value).toFixed(1); });
    $('topP').addEventListener('input', (event) => { $('topPOut').textContent = Number(event.target.value).toFixed(2); });
    $('saveSettings').addEventListener('click', () => {
      prefs.systemPrompt = $('systemPrompt').value;
      prefs.temperature = Number($('temperature').value);
      prefs.topP = Number($('topP').value);
      prefs.numCtx = $('numCtx').value;
      prefs.showThinking = $('showThinking').checked;
      savePrefs();
      $('settingsOverlay').hidden = true;
      renderMessages({ force: false });
      toast('Réglages enregistrés', 'ok');
    });
    $('resetSettings').addEventListener('click', () => {
      prefs = { ...DEFAULT_PREFS, theme: prefs.theme, providerId: prefs.providerId, model: prefs.model };
      savePrefs();
      openSettings();
      toast('Réglages réinitialisés');
    });

    // Téléchargement de modèles
    $('openPull').addEventListener('click', () => {
      $('pullProgress').hidden = true;
      $('pullStatus').textContent = '—';
      $('pullBar').style.width = '0%';
      $('pullOverlay').hidden = false;
      $('pullModel').focus();
    });
    $('closePull').addEventListener('click', () => { $('pullOverlay').hidden = true; });
    $('startPull').addEventListener('click', async () => {
      const model = $('pullModel').value.trim();
      if (!model) return toast('Indiquez un nom de modèle', 'err');
      const progress = $('pullProgress');
      progress.hidden = false;
      $('startPull').disabled = true;
      $('pullStatus').textContent = 'Connexion…';
      try {
        await streamPost('/api/pull', { providerId: prefs.providerId, model }, (event) => {
          if (event.type === 'progress') {
            $('pullStatus').textContent = `${event.status}${event.percent != null ? ` — ${event.percent}%` : ''}` +
              (event.completed ? ` (${formatBytes(event.completed)}${event.total ? ` / ${formatBytes(event.total)}` : ''})` : '');
            if (event.percent != null) $('pullBar').style.width = `${event.percent}%`;
          } else if (event.type === 'done') {
            $('pullStatus').textContent = `✅ ${event.model} est prêt`;
            $('pullBar').style.width = '100%';
            toast('Modèle téléchargé', 'ok', event.model);
            loadModels();
          } else if (event.type === 'error') {
            $('pullStatus').textContent = `❌ ${event.message}`;
            toast('Téléchargement impossible', 'err', event.hint || event.message);
          }
        });
      } catch (error) {
        $('pullStatus').textContent = `❌ ${error.message}`;
        toast('Téléchargement impossible', 'err', error.message);
      } finally {
        $('startPull').disabled = false;
      }
    });

    // À propos
    $('openInfo').addEventListener('click', () => { $('infoOverlay').hidden = false; });
    $('closeInfo').addEventListener('click', () => { $('infoOverlay').hidden = true; });
    $('closeInfoBottom').addEventListener('click', () => { $('infoOverlay').hidden = true; });

    // Overlays : clic sur le fond = fermer
    for (const id of ['settingsOverlay', 'pullOverlay', 'infoOverlay']) {
      $(id).addEventListener('click', (event) => {
        if (event.target.id === id) $(id).hidden = true;
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      for (const id of ['settingsOverlay', 'pullOverlay', 'infoOverlay']) {
        if (!$(id).hidden) $(id).hidden = true;
      }
      closeNav();
    });

    // Déconnexion
    $('logout').addEventListener('click', async () => {
      try {
        await api('/api/logout', { method: 'POST' });
      } finally {
        location.reload();
      }
    });

    // Login
    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      $('loginError').hidden = true;
      const button = $('loginForm').querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
        $('password').value = '';
        if (await loadConfig()) await afterLogin();
      } catch (error) {
        $('loginError').textContent = error.message;
        $('loginError').hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(210, textarea.scrollHeight)}px`;
  }

  async function boot() {
    applyTheme(prefs.theme);
    bindEvents();
    autoGrow($('input'));

    // En cas de pépin inattendu, on affiche au moins la coquille de l'app.
    window.addEventListener('error', (event) => {
      $('app').hidden = false;
      toast('Erreur d’interface', 'err', event.message);
    });

    try {
      if (await loadConfig()) await afterLogin();
    } catch (error) {
      $('app').hidden = false;
      $('composerHint').textContent = 'Serveur injoignable.';
      toast('Connexion au serveur impossible', 'err', error.message);
    }
  }

  boot();
})();
