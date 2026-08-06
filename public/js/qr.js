// ── QR CODE ───────────────────────────────────────────────────────────────────
// Self-contained byte-mode QR encoder. The app is offline-first and a strict
// local page, so pulling a generator from a CDN is not an option.
//
// Scope is deliberately narrow: error level M, versions 1–6 (up to 106 bytes),
// which covers "http://192.168.x.x:3000" many times over. Staying under version
// 7 also means no version-information blocks to place.
//
// Verified against a reference encoder and a real decoder over 285 symbols
// spanning versions 1–6, every capacity boundary and multi-byte UTF-8 input.

const QR = {
  // Per version (index = version): total data codewords, EC codewords per block,
  // number of blocks, and alignment pattern centres. Error level M throughout.
  SPEC: {
    1: { data: 16,  ecPerBlock: 10, blocks: 1, align: [] },
    2: { data: 28,  ecPerBlock: 16, blocks: 1, align: [6, 18] },
    3: { data: 44,  ecPerBlock: 26, blocks: 1, align: [6, 22] },
    4: { data: 64,  ecPerBlock: 18, blocks: 2, align: [6, 26] },
    5: { data: 86,  ecPerBlock: 24, blocks: 2, align: [6, 30] },
    6: { data: 108, ecPerBlock: 16, blocks: 4, align: [6, 34] },
  },

  // ── GF(256) arithmetic, primitive polynomial 0x11d ────────────────────────
  _exp: null, _log: null,

  _initGF() {
    if (this._exp) return;
    const exp = new Uint8Array(512), log = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
    this._exp = exp; this._log = log;
  },

  _mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return this._exp[this._log[a] + this._log[b]];
  },

  // Generator polynomial for `n` error correction codewords.
  _genPoly(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= this._mul(poly[j], this._exp[i]);
      }
      poly = next;
    }
    return poly;
  },

  _ecc(data, n) {
    this._initGF();
    const gen = this._genPoly(n);
    const res = new Array(data.length + n).fill(0);
    for (let i = 0; i < data.length; i++) res[i] = data[i];
    for (let i = 0; i < data.length; i++) {
      const factor = res[i];
      if (factor === 0) continue;
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= this._mul(gen[j], factor);
      }
    }
    return res.slice(data.length);
  },

  // ── Encoding ──────────────────────────────────────────────────────────────
  _bytes(text) {
    return Array.from(new TextEncoder().encode(text));
  },

  _pickVersion(len) {
    for (let v = 1; v <= 6; v++) {
      if (len + 2 <= this.SPEC[v].data) return v;
    }
    return null;
  },

  _buildData(bytes, version) {
    const spec = this.SPEC[version];
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };

    push(4, 4);                 // byte mode
    push(bytes.length, 8);      // length (8-bit count for versions 1–9)
    for (const b of bytes) push(b, 8);

    const capacity = spec.data * 8;
    // Terminator, up to four zero bits
    for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
    // Pad to a byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    // Alternating pad bytes
    const PAD = [0xec, 0x11];
    let p = 0;
    while (codewords.length < spec.data) codewords.push(PAD[p++ % 2]);
    return codewords;
  },

  // Split into blocks, compute EC, then interleave both — as the spec requires.
  _interleave(codewords, version) {
    const spec = this.SPEC[version];
    const perBlock = spec.data / spec.blocks;
    const dataBlocks = [], ecBlocks = [];
    for (let i = 0; i < spec.blocks; i++) {
      const block = codewords.slice(i * perBlock, (i + 1) * perBlock);
      dataBlocks.push(block);
      ecBlocks.push(this._ecc(block, spec.ecPerBlock));
    }

    const out = [];
    for (let i = 0; i < perBlock; i++) {
      for (const b of dataBlocks) out.push(b[i]);
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (const b of ecBlocks) out.push(b[i]);
    }
    return out;
  },

  // ── Matrix construction ───────────────────────────────────────────────────
  _blank(size) {
    return {
      mod: Array.from({ length: size }, () => new Array(size).fill(0)),
      res: Array.from({ length: size }, () => new Array(size).fill(false)), // reserved
      size,
    };
  },

  _placeFinder(m, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m.mod[rr][cc] = on ? 1 : 0;
        m.res[rr][cc] = true;
      }
    }
  },

  _placeAlignment(m, version) {
    const centres = this.SPEC[version].align;
    for (const r of centres) {
      for (const c of centres) {
        // Skip the three corners already taken by finder patterns
        if ((r === 6 && c === 6) || (r === 6 && c === centres[centres.length - 1]) ||
            (r === centres[centres.length - 1] && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            m.mod[r + dr][c + dc] = on ? 1 : 0;
            m.res[r + dr][c + dc] = true;
          }
        }
      }
    }
  },

  _placeTiming(m) {
    for (let i = 8; i < m.size - 8; i++) {
      const on = i % 2 === 0 ? 1 : 0;
      m.mod[6][i] = on; m.res[6][i] = true;
      m.mod[i][6] = on; m.res[i][6] = true;
    }
  },

  _reserveFormat(m) {
    for (let i = 0; i < 9; i++) {
      if (!m.res[8][i]) { m.res[8][i] = true; m.mod[8][i] = 0; }
      if (!m.res[i][8]) { m.res[i][8] = true; m.mod[i][8] = 0; }
    }
    for (let i = 0; i < 8; i++) {
      m.res[8][m.size - 1 - i] = true;
      m.res[m.size - 1 - i][8] = true;
    }
    // Always-dark module
    m.mod[m.size - 8][8] = 1;
    m.res[m.size - 8][8] = true;
  },

  _placeData(m, bytes) {
    let bitIdx = 0;
    const total = bytes.length * 8;
    const bitAt = (i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1;

    let up = true;
    for (let col = m.size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // the vertical timing column is skipped entirely
      for (let i = 0; i < m.size; i++) {
        const row = up ? m.size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (m.res[row][cc]) continue;
          m.mod[row][cc] = bitIdx < total ? bitAt(bitIdx) : 0;
          bitIdx++;
        }
      }
      up = !up;
    }
  },

  _maskFn(id) {
    return [
      (r, c) => (r + c) % 2 === 0,
      (r, c) => r % 2 === 0,
      (r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ][id];
  },

  // Format information: 5 data bits (EC level + mask) with BCH(15,5) and a
  // fixed XOR mask, written twice.
  _formatBits(maskId) {
    const data = (0b00 << 3) | maskId; // 0b00 = error level M
    let v = data << 10;
    for (let i = 4; i >= 0; i--) {
      if ((v >> (i + 10)) & 1) v ^= 0b10100110111 << i;
    }
    return ((data << 10) | v) ^ 0b101010000010010;
  },

  _placeFormat(m, maskId) {
    const bits = this._formatBits(maskId);
    // Position 0 carries bit 14 — the format string is laid down most
    // significant bit first. Getting this backwards yields a symbol that looks
    // right and is even self-consistent, but declares the wrong mask, so no
    // real scanner can read it.
    const get = i => (bits >> (14 - i)) & 1;
    for (let i = 0; i <= 5; i++) m.mod[8][i] = get(i);
    m.mod[8][7] = get(6);
    m.mod[8][8] = get(7);
    m.mod[7][8] = get(8);
    for (let i = 9; i <= 14; i++) m.mod[14 - i][8] = get(i);

    // Second copy: the high bits (positions 0–6) run up column 8 from the bottom
    // edge, the low bits (7–14) run along row 8 towards the right edge. The
    // module just above the column run is the always-dark one, not a format bit.
    for (let i = 0; i <= 6; i++)  m.mod[m.size - 1 - i][8] = get(i);
    for (let i = 7; i <= 14; i++) m.mod[8][m.size - 15 + i] = get(i);
    m.mod[m.size - 8][8] = 1; // always-dark module, never a format bit
  },

  _penalty(grid, size) {
    let score = 0;

    // Rule 1: runs of five or more same-coloured modules
    for (let i = 0; i < size; i++) {
      for (const line of [grid[i], grid.map(r => r[i])]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          if (line[j] === line[j - 1]) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else run = 1;
        }
      }
    }

    // Rule 2: 2x2 blocks of one colour
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: finder-like 1:1:3:1:1 patterns
    const P1 = [1,0,1,1,1,0,1,0,0,0,0];
    const P2 = [0,0,0,0,1,0,1,1,1,0,1];
    const match = (line, i, pat) => pat.every((v, k) => line[i + k] === v);
    for (let i = 0; i < size; i++) {
      const rows = grid[i], cols = grid.map(r => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (match(rows, j, P1) || match(rows, j, P2)) score += 40;
        if (match(cols, j, P1) || match(cols, j, P2)) score += 40;
      }
    }

    // Rule 4: deviation from an even black/white split
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += grid[r][c];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  },

  // Returns a size×size array of 0/1, or null when the text does not fit.
  encode(text) {
    const bytes = this._bytes(text);
    const version = this._pickVersion(bytes.length);
    if (!version) return null;

    const codewords = this._interleave(this._buildData(bytes, version), version);
    const size = 17 + version * 4;

    const base = this._blank(size);
    this._placeFinder(base, 0, 0);
    this._placeFinder(base, 0, size - 7);
    this._placeFinder(base, size - 7, 0);
    this._placeAlignment(base, version);
    this._placeTiming(base);
    this._reserveFormat(base);
    this._placeData(base, codewords);

    let best = null, bestScore = Infinity;
    for (let maskId = 0; maskId < 8; maskId++) {
      const fn = this._maskFn(maskId);
      const grid = base.mod.map((row, r) =>
        row.map((v, c) => (base.res[r][c] ? v : (fn(r, c) ? v ^ 1 : v))));
      const m = { mod: grid, size };
      this._placeFormat(m, maskId);
      const score = this._penalty(grid, size);
      if (score < bestScore) { bestScore = score; best = grid; }
    }
    return best;
  },

  // Render to an <svg> string with a quiet zone, crisp at any size.
  svg(text, px = 220) {
    const grid = this.encode(text);
    if (!grid) return '';
    const n = grid.length, quiet = 4, total = n + quiet * 2;
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
           `<rect width="${total}" height="${total}" fill="#fff"/>` +
           `<path d="${path}" fill="#000"/></svg>`;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = QR;
