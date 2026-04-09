'use strict';

// === 棋譜再生モジュール（KIF形式対応）===

let replayMode      = false;
let replayParsedMoves = [];  // パース済み手の配列
let replaySnapshots   = [];  // 各手数のスナップショット（0=初期局面）
let replayAllLabels   = [];  // 全手の棋譜ラベル（先読み生成）
let replayIndex       = 0;   // 現在の手数（0=初期局面）

// --- KIFパーサー ---
function parseKIF(text) {
  const ROW_KANJI   = ['一','二','三','四','五','六','七','八','九'];
  const COL_FW      = ['１','２','３','４','５','６','７','８','９'];
  const PIECE_NAMES = {
    '歩':FU,'香':KY,'桂':KE,'銀':GI,'金':KI,'角':KA,'飛':HI,
    '玉':OU,'王':OU,
    'と':TO,'杏':NY,'圭':NK,'全':NG,'馬':UM,'竜':RY,'龍':RY
  };

  const moves = [];
  let lastToCol = -1, lastToRow = -1;

  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('*')) continue;

    const m = line.match(/^(\d+)\s+(.+)/);
    if (!m) continue;

    let s = m[2].trim();

    if (/投了|中断|詰み|千日手|持将棋|切れ負け/.test(s)) break;

    let toCol, toRow;

    if (s.startsWith('同')) {
      if (lastToCol < 0) continue;
      toCol = lastToCol;
      toRow = lastToRow;
      s = s.slice(1).replace(/^[\s　]+/, '');
    } else {
      const ci = COL_FW.indexOf(s[0]);
      const ri = ROW_KANJI.indexOf(s[1]);
      if (ci < 0 || ri < 0) continue;
      toCol = 8 - ci;
      toRow = ri;
      s = s.slice(2);
    }

    let piece = 0;
    for (let len = 2; len >= 1; len--) {
      const p = PIECE_NAMES[s.slice(0, len)];
      if (p !== undefined) { piece = p; s = s.slice(len); break; }
    }
    if (!piece) continue;

    let promote = false, drop = false;
    if (s.startsWith('成'))      { promote = true; s = s.slice(1); }
    else if (s.startsWith('不成')) { s = s.slice(2); }
    else if (s.startsWith('打'))   { drop = true; s = s.slice(1); }

    let fromCol = -1, fromRow = -1;
    const src = s.match(/\((\d)(\d)\)/);
    if (src) {
      const fc = parseInt(src[1]);
      const fr = parseInt(src[2]);
      if (fc === 0 || fr === 0) {
        drop = true;
      } else {
        fromCol = 9 - fc;
        fromRow = fr - 1;
      }
    }

    lastToCol = toCol;
    lastToRow = toRow;
    moves.push({ toRow, toCol, piece, promote, drop, fromRow, fromCol });
  }

  return moves;
}

// --- スナップショット ---
function snapshotState() {
  return {
    board:  board.map(r => [...r]),
    bHand:  [...hands.black],
    wHand:  [...hands.white],
    player: currentPlayer,
    over:   gameOver,
    winner,
    kifu:   [...kifuLog]
  };
}

function restoreSnapshot(snap) {
  board         = snap.board.map(r => [...r]);
  hands.black   = [...snap.bHand];
  hands.white   = [...snap.wHand];
  currentPlayer = snap.player;
  gameOver      = snap.over;
  winner        = snap.winner;
  kifuLog       = [...snap.kifu];
}

// パース済み手 → applyMove用オブジェクトに変換
function toInternalMove(km) {
  if (km.drop) {
    return { drop:true, piece:km.piece, to:{ row:km.toRow, col:km.toCol } };
  }
  const cap = board[km.toRow][km.toCol];
  return {
    drop:     false,
    from:     { row:km.fromRow, col:km.fromCol },
    to:       { row:km.toRow,   col:km.toCol },
    piece:    km.piece,
    promote:  km.promote,
    captured: cap !== 0 ? Math.abs(cap) : 0
  };
}

// --- ナビゲーション ---
function replayNext() {
  if (replayIndex >= replayParsedMoves.length) return;
  replayIndex++;
  restoreSnapshot(replaySnapshots[replayIndex]);
  updateReplayUI();
  renderAll();
}

function replayPrev() {
  if (replayIndex <= 0) return;
  replayIndex--;
  restoreSnapshot(replaySnapshots[replayIndex]);
  updateReplayUI();
  renderAll();
}

function replayFirst() {
  replayIndex = 0;
  restoreSnapshot(replaySnapshots[0]);
  updateReplayUI();
  renderAll();
}

function replayLast() {
  replayIndex = replayParsedMoves.length;
  restoreSnapshot(replaySnapshots[replayIndex]);
  updateReplayUI();
  renderAll();
}

// --- UIの更新 ---
function updateReplayUI() {
  const total = replayParsedMoves.length;
  const cur   = replayIndex;
  document.getElementById('replay-counter').textContent = `${cur} / ${total}手`;

  const moveLabel = cur > 0 ? replayAllLabels[cur - 1] : '（開始局面）';
  document.getElementById('turn-indicator').textContent = `再生中：${moveLabel}`;

  document.getElementById('replay-first-btn').disabled = cur === 0;
  document.getElementById('replay-prev-btn').disabled  = cur === 0;
  document.getElementById('replay-next-btn').disabled  = cur >= total;
  document.getElementById('replay-last-btn').disabled  = cur >= total;
}

// --- 再生モード開始 ---
function enterReplayMode(parsedMoves) {
  replayMode        = true;
  replayParsedMoves = parsedMoves;
  replayAllLabels   = [];
  replayIndex       = 0;

  initBoard();
  replaySnapshots = [snapshotState()]; // index 0 = 初期局面

  // 全スナップショットと棋譜ラベルを先読み生成
  for (let i = 0; i < parsedMoves.length; i++) {
    const move = toInternalMove(parsedMoves[i]);
    applyMove(move);
    replayAllLabels.push(kifuLog[kifuLog.length - 1]);
    replaySnapshots.push(snapshotState());
  }

  // 初期局面に戻す
  restoreSnapshot(replaySnapshots[0]);
  replayIndex = 0;

  // プレイヤー名・サブタイトルを再生モード用に変更
  document.querySelectorAll('.player-name').forEach(el => {
    el.textContent = el.textContent.replace('（あなた）', '').replace('（AI）', '');
  });
  document.querySelector('.header-sub').textContent = '棋譜再生';

  document.getElementById('replay-input-section').style.display = 'none';
  document.getElementById('replay-controls').style.display      = 'flex';
  document.getElementById('reset-btn').style.display            = 'none';

  updateReplayUI();
  renderAll();
}

// --- 盤面反転トグル ---
function toggleFlip() {
  boardFlipped = !boardFlipped;
  document.querySelector('main').classList.toggle('flipped', boardFlipped);
  document.getElementById('flip-btn').classList.toggle('active', boardFlipped);
  renderAll();
}

// --- 再生モード終了 ---
function exitReplayMode() {
  replayMode        = false;
  replayParsedMoves = [];
  replaySnapshots   = [];
  replayAllLabels   = [];
  replayIndex       = 0;

  // 反転を解除
  boardFlipped = false;
  document.querySelector('main').classList.remove('flipped');
  document.getElementById('flip-btn').classList.remove('active');

  // プレイヤー名・サブタイトルを元に戻す
  document.querySelector('#white-side .player-name').textContent = '後手（AI）';
  document.querySelector('#black-side .player-name').textContent = '先手（あなた）';
  document.querySelector('.header-sub').textContent = '先手（あなた）vs 後手（AI）';

  document.getElementById('replay-input-section').style.display = 'flex';
  document.getElementById('replay-controls').style.display      = 'none';
  document.getElementById('reset-btn').style.display            = '';

  resetGame();
}

// --- 読み込みボタン処理 ---
function loadKifuForReplay() {
  const text = document.getElementById('kifu-input').value.trim();
  if (!text) return;
  const moves = parseKIF(text);
  if (moves.length === 0) {
    alert('棋譜を読み取れませんでした。\nKIF形式（例： 1 ７六歩(77)）で入力してください。');
    return;
  }
  document.getElementById('kifu-input').value = '';
  enterReplayMode(moves);
}

// --- イベント登録 ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('load-kifu-btn').addEventListener('click', loadKifuForReplay);
  document.getElementById('replay-first-btn').addEventListener('click', replayFirst);
  document.getElementById('replay-prev-btn').addEventListener('click', replayPrev);
  document.getElementById('replay-next-btn').addEventListener('click', replayNext);
  document.getElementById('replay-last-btn').addEventListener('click', replayLast);
  document.getElementById('flip-btn').addEventListener('click', toggleFlip);
  document.getElementById('replay-exit-btn').addEventListener('click', exitReplayMode);
});
