'use strict';

// === Lishogi SVG駒画像 ===
const PIECE_BASE = 'https://raw.githubusercontent.com/WandererXII/lishogi/master/ui/%40build/pieces/assets/standard/ryoko_1kanji/';
// 駒定数 → SVGファイルコード（OU=8はGYを使用）
const SVG_CODE = ['','FU','KY','KE','GI','KI','KA','HI','GY','TO','NY','NK','NG','UM','RY'];

function pieceImgSrc(absP, isBlack) {
  return `${PIECE_BASE}${isBlack ? '0' : '1'}${SVG_CODE[absP]}.svg`;
}

let selectedSquare = null;
let selectedHandPiece = null;
let legalMovesCache = [];
let pendingPromotion = null;
let aiThinking = false;
let boardFlipped = false;

// 実行中AI Workerの管理
let activeAiWorker  = null;
let activeAiTimerId = null;
let activeAiHardId  = null;

function cancelActiveAi() {
  if (activeAiWorker)  { activeAiWorker.terminate(); activeAiWorker  = null; }
  if (activeAiTimerId) { clearInterval(activeAiTimerId); activeAiTimerId = null; }
  if (activeAiHardId)  { clearTimeout(activeAiHardId);  activeAiHardId  = null; }
}

const ROW_KANJI = ['一','二','三','四','五','六','七','八','九'];
const FLIP_DIR  = Object.freeze({ tl:'br', tr:'bl', bl:'tr', br:'tl' });
let _lastFlipped      = null; // ラベル再構築のキャッシュ
let _lastScrolledIndex = -1;  // 棋譜スクロールのキャッシュ

function displayIsBlack(isBlack) {
  return boardFlipped ? !isBlack : isBlack;
}

// === 難易度設定 ===
function setDifficulty(seconds) {
  TIME_LIMIT_MS = seconds * 1000;
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.secs) === seconds);
  });
}

// === 初期化 ===
function init() {
  initBoard();
  legalMovesCache = getLegalMoves('black');
  renderAll();

  document.getElementById('reset-btn').addEventListener('click', resetGame);
  document.getElementById('play-again-btn').addEventListener('click', resetGame);
  document.getElementById('promote-yes').addEventListener('click', () => resolvePromotion(true));
  document.getElementById('promote-no').addEventListener('click', () => resolvePromotion(false));
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => setDifficulty(parseInt(btn.dataset.secs)));
  });
}

function resetGame() {
  cancelActiveAi();
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

const STAR_DIRS = { '3,3':'tl', '3,5':'tr', '5,3':'bl', '5,5':'br' };

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  if (boardFlipped !== _lastFlipped) {
    const colLabels = document.getElementById('col-labels');
    colLabels.innerHTML = '';
    for (let ci = 0; ci < 9; ci++) {
      const span = document.createElement('span');
      span.textContent = (boardFlipped ? ci : (8 - ci)) + 1;
      colLabels.appendChild(span);
    }
    const rowLabels = document.getElementById('row-labels');
    rowLabels.innerHTML = '';
    for (let ri = 0; ri < 9; ri++) {
      const span = document.createElement('span');
      span.textContent = ROW_KANJI[boardFlipped ? (8 - ri) : ri];
      rowLabels.appendChild(span);
    }
    _lastFlipped = boardFlipped;
  }

  for (let ri = 0; ri < 9; ri++) {
    for (let ci = 0; ci < 9; ci++) {
      const r = boardFlipped ? (8 - ri) : ri;
      const c = boardFlipped ? (8 - ci) : ci;

      const cell = document.createElement('div');
      cell.className = 'cell';

      const starDir = STAR_DIRS[`${r},${c}`];
      if (starDir) {
        cell.classList.add('star', `star-${boardFlipped ? FLIP_DIR[starDir] : starDir}`);
      }

      const piece = board[r][c];
      if (piece !== 0) {
        const img = document.createElement('img');
        img.src = pieceImgSrc(Math.abs(piece), displayIsBlack(piece > 0));
        img.className = 'piece-img';
        img.draggable = false;
        cell.appendChild(img);
      }

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
  if (replayMode || currentPlayer !== 'black' || aiThinking || gameOver || pendingPromotion) return;

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

  // AIのターン（Web Worker でバックグラウンド実行）
  document.getElementById('turn-indicator').textContent = 'AIが考え中... 0秒';
  aiThinking = true;

  // AI終了時の共通処理
  function finishAiTurn(aiMove) {
    cancelActiveAi();
    if (aiMove) applyMove(aiMove);
    aiThinking = false;
    legalMovesCache = getLegalMoves('black');
    renderAll();
    if (gameOver) showGameOver();
    else document.getElementById('turn-indicator').textContent = 'あなたの番です';
  }

  // カウントアップタイマー
  let aiSeconds = 0;
  activeAiTimerId = setInterval(() => {
    aiSeconds++;
    document.getElementById('turn-indicator').textContent = `AIが考え中... ${aiSeconds}秒`;
  }, 1000);

  // 思考時間+5秒で強制終了（最初の合法手を選ぶ）
  activeAiHardId = setTimeout(() => {
    const moves = getLegalMoves('white');
    finishAiTurn(moves.length > 0 ? moves[0] : null);
  }, TIME_LIMIT_MS + 5000);

  // Web Worker 起動（描画後に開始するため setTimeout で1フレーム遅らせる）
  setTimeout(() => {
    try {
      const worker = new Worker('ai_worker.js');
      activeAiWorker = worker;
      worker.onmessage = e => finishAiTurn(e.data);
      worker.onerror   = ()  => {
        // Worker失敗時：同期フォールバック（タイマーは止まるが動作は保証）
        activeAiWorker = null;
        finishAiTurn(getBestMove());
      };
      worker.postMessage({
        board:         board.map(r => [...r]),
        hands:         { black: [...hands.black], white: [...hands.white] },
        currentPlayer: currentPlayer,
        kifuLog:       [...kifuLog],
        timeLimit:     TIME_LIMIT_MS
      });
    } catch(e) {
      // Worker自体が作れない環境：同期フォールバック
      activeAiWorker = null;
      finishAiTurn(getBestMove());
    }
  }, 0);
}

// === 持ち駒の描画 ===
function renderHands() {
  renderHandArea('white', document.getElementById('white-hands'));
  renderHandArea('black', document.getElementById('black-hands'));
}

function renderHandArea(player, container) {
  container.innerHTML = '';
  const hand = hands[player];

  // 持ち駒の表示順（飛・角・金・銀・桂・香・歩）
  const order = [HI, KA, KI, GI, KE, KY, FU];
  for (const p of order) {
    if (hand[p] === 0) continue;
    const el = document.createElement('span');
    el.className = 'hand-piece';

    const img = document.createElement('img');
    img.src = pieceImgSrc(p, displayIsBlack(player === 'black'));
    img.className = 'hand-piece-img';
    img.draggable = false;
    el.appendChild(img);

    if (hand[p] > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'hand-piece-count';
      cnt.textContent = `×${hand[p]}`;
      el.appendChild(cnt);
    }

    if (player === 'black') {
      el.addEventListener('click', () => handleHandClick(p));
      if (selectedHandPiece === p) el.classList.add('selected');
    }
    container.appendChild(el);
  }

}

// === 持ち駒クリック処理 ===
function handleHandClick(piece) {
  if (replayMode || currentPlayer !== 'black' || aiThinking || gameOver || pendingPromotion) return;
  selectedHandPiece = (selectedHandPiece === piece) ? null : piece;
  selectedSquare = null;
  renderAll();
}

// === 棋譜の描画 ===
function renderKifu() {
  const el = document.getElementById('kifu-log');
  if (replayMode && replayAllLabels.length > 0) {
    // 再生モード：全手を1行ずつ表示し、現在の手をハイライト
    el.innerHTML = replayAllLabels.map((label, i) => {
      const cls = (i === replayIndex - 1) ? ' class="kifu-current"' : '';
      return `<div${cls}>${i + 1} ${label}</div>`;
    }).join('');
    if (replayIndex !== _lastScrolledIndex) {
      const cur = el.querySelector('.kifu-current');
      if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      _lastScrolledIndex = replayIndex;
    }
  } else {
    // 対局モード：指した手を1行ずつ表示
    el.innerHTML = kifuLog.map((label, i) =>
      `<div>${i + 1} ${label}</div>`
    ).join('');
    el.scrollTop = el.scrollHeight;
  }
}

// === ゲーム終了表示 ===
function showGameOver() {
  document.getElementById('winner-text').textContent =
    winner === 'black' ? 'あなたの勝ちです！' : 'AIの勝ちです';
  document.getElementById('game-over-dialog').style.display = 'flex';
}

window.addEventListener('DOMContentLoaded', init);
