'use strict';

// === 盤面描画モジュール（丸印・矢印） ===
// key形式: 盤上マス → 'cell:r,c'  持ち駒 → 'hand:player:piece'
// 色: 先手駒/先手持ち駒 → 緑、後手駒/後手持ち駒 → 赤、空きマス → 青

const drawCircles = new Map(); // key → color
const drawArrows  = new Map(); // 'fromKey→toKey' → color

let _dragStart = null; // 右クリックドラッグの開始情報

// === 色の決定 ===
function _colorForCellInfo(row, col) {
  const piece = board[row][col];
  if (piece > 0) return '#2A9A2A'; // 先手 → 緑
  if (piece < 0) return '#CC2222'; // 後手 → 赤
  return '#2266CC';                // 空き → 青
}
function _colorForHandInfo(player) {
  return player === 'black' ? '#2A9A2A' : '#CC2222';
}
function _colorForInfo(info) {
  return info.type === 'cell'
    ? _colorForCellInfo(info.row, info.col)
    : _colorForHandInfo(info.player);
}

// === キー変換 ===
function _makeKey(info) {
  return info.type === 'cell'
    ? `cell:${info.row},${info.col}`
    : `hand:${info.player}:${info.piece}`;
}

// === 要素の中心座標（viewport基準、固定SVG用） ===
function _elCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// === keyから描画座標を取得 ===
function _keyToPoint(key) {
  if (key.startsWith('cell:')) {
    const [r, c] = key.slice(5).split(',').map(Number);
    const ri = boardFlipped ? (8 - r) : r;
    const ci = boardFlipped ? (8 - c) : c;
    const idx  = ri * 9 + ci;
    const cell = document.getElementById('board').children[idx];
    return cell ? _elCenter(cell) : null;
  }
  if (key.startsWith('hand:')) {
    const [player, pieceStr] = key.slice(5).split(':');
    const handEl = document.querySelector(
      `[data-player="${player}"][data-piece="${pieceStr}"]`
    );
    return handEl ? _elCenter(handEl) : null;
  }
  return null;
}

// === SVGに矢印を追加 ===
function _appendArrow(svg, p1, p2, color) {
  const dx  = p2.x - p1.x;
  const dy  = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const ux = dx / len, uy = dy / len;
  const headLen = 16, headWid = 8;
  const tipX  = p2.x - ux * 4,  tipY  = p2.y - uy * 4;
  const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', p1.x + ux * 12);
  line.setAttribute('y1', p1.y + uy * 12);
  line.setAttribute('x2', baseX);
  line.setAttribute('y2', baseY);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '5');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', '0.82');
  svg.appendChild(line);

  const px = -uy * headWid, py = ux * headWid;
  const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  tri.setAttribute('points',
    `${tipX},${tipY} ${baseX+px},${baseY+py} ${baseX-px},${baseY-py}`);
  tri.setAttribute('fill', color);
  tri.setAttribute('opacity', '0.82');
  svg.appendChild(tri);
}

// === 描画を再描画 ===
function renderDrawings() {
  const svg = document.getElementById('drawing-overlay');
  if (!svg) return;
  svg.innerHTML = '';

  for (const [key, color] of drawCircles) {
    const p = _keyToPoint(key);
    if (!p) continue;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', p.x);
    circle.setAttribute('cy', p.y);
    circle.setAttribute('r', 21);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '3.5');
    circle.setAttribute('opacity', '0.82');
    svg.appendChild(circle);
  }

  for (const [key, color] of drawArrows) {
    const sep = key.indexOf('→');
    const p1  = _keyToPoint(key.slice(0, sep));
    const p2  = _keyToPoint(key.slice(sep + 1)); // '→'は3バイトだが indexOf/slice は文字単位
    if (p1 && p2) _appendArrow(svg, p1, p2, color);
  }
}

// === 丸印のON/OFF ===
function _toggleCircle(info) {
  const key = _makeKey(info);
  if (drawCircles.has(key)) drawCircles.delete(key);
  else drawCircles.set(key, _colorForInfo(info));
  renderDrawings();
}

// === 矢印のON/OFF ===
function _toggleArrow(startInfo, endInfo) {
  const key = `${_makeKey(startInfo)}→${_makeKey(endInfo)}`;
  if (drawArrows.has(key)) drawArrows.delete(key);
  else drawArrows.set(key, _colorForInfo(startInfo));
  renderDrawings();
}

// === 描画を全消去 ===
function clearDrawings() {
  drawCircles.clear();
  drawArrows.clear();
  renderDrawings();
}

// === セル要素 → info ===
function _cellInfo(cellEl) {
  const cells = Array.from(document.getElementById('board').children);
  const idx   = cells.indexOf(cellEl);
  if (idx < 0) return null;
  const ri = Math.floor(idx / 9), ci = idx % 9;
  return {
    type: 'cell',
    row:  boardFlipped ? (8 - ri) : ri,
    col:  boardFlipped ? (8 - ci) : ci,
  };
}

// === 座標から描画ターゲットを特定 ===
function _infoFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cell = el.closest('.cell');
  if (cell && document.getElementById('board').contains(cell)) return _cellInfo(cell);
  const handEl = el.closest('[data-player][data-piece]');
  if (handEl) {
    return {
      type:   'hand',
      player: handEl.dataset.player,
      piece:  parseInt(handEl.dataset.piece),
    };
  }
  return null;
}

// === 同じターゲットか判定 ===
function _isSame(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'cell') return a.row === b.row && a.col === b.col;
  return a.player === b.player && a.piece === b.piece;
}

// === イベント登録 ===
document.addEventListener('DOMContentLoaded', () => {
  // body全体を覆う固定SVGオーバーレイを追加
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'drawing-overlay';
  svg.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1000;';
  document.body.appendChild(svg);

  // 盤上のmousedown
  document.getElementById('board').addEventListener('mousedown', ev => {
    if (ev.button !== 2 || (!editMode && !replayMode)) return;
    const cell = ev.target.closest('.cell');
    _dragStart = cell ? _cellInfo(cell) : null;
  });

  // 持ち駒エリアのmousedown
  ['white-hands', 'black-hands'].forEach(id => {
    document.getElementById(id).addEventListener('mousedown', ev => {
      if (ev.button !== 2 || (!editMode && !replayMode)) return;
      ev.stopPropagation();
      const handEl = ev.target.closest('[data-player][data-piece]');
      if (!handEl) return;
      _dragStart = {
        type:   'hand',
        player: handEl.dataset.player,
        piece:  parseInt(handEl.dataset.piece),
      };
    });
  });

  // mouseup → 丸印 or 矢印
  window.addEventListener('mouseup', ev => {
    if (ev.button !== 2 || !_dragStart) return;
    const end = _infoFromPoint(ev.clientX, ev.clientY);
    if (end && !_isSame(_dragStart, end)) _toggleArrow(_dragStart, end);
    else if (end)                          _toggleCircle(_dragStart);
    _dragStart = null;
  });
});
