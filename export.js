'use strict';

// Pagina di export: riceve il brief salvato nel frammento dell'URL (vedi prepareExport in app.js),
// lo impagina per la stampa in PDF e lo offre come testo. Nessuna chiamata di rete.
const STORAGE = 'vendoraBriefExport';
const FIELDS = [
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

const marketText = (codes = []) => codes.map((c) => `${MARKET_NAMES[c] || c} (${c})`).join(', ');
const valueOf = (data, key) => (key === 'marketplace' ? marketText(data.marketplace) : String(data[key] || '').trim());
const exportedAt = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const notionUrl = (data) => (data.pageId ? `https://www.notion.so/${String(data.pageId).replace(/-/g, '')}` : '');

function render(data) {
  $('title').textContent = data.title || 'Task senza titolo';
  const meta = $('meta');
  if (data.code) meta.append(el('strong', {}, data.code));
  if (data.client) meta.append(el('span', {}, data.client));
  if (data.completeness) meta.append(el('span', {}, data.completeness));
  meta.append(el('span', {}, `Esportato il ${exportedAt}`));
  if (notionUrl(data)) meta.append(el('a', { href: notionUrl(data), target: '_blank', rel: 'noopener' }, 'Apri la task in Notion'));
  for (const [key, label, note] of FIELDS) {
    const value = valueOf(data, key);
    const title = el('h2', {}, label);
    if (note) title.append(' ', el('span', { className: 'note' }, `(${note})`));
    const section = el('section', { className: 'field' });
    section.append(title, el('p', { className: value ? '' : 'empty' }, value || '—'));
    $('fields').append(section);
  }
  document.title = ['Brief', data.code, data.client].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-');
  $('sheet').hidden = false;
}

function asText(data) {
  const lines = ['BRIEF PRODOTTO', [data.code, data.client].filter(Boolean).join(' · '), data.title || ''];
  if (data.completeness) lines.push(`Completezza: ${data.completeness}`);
  if (notionUrl(data)) lines.push(`Task Notion: ${notionUrl(data)}`);
  lines.push(`Esportato il ${exportedAt}`);
  for (const [key, label] of FIELDS) lines.push('', label.toUpperCase(), valueOf(data, key) || '—');
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
