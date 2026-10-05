'use strict';

// Pagina di export: riceve il brief salvato nel frammento dell'URL (vedi prepareExport in app.js),
// lo impagina per la stampa in PDF e lo offre come testo. Nessuna chiamata di rete.
const STORAGE = 'vendoraBriefExport';
const PERF_FIELDS = [
  ['brand', 'Brand name'],
  ['marketplace', 'Marketplace'],
  ['variants', 'Formato / Taglia / Colore / Quantità'],
  ['specs', 'Ingredienti / Specifiche tecniche / Materiale'],
  ['problem', 'Quale problema risolve?'],
  ['strengths', 'Punti di forza / Elementi differenzianti'],
  ['certificates', 'Certificati / Allergeni'],
  ['competitors', 'ASIN dei top 3 competitor', 'a cura dello strategico'],
  ['strategy', 'Consigli strategici su keyword / elementi grafici / aggettivi', 'a cura dello strategico'],
];
const MARKET_NAMES = { IT: 'Italia', FR: 'Francia', ES: 'Spagna', DE: 'Germania', UK: 'UK', US: 'US' };
const CAT_FIELDS = {
  'Variazione del nodo': [
    ['asin', 'ASIN su cui operare'],
    ['marketplace', 'Marketplace di riferimento'],
    ['currentNode', 'Attuale nodo di navigazione'],
    ['newNode', 'Nuovo nodo di navigazione'],
  ],
  'Creazione di un parent': [
    ['parentBrand', 'Marchio del parent'],
    ['parentName', 'Nome parent'],
    ['parentAsins', 'ASINs da agganciare'],
  ],
  'Caricamenti GRAFICI': [
    ['asin', 'ASIN su cui operare'],
    ['uploadTypes', 'Tipo di caricamento'],
    ['destMarketplaces', 'Marketplace di destinazione'],
    ['driveLink', 'Link Drive della cartella con il materiale'],
  ],
};
const isCatalog = (data) => data.type === 'catalogo';
const fieldsFor = (data) => (isCatalog(data) ? [['operation', 'Operazione'], ...(CAT_FIELDS[data.operation] || [])] : PERF_FIELDS);
const kind = (data) => (isCatalog(data) ? 'CATALOGO' : 'PERFORMANCE');

const $ = (id) => document.getElementById(id);
const setStatus = (text, kind = '') => {
  $('status').textContent = text;
  $('status').className = `status${kind ? ` ${kind}` : ''}`;
};
const el = (tag, props = {}, text = '') => Object.assign(document.createElement(tag), props, text ? { textContent: text } : {});

function fromBase64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function decode(fragment) {
  const [kind, payload] = [fragment.slice(0, 2), fragment.slice(2)];
  const bytes = fromBase64url(payload);
  if (kind === 'j=') return JSON.parse(new TextDecoder().decode(bytes));
  if (kind === 'z=') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  throw new Error('formato sconosciuto');
}

async function loadData() {
  const fragment = location.hash.slice(1);
  if (fragment) {
    const data = await decode(fragment);
    // Tolgo i dati dall'URL, così non finiscono in un link copiato; restano solo in questa scheda.
    try { sessionStorage.setItem(STORAGE, JSON.stringify(data)); } catch { /* storage non disponibile */ }
    history.replaceState(null, '', location.pathname);
    return { data, fresh: true };
  }
  try {
    const saved = sessionStorage.getItem(STORAGE);
    if (saved) return { data: JSON.parse(saved), fresh: false };
  } catch { /* storage non disponibile */ }
  return { data: null, fresh: false };
}

const marketText = (codes = []) => [].concat(codes).filter(Boolean).map((c) => `${MARKET_NAMES[c] || c} (${c})`).join(', ');
function valueOf(data, key) {
  if (key === 'marketplace' || key === 'destMarketplaces') return marketText(data[key]);
  if (Array.isArray(data[key])) return data[key].join(', ');
  const value = String(data[key] || '').trim();
  // Per chi esegue la variazione serve anche l'ID del nodo, che nel form resta nascosto.
  if ((key === 'currentNode' || key === 'newNode') && value && data[`${key}Id`]) return `${value}\nID nodo: ${data[`${key}Id`]}`;
  return value;
}
const exportedAt = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const notionUrl = (data) => (data.pageId ? `https://www.notion.so/${String(data.pageId).replace(/-/g, '')}` : '');

function render(data) {
  $('kicker').textContent = `Brief ${kind(data)}`;
  $('title').textContent = data.title || 'Task senza titolo';
  const meta = $('meta');
  if (data.code) meta.append(el('strong', {}, data.code));
  if (data.client) meta.append(el('span', {}, data.client));
  if (data.completeness) meta.append(el('span', {}, data.completeness));
  meta.append(el('span', {}, `Esportato il ${exportedAt}`));
  if (notionUrl(data)) meta.append(el('a', { href: notionUrl(data), target: '_blank', rel: 'noopener' }, 'Apri la task in Notion'));
  for (const [key, label, note] of fieldsFor(data)) {
    const value = valueOf(data, key);
    const title = el('h2', {}, label);
    if (note) title.append(' ', el('span', { className: 'note' }, `(${note})`));
    const section = el('section', { className: 'field' });
    const isLink = key === 'driveLink' && /^https?:\/\//i.test(value);
    const body = el('p', { className: value ? '' : 'empty' }, isLink ? '' : value || '—');
    if (isLink) body.append(el('a', { href: value, target: '_blank', rel: 'noopener' }, value));
    section.append(title, body);
    $('fields').append(section);
  }
  document.title = ['Brief', kind(data), data.code, data.client].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-');
  $('sheet').hidden = false;
}

function asText(data) {
  const lines = [`BRIEF ${kind(data)}`, [data.code, data.client].filter(Boolean).join(' · '), data.title || ''];
  if (data.completeness) lines.push(`Completezza: ${data.completeness}`);
  if (notionUrl(data)) lines.push(`Task Notion: ${notionUrl(data)}`);
  lines.push(`Esportato il ${exportedAt}`);
  for (const [key, label] of fieldsFor(data)) lines.push('', label.toUpperCase(), valueOf(data, key) || '—');
  return `${lines.filter((l, i) => l || i > 2).join('\n')}\n`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { value: text });
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

(async () => {
  let loaded;
  try {
    loaded = await loadData();
  } catch {
    loaded = { data: null };
  }
  const { data, fresh } = loaded;
  if (!data) {
    for (const id of ['print', 'copy', 'txt']) $(id).hidden = true;
    setStatus('Nessun brief da esportare: apri questa pagina dal pulsante «Esporta» del form in Notion.', 'err');
    return;
  }
  render(data);
  setStatus('Brief pronto. Per il PDF scegli «Salva come PDF» come destinazione di stampa.');
  $('print').addEventListener('click', () => window.print());
  $('copy').addEventListener('click', async () => {
    const ok = await copy(asText(data));
    setStatus(ok ? '✓ Testo copiato: incollalo dove ti serve.' : 'Copia non riuscita: seleziona il testo e copialo a mano.', ok ? 'ok' : 'err');
  });
  $('txt').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([asText(data)], { type: 'text/plain;charset=utf-8' }));
    const a = el('a', { href: url, download: `${document.title}.txt` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('✓ File di testo scaricato.', 'ok');
  });
  if (fresh) setTimeout(() => window.print(), 400); // apre subito la finestra di stampa/PDF
})();
