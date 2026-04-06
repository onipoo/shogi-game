'use strict';

let selectedSquare = null;    // クリックで選択した盤上のマス {row, col}
let selectedHandPiece = null; // クリックで選択した持ち駒の種類（数値）
let legalMovesCache = [];     // 先手の合法手リスト（毎ターン更新）
let pendingPromotion = null;  // 成り確認待ち {promMove, noPromMove}
let aiThinking = false;

// === 初期化 ===
function init() {
  initBoard();
  legalMovesCache = getLegalMoves('black');
  renderAll();

  document.getElementById('reset-btn').addEventListener('click', resetGame);
  document.getElementById('play-again-btn').addEventListener('click', resetGame);
  document.getElementById('promote-yes').addEventListener('click', () => resolvePromotion(true));
  document.getElementById('promote-no').addEventListener('click', () => resolvePromotion(false));
}

function resetGame() {
  initBoard();
  resetHistory(); // AIの履歴テーブルをリセット
  selectedSquare = null;
  selectedHandPiece = null;
  pendingPromotion = null;
  aiThinking = false;
  legalMovesCache = getLegalMoves('black');
  renderAll();
  document.getElementById('turn-indicator').textContent = 'あなたの番です';
  document.getElementById('promotion-dialog').style.display = 'none';
  document.getElementById('game-over-dialog').style.display = 'none';
}

// === 描画 ===
function renderAll() {
  renderBoard();
  renderHands();
  renderKifu();
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      const piece = board[r][c];
      if (piece !== 0) {
        const absP = Math.abs(piece);
        const span = document.createElement('span');
        span.textContent = PIECE_CHAR[absP];
        let cls = piece > 0 ? 'piece black-piece' : 'piece white-piece';
        if (absP >= 9) cls += ' promoted'; // 成り駒は赤表示
        span.className = cls;
        cell.appendChild(span);
      }

      // 選択・合法手ハイライト
      if (selectedSquare && selectedSquare.row === r && selectedSquare.col === c) {
        cell.classList.add('selected');
      } else if (isLegalTarget(r, c)) {
        cell.classList.add('legal');
      }

      cell.addEventListener('click', () => handleCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

// 指定マスが現在の選択の合法移動先かどうか
function isLegalTarget(r, c) {
  if (selectedSquare) {
    return legalMovesCache.some(m =>
      !m.drop &&
      m.from.row === selectedSquare.row && m.from.col === selectedSquare.col &&
      m.to.row === r && m.to.col === c
    );
  }
  if (selectedHandPiece !== null) {
    return legalMovesCache.some(m =>
      m.drop && m.piece === selectedHandPiece && m.to.row === r && m.to.col === c
    );
  }
  return false;
}

// === マスのクリック処理 ===
function handleCellClick(r, c) {
  if (currentPlayer !== 'black' || aiThinking || gameOver || pendingPromotion) return;

  const piece = board[r][c];

  // 持ち駒を選択中 → 打つか選択解除
  if (selectedHandPiece !== null) {
    const drops = legalMovesCache.filter(m =>
      m.drop && m.piece === selectedHandPiece && m.to.row === r && m.to.col === c
    );
    if (drops.length > 0) {
      executePlayerMove(drops[0]);
    } else {
      selectedHandPiece = null;
      if (isOwn(piece, 'black')) selectedSquare = { row:r, col:c };
      else selectedSquare = null;
      renderAll();
    }
    return;
  }

  // 盤上の駒を選択中
  if (selectedSquare) {
    const targets = legalMovesCache.filter(m =>
      !m.drop &&
      m.from.row === selectedSquare.row && m.from.col === selectedSquare.col &&
      m.to.row === r && m.to.col === c
    );
    if (targets.length >= 1) {
      if (targets.length === 2) {
        // 成りを選択させる
        pendingPromotion = {
          promMove:   targets.find(m => m.promote),
          noPromMove: targets.find(m => !m.promote)
        };
        selectedSquare = null;
        renderAll();
        document.getElementById('promotion-dialog').style.display = 'flex';
      } else {
        executePlayerMove(targets[0]);
      }
      return;
    }
    // 自分の別の駒をクリック → 選択変更
    if (isOwn(piece, 'black')) { selectedSquare = { row:r, col:c }; renderAll(); return; }
    // 空や相手の駒 → 選択解除
    selectedSquare = null; renderAll(); return;
  }

  // 未選択 → 自分の駒を選択
  if (isOwn(piece, 'black')) {
    selectedSquare = { row:r, col:c };
    renderAll();
  }
}

// === 成り確認ダイアログの応答 ===
function resolvePromotion(doPromote) {
  document.getElementById('promotion-dialog').style.display = 'none';
  if (!pendingPromotion) return;
  const move = doPromote ? pendingPromotion.promMove : pendingPromotion.noPromMove;
  pendingPromotion = null;
  executePlayerMove(move);
}

// === プレイヤーの指し手を実行してAIへ ===
function executePlayerMove(move) {
  selectedSquare = null;
  selectedHandPiece = null;
  applyMove(move);
  legalMovesCache = [];
  renderAll();

  if (gameOver) { showGameOver(); return; }

  // AIのターン
  document.getElementById('turn-indicator').textContent = 'AIが考え中...';
  aiThinking = true;

  // レンダリングが終わってからAIを動かす
  setTimeout(() => {
    const aiMove = getBestMove();
    if (aiMove) applyMove(aiMove);
    aiThinking = false;
    legalMovesCache = getLegalMoves('black');
    renderAll();

    if (gameOver) {
      showGameOver();
    } else {
      document.getElementById('turn-indicator').textContent = 'あなたの番です';
    }
  }, 30);
}

// === 持ち駒の描画 ===
function renderHands() {
  renderHandArea('white', document.getElementById('white-hands'));
  renderHandArea('black', document.getElementById('black-hands'));
}

function renderHandArea(player, container) {
  container.innerHTML = '';
  const hand = hands[player];
  let hasAny = false;

  // 持ち駒の表示順（飛・角・金・銀・桂・香・歩）
  const order = [HI, KA, KI, GI, KE, KY, FU];
  for (const p of order) {
    if (hand[p] === 0) continue;
    hasAny = true;
    const el = document.createElement('span');
    el.className = 'hand-piece';
    el.textContent = PIECE_CHAR[p] + (hand[p] > 1 ? ` ×${hand[p]}` : '');
    if (player === 'black') {
      el.addEventListener('click', () => handleHandClick(p));
      if (selectedHandPiece === p) el.classList.add('selected');
    }
    container.appendChild(el);
  }

  if (!hasAny) container.textContent = 'なし';
}

// === 持ち駒クリック処理 ===
function handleHandClick(piece) {
  if (currentPlayer !== 'black' || aiThinking || gameOver || pendingPromotion) return;
  selectedHandPiece = (selectedHandPiece === piece) ? null : piece;
  selectedSquare = null;
  renderAll();
}

// === 棋譜の描画 ===
function renderKifu() {
  const el = document.getElementById('kifu-log');
  el.textContent = kifuLog.join('　');
  el.scrollTop = el.scrollHeight;
}

// === ゲーム終了表示 ===
function showGameOver() {
  document.getElementById('winner-text').textContent =
    winner === 'black' ? 'あなたの勝ちです！' : 'AIの勝ちです';
  document.getElementById('game-over-dialog').style.display = 'flex';
}

window.addEventListener('DOMContentLoaded', init);
