'use strict';

// === 局面編集モジュール ===

let editMode = false;
let editSavedState = null;
let editSelectedHandPiece = null; // { player, p }
let editCurrentTurn = 'black';
let _whiteHandsListener = null;
let _blackHandsListener = null;

function enterEditMode() {
  if (replayMode) return;
  cancelActiveAi();
  aiThinking = false;

  // 編集前の状態を保存（キャンセル用）
  editSavedState = {
    board:     board.map(r => [...r]),
    bHand:     [...hands.black],
    wHand:     [...hands.white],
    currentPlayer,
    gameOver,
    winner,
    kifuLog:   [...kifuLog],
    headerSub:   document.querySelector('.header-sub').textContent,
    nameWhite:   document.querySelector('#white-side .player-name').textContent,
    nameBlack:   document.querySelector('#black-side .player-name').textContent,
  };

  editMode = true;
  selectedSquare = null;
  selectedHandPiece = null;
  editSelectedHandPiece = null;
  editCurrentTurn = currentPlayer;

  document.getElementById('editor-controls').style.display = 'flex';
  document.getElementById('reset-btn').style.display       = 'none';
  document.getElementById('edit-mode-btn').style.display   = 'none';
  document.getElementById('replay-area').style.display     = 'none';
  document.getElementById('game-over-dialog').style.display = 'none';
  document.getElementById('promotion-dialog').style.display = 'none';
  _updateEditorTurnBtn();
  document.querySelector('.header-sub').textContent = '局面編集';
  document.querySelector('#white-side .player-name').textContent = '後手';
  document.querySelector('#black-side .player-name').textContent = '先手';
  document.getElementById('turn-indicator').textContent = '局面編集中（右クリック：丸印・矢印の描画）';

  // 持ち駒エリアのコンテナ全体にクリックイベント（駒が0枚でも選択中の駒を移動できる）
  _whiteHandsListener = () => { if (selectedSquare) handleEditHandClick('white', 0); };
  _blackHandsListener = () => { if (selectedSquare) handleEditHandClick('black', 0); };
  document.getElementById('white-hands').addEventListener('click', _whiteHandsListener);
  document.getElementById('black-hands').addEventListener('click', _blackHandsListener);

  _showSfenArea(true);
  renderAll();
}

function _updateEditorTurnBtn() {
  document.getElementById('editor-turn-btn').textContent =
    `手番：${editCurrentTurn === 'black' ? '先手' : '後手'}`;
}

function toggleEditTurn() {
  editCurrentTurn = editCurrentTurn === 'black' ? 'white' : 'black';
  _updateEditorTurnBtn();
}

function exitEditMode(apply) {
  if (!apply && editSavedState) {
    // キャンセル：元の状態に戻す
    board         = editSavedState.board.map(r => [...r]);
    hands.black   = [...editSavedState.bHand];
    hands.white   = [...editSavedState.wHand];
    currentPlayer = editSavedState.currentPlayer;
    gameOver      = editSavedState.gameOver;
    winner        = editSavedState.winner;
    kifuLog       = [...editSavedState.kifuLog];
  }

  // ヘッダーを元に戻す（null化の前に参照）
  if (editSavedState) {
    document.querySelector('.header-sub').textContent              = editSavedState.headerSub;
    document.querySelector('#white-side .player-name').textContent = editSavedState.nameWhite;
    document.querySelector('#black-side .player-name').textContent = editSavedState.nameBlack;
  }

  editMode = false;
  editSavedState = null;
  editSelectedHandPiece = null;
  selectedSquare    = null;
  selectedHandPiece = null;

  document.getElementById('editor-controls').style.display = 'none';
  document.getElementById('reset-btn').style.display       = '';
  document.getElementById('edit-mode-btn').style.display   = '';
  document.getElementById('replay-area').style.display     = '';
  _showSfenArea(false);

  // 持ち駒エリアのリスナーを解除
  if (_whiteHandsListener) {
    document.getElementById('white-hands').removeEventListener('click', _whiteHandsListener);
    _whiteHandsListener = null;
  }
  if (_blackHandsListener) {
    document.getElementById('black-hands').removeEventListener('click', _blackHandsListener);
    _blackHandsListener = null;
  }

  if (apply) {
    // 対局開始
    currentPlayer = editCurrentTurn;
    gameOver  = false;
    winner    = null;
    kifuLog   = [];
    resetHistory();
    legalMovesCache = getLegalMoves(currentPlayer);

    if (currentPlayer === 'black') {
      document.getElementById('turn-indicator').textContent = 'あなたの番です';
      renderAll();
    } else {
      renderAll();
      _triggerAiFromEditor();
    }
  } else {
    // キャンセル
    legalMovesCache = getLegalMoves('black');
    renderAll();
    if (gameOver) showGameOver();
    else document.getElementById('turn-indicator').textContent =
      currentPlayer === 'black' ? 'あなたの番です' : 'AIが考え中...';
  }
}

// 後手番開始時のAI起動
function _triggerAiFromEditor() {
  aiThinking = true;
  document.getElementById('turn-indicator').textContent = 'AIが考え中... 0秒';

  function finishAiTurn(aiMove) {
    cancelActiveAi();
    if (aiMove) applyMove(aiMove);
    aiThinking = false;
    legalMovesCache = getLegalMoves('black');
    renderAll();
    if (gameOver) showGameOver();
    else document.getElementById('turn-indicator').textContent = 'あなたの番です';
  }

  let aiSeconds = 0;
  activeAiTimerId = setInterval(() => {
    aiSeconds++;
    document.getElementById('turn-indicator').textContent = `AIが考え中... ${aiSeconds}秒`;
  }, 1000);

  activeAiHardId = setTimeout(() => {
    const moves = getLegalMoves('white');
    finishAiTurn(moves.length > 0 ? moves[0] : null);
  }, 35000);

  setTimeout(() => {
    try {
      const worker = new Worker('ai_worker.js');
      activeAiWorker = worker;
      worker.onmessage = e => finishAiTurn(e.data);
      worker.onerror   = () => { activeAiWorker = null; finishAiTurn(getBestMove()); };
      worker.postMessage({
        board:         board.map(r => [...r]),
        hands:         { black: [...hands.black], white: [...hands.white] },
        currentPlayer: currentPlayer,
        kifuLog:       [],
      });
    } catch(e) {
      activeAiWorker = null;
      finishAiTurn(getBestMove());
    }
  }, 0);
}

// === 編集モード：盤上クリック ===
function handleEditCellClick(r, c) {
  const piece = board[r][c];

  // 持ち駒配置モード
  if (editSelectedHandPiece !== null) {
    if (piece === 0) {
      const { player, p } = editSelectedHandPiece;
      board[r][c] = (player === 'black' ? 1 : -1) * p;
      hands[player][p]--;
    }
    editSelectedHandPiece = null;
    selectedSquare = null;
    renderAll();
    return;
  }

  // 駒選択中
  if (selectedSquare) {
    const { row: sr, col: sc } = selectedSquare;
    if (sr === r && sc === c) {
      // 同じ駒を再クリック → 通常駒なら成駒に、成駒なら相手の通常駒に
      const absP = Math.abs(piece);
      const s    = piece > 0 ? 1 : -1;
      if (PROMOTE_MAP[absP] !== undefined) {
        // 通常駒（成れる）→ 同じ先後の成駒
        board[r][c] = s * PROMOTE_MAP[absP];
      } else if (DEMOTE_MAP[absP] !== undefined) {
        // 成駒 → 相手の通常駒
        board[r][c] = -s * DEMOTE_MAP[absP];
      } else {
        // 金・玉は先後切り替えのみ
        board[r][c] = -piece;
      }
      selectedSquare = null;
    } else {
      // 別のマスへ移動
      const targetPiece = board[r][c];
      if (targetPiece !== 0) {
        // 移動先に駒がある → 移動した駒の持ち主の持ち駒に追加（成り駒は生駒に戻す）
        const absTarget   = Math.abs(targetPiece);
        const movingOwner = board[sr][sc] > 0 ? 'black' : 'white';
        const demoted     = DEMOTE_MAP[absTarget] || absTarget;
        if (demoted !== OU) hands[movingOwner][demoted]++;
      }
      board[r][c]   = board[sr][sc];
      board[sr][sc] = 0;
      selectedSquare = null;
    }
    renderAll();
    return;
  }

  // 未選択 → 駒を選択
  if (piece !== 0) {
    selectedSquare    = { row: r, col: c };
    selectedHandPiece = null;
    renderAll();
  }
}


// === 編集モード：持ち駒クリック → 盤上選択中なら持ち駒に移動、そうでなければ配置モード ===
function handleEditHandClick(player, p) {
  // 盤上の駒を選択中 → 持ち駒エリアに移動（クリックしたエリアの持ち主に関係なく）
  if (selectedSquare) {
    const piece = board[selectedSquare.row][selectedSquare.col];
    if (piece !== 0) {
      const absP    = Math.abs(piece);
      const demoted = DEMOTE_MAP[absP] || absP;
      if (demoted !== OU) hands[player][demoted]++; // クリックしたエリアのプレイヤーに追加
      board[selectedSquare.row][selectedSquare.col] = 0;
    }
    selectedSquare        = null;
    editSelectedHandPiece = null;
    renderAll();
    return;
  }

  // 配置モード
  if (hands[player][p] <= 0) return;
  editSelectedHandPiece = { player, p };
  selectedSquare    = null;
  selectedHandPiece = null;
  renderAll();
}

// === 編集モード：持ち駒右クリック → 無効（コンテキストメニュー抑止のみ） ===
function handleEditHandRightClick(_player, _p, ev) {
  ev.preventDefault();
}

// === 盤面クリア（盤上の全駒を持ち駒に移動） ===
function clearBoardEditor() {
  clearDrawings();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (piece === 0) continue;
      const absP    = Math.abs(piece);
      const owner   = piece > 0 ? 'black' : 'white';
      const demoted = DEMOTE_MAP[absP] || absP;
      hands[owner][demoted]++;
      board[r][c] = 0;
    }
  }
  selectedSquare        = null;
  editSelectedHandPiece = null;
  renderAll();
}

// === 初期配置に戻す ===
function initBoardEditor() {
  clearDrawings();
  initBoard(); // 盤・持ち駒をリセット（editCurrentTurnは保持）
  selectedSquare        = null;
  editSelectedHandPiece = null;
  renderAll();
}

// === SFEN変換テーブル ===
const _PIECE_TO_SFEN = {
  [FU]:'p',[KY]:'l',[KE]:'n',[GI]:'s',[KI]:'g',[KA]:'b',[HI]:'r',[OU]:'k',
  [TO]:'+p',[NY]:'+l',[NK]:'+n',[NG]:'+s',[UM]:'+b',[RY]:'+r'
};
const _SFEN_TO_PIECE  = { 'p':FU,'l':KY,'n':KE,'s':GI,'g':KI,'b':KA,'r':HI,'k':OU };
const _SFEN_PROMOTED  = { 'p':TO,'l':NY,'n':NK,'s':NG,'b':UM,'r':RY };
const _HAND_ORDER_SFEN = [HI, KA, KI, GI, KE, KY, FU]; // 標準SFEN持ち駒順

// === 現在局面をSFEN文字列に変換 ===
function boardToSFEN() {
  let sfenBoard = '';
  for (let r = 0; r < 9; r++) {
    let empty = 0;
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (piece === 0) {
        empty++;
      } else {
        if (empty > 0) { sfenBoard += empty; empty = 0; }
        const code = _PIECE_TO_SFEN[Math.abs(piece)];
        // 先手は大文字、後手は小文字（+プレフィックスはそのまま残す）
        sfenBoard += piece > 0 ? code.replace(/[a-z]/g, ch => ch.toUpperCase()) : code;
      }
    }
    if (empty > 0) sfenBoard += empty;
    if (r < 8) sfenBoard += '/';
  }

  const turn = editCurrentTurn === 'black' ? 'b' : 'w';

  let handStr = '';
  for (const player of ['black', 'white']) {
    for (const p of _HAND_ORDER_SFEN) {
      const count = hands[player][p];
      if (count <= 0) continue;
      if (count > 1) handStr += count;
      const code = _PIECE_TO_SFEN[p].replace('+', ''); // 持ち駒は成り前
      handStr += player === 'black' ? code.toUpperCase() : code;
    }
  }
  if (handStr === '') handStr = '-';

  return `${sfenBoard} ${turn} ${handStr} 1`;
}

// === SFEN文字列から局面を復元 ===
function sfenToBoard(sfen) {
  const parts = sfen.trim().split(/\s+/);
  if (parts.length < 3) return false;
  const [boardStr, turnStr, handsStr] = parts;

  // 盤面パース
  const rows = boardStr.split('/');
  if (rows.length !== 9) return false;
  const newBoard = Array.from({ length: 9 }, () => new Array(9).fill(0));

  for (let r = 0; r < 9; r++) {
    let c = 0, i = 0;
    const row = rows[r];
    while (i < row.length && c < 9) {
      if (row[i] === '+') {
        i++;
        if (i >= row.length) return false;
        const ch = row[i].toLowerCase();
        const p  = _SFEN_PROMOTED[ch];
        if (!p) return false;
        newBoard[r][c] = row[i] === row[i].toUpperCase() ? p : -p;
        c++; i++;
      } else if (row[i] >= '1' && row[i] <= '9') {
        c += parseInt(row[i]); i++;
      } else {
        const ch = row[i].toLowerCase();
        const p  = _SFEN_TO_PIECE[ch];
        if (!p) return false;
        newBoard[r][c] = row[i] === row[i].toUpperCase() ? p : -p;
        c++; i++;
      }
    }
  }

  // 手番パース
  if (turnStr !== 'b' && turnStr !== 'w') return false;

  // 持ち駒パース
  const newHands = { black: new Array(15).fill(0), white: new Array(15).fill(0) };
  if (handsStr !== '-') {
    let i = 0;
    while (i < handsStr.length) {
      let count = 1;
      if (handsStr[i] >= '1' && handsStr[i] <= '9') {
        let numStr = '';
        while (i < handsStr.length && handsStr[i] >= '0' && handsStr[i] <= '9') {
          numStr += handsStr[i++];
        }
        count = parseInt(numStr);
      }
      if (i >= handsStr.length) return false;
      const ch = handsStr[i].toLowerCase();
      const p  = _SFEN_TO_PIECE[ch];
      if (!p) return false;
      const player = handsStr[i] === handsStr[i].toUpperCase() ? 'black' : 'white';
      newHands[player][p] += count;
      i++;
    }
  }

  // 適用
  board           = newBoard;
  hands.black     = newHands.black;
  hands.white     = newHands.white;
  editCurrentTurn = turnStr === 'b' ? 'black' : 'white';
  _updateEditorTurnBtn();
  return true;
}

// === 編集モード中SFENエリア表示切替 ===
function _showSfenArea(show) {
  document.getElementById('kifu-log').style.display      = show ? 'none' : '';
  document.getElementById('sfen-area').style.display     = show ? 'flex' : 'none';
  document.getElementById('kifu-panel-title').textContent = show ? '局面コード（SFEN）' : '棋譜';
  if (show) document.getElementById('sfen-input').value = '';
}

// === イベント登録 ===
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('edit-mode-btn').addEventListener('click',    enterEditMode);
  document.getElementById('editor-turn-btn').addEventListener('click',  toggleEditTurn);
  document.getElementById('editor-clear-btn').addEventListener('click', clearBoardEditor);
  document.getElementById('editor-init-btn').addEventListener('click',  initBoardEditor);
  document.getElementById('editor-done-btn').addEventListener('click',  () => exitEditMode(true));
  document.getElementById('editor-cancel-btn').addEventListener('click',() => exitEditMode(false));

  document.getElementById('sfen-output-btn').addEventListener('click', () => {
    document.getElementById('sfen-input').value = boardToSFEN();
  });

  document.getElementById('sfen-load-btn').addEventListener('click', () => {
    const sfen = document.getElementById('sfen-input').value.trim();
    if (!sfen) return;
    if (sfenToBoard(sfen)) {
      clearDrawings();
      selectedSquare        = null;
      editSelectedHandPiece = null;
      renderAll();
    } else {
      alert('無効なSFEN形式です。形式を確認してください。');
    }
  });
});
