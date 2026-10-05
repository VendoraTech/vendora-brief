'use strict';

// Selettore dei nodi di navigazione Amazon con ricerca. L'albero di un marketplace (nodes/xx.json,
// ricavato dai file "eu_browse_tree_mappings") si scarica solo quando serve e si filtra nel browser.
// All'utente si mostra il percorso in testo; l'ID del nodo resta interno e viene salvato a parte.
const NodeTrees = (() => {
  const cache = new Map();
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function load(marketplace) {
    const mk = String(marketplace).toLowerCase();
    if (!cache.has(mk)) {
      const promise = fetch(`nodes/${mk}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        })
        .then((data) => data.nodes.map(([id, path]) => ({ id, path, key: fold(path), leaf: fold(path.split(' › ').pop()) })))
        .catch(() => {
          cache.delete(mk);
          throw new Error('Impossibile caricare i nodi di navigazione: controlla la connessione e riprova.');
        });
      cache.set(mk, promise);
    }
    return cache.get(mk);
  }

  // Tutte le parole cercate devono comparire nel percorso; prima i nodi in cui compaiono nel nome finale.
  function search(nodes, query, limit = 50) {
    const q = fold(query.trim());
    if (!q) return [];
    if (/^\d{5,}$/.test(q)) return nodes.filter((n) => n.id.startsWith(q)).slice(0, limit);
    const terms = q.split(/\s+/);
    const hits = [];
    for (const n of nodes) {
      if (!terms.every((t) => n.key.includes(t))) continue;
      const score = (terms.every((t) => n.leaf.includes(t)) ? 0 : 1000) + (n.leaf.startsWith(terms[0]) ? 0 : 100) + n.path.length / 10;
      hits.push([score, n]);
    }
    return hits.sort((a, b) => a[0] - b[0]).slice(0, limit).map((h) => h[1]);
  }

  return { load, search };
})();

class NodePicker {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.nodes = null;
    this.value = null;
    this.results = [];
    this.active = -1;
    this.input = root.querySelector('input');
    this.list = root.querySelector('[role=listbox]');
    this.picked = root.querySelector('.picked');
    this.pickedText = root.querySelector('.picked-path');
    this.changeButton = root.querySelector('.change');

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.update(), 120);
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 150));
    this.list.addEventListener('mousedown', (e) => e.preventDefault()); // il click arriva prima del blur
    this.list.addEventListener('click', (e) => {
      const option = e.target.closest('li[data-index]');
      if (option) this.choose(Number(option.dataset.index));
    });
    this.changeButton.addEventListener('click', () => {
      this.set(null, true);
      this.input.focus();
    });
  }

  setTree(nodes) {
    this.nodes = nodes;
    this.input.disabled = !nodes;
    this.input.placeholder = nodes ? 'Cerca il nodo per parola chiave (anche più parole)…' : 'Scegli prima il marketplace';
  }

  set(value, notify = false) {
    this.value = value && value.id ? { id: String(value.id), path: String(value.path) } : null;
    this.picked.hidden = !this.value;
    this.input.hidden = Boolean(this.value);
    this.pickedText.textContent = this.value ? this.value.path : '';
    this.input.value = '';
    this.results = [];
    this.close();
    if (notify) this.onChange(this.value);
  }

  update() {
    if (!this.nodes) return;
    this.results = NodeTrees.search(this.nodes, this.input.value);
    this.active = this.results.length ? 0 : -1;
    this.render();
  }

  render() {
    const prefix = this.input.id;
    const items = this.results.map((node, i) => {
      const parts = node.path.split(' › ');
      const li = document.createElement('li');
      li.id = `${prefix}-opt-${i}`;
      li.dataset.index = String(i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === this.active));
      li.append(
        Object.assign(document.createElement('span'), { className: 'leaf', textContent: parts.pop() }),
        Object.assign(document.createElement('span'), { className: 'trail', textContent: parts.join(' › ') }),
      );
      return li;
    });
    if (!items.length && this.input.value.trim()) {
      items.push(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Nessun nodo trovato: prova con altre parole.' }));
    }
    this.list.replaceChildren(...items);
    const open = items.length > 0;
    this.list.hidden = !open;
    this.input.setAttribute('aria-expanded', String(open));
    if (this.active >= 0) {
      this.input.setAttribute('aria-activedescendant', items[this.active].id);
      items[this.active].scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!this.results.length) return;
      e.preventDefault();
      const n = this.results.length;
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.render();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // non inviare il form
      if (this.active >= 0 && !this.list.hidden) this.choose(this.active);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  choose(index) {
    const node = this.results[index];
    if (!node) return;
    this.set(node, true);
    this.changeButton.focus();
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}
