'use strict';

const AI_DEPTH = 4;
const TIME_LIMIT_MS = 30000;

let searchStartTime = 0;
let timeoutFlag = false;
let nodeCount = 0;

// 履歴ヒューリスティック（β剪定を起こした手を記録し、次回より早く探索）
let historyTable = {};

function histKey(move) {
  return move.drop
    ? `d${move.piece}${move.to.row}${move.to.col}`
    : `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
}

// === 駒位置評価テーブル（先手視点・後手は上下反転）===

// 歩：前進するほど高評価、中央筋を優先
const PST_FU = [
  [30,30,30,35,35,35,30,30,30],
  [22,22,22,26,26,26,22,22,22],
  [14,14,14,18,18,18,14,14,14],
  [ 8, 8, 8,11,11,11, 8, 8, 8],
  [ 4, 4, 4, 6, 6, 6, 4, 4, 4],
  [ 1, 1, 1, 2, 2, 2, 1, 1, 1],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// 角：中段が良い
const PST_KA = [
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 5, 5, 5, 8, 8, 8, 5, 5, 5],
  [12,12,12,16,16,16,12,12,12],
  [18,18,18,22,22,22,18,18,18],
  [18,18,18,22,22,22,18,18,18],
  [12,12,12,16,16,16,12,12,12],
  [ 5, 5, 5, 8, 8, 8, 5, 5, 5],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// 飛：中段・中央が良い
const PST_HI = [
  [ 5, 5, 5, 8,10, 8, 5, 5, 5],
  [10,10,10,12,15,12,10,10,10],
  [12,12,12,15,18,15,12,12,12],
  [12,12,12,15,18,15,12,12,12],
  [10,10,10,12,15,12,10,10,10],
  [ 5, 5, 5, 8,10, 8, 5, 5, 5],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

// 玉：自陣（8〜9段目）が安全、中央・敵陣は危険
const PST_OU = [
  [-60,-60,-60,-60,-80,-60,-60,-60,-60],
  [-40,-40,-40,-50,-60,-50,-40,-40,-40],
  [-20,-20,-25,-30,-40,-30,-25,-20,-20],
  [-10,-10,-15,-20,-30,-20,-15,-10,-10],
  [-10,-10,-15,-20,-30,-20,-15,-10,-10],
  [ -5, -5,-10,-15,-20,-15,-10, -5, -5],
  [  0,  0, -5,-10,-15,-10, -5,  0,  0],
  [ 15, 20, 15,  5, -5,  5, 15, 20, 15],
  [ 25, 30, 25, 15,  5, 15, 25, 30, 25],
];

function getPST(absP, row, col, isBlack) {
  const r = isBlack ? row : (8 - row);
  switch (absP) {
    case FU: return PST_FU[r][col];
    case KA: return PST_KA[r][col];
    case HI: return PST_HI[r][col];
    case OU: return PST_OU[r][col];
    default:  return 0;
  }
}

// === 玉の安全性（周囲の守り駒の数を評価）===
function kingSafety(player) {
  const kingVal = player === 'black' ? OU : -OU;
  const s = sign(player);
  let kr = -1, kc = -1;
  for (let r = 0; r < 9 && kr === -1; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === kingVal) { kr = r; kc = c; break; }
    }
  }
  if (kr === -1) return 0;

  let defenders = 0;
  // 玉の隣接マスに味方の駒があるか
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const r = kr + dr, c = kc + dc;
    if (inBounds(r, c) && board[r][c] * s > 0) defenders++;
  }
  // 玉の前方に守りの歩があるか
  const d = player === 'black' ? -1 : 1;
  for (let dc = -1; dc <= 1; dc++) {
    const r = kr + d, c = kc + dc;
    if (inBounds(r, c) && board[r][c] === s * FU) defenders++;
  }
  return defenders * 18;
}

// === 評価関数 ===
function evaluate() {
  let score = 0;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === 0) continue;
      const absP = Math.abs(p);
      const isBlack = p > 0;
      const val = PIECE_VALUES[absP] + getPST(absP, r, c, isBlack);
      score += isBlack ? val : -val;
    }
  }

  // 持ち駒
  for (let p = 1; p <= 7; p++) {
    score += hands.black[p] * PIECE_VALUES[p] * 0.9;
    score -= hands.white[p] * PIECE_VALUES[p] * 0.9;
  }

  // 玉の安全性
  score += kingSafety('black');
  score -= kingSafety('white');

  return score;
}

// === 手の並び替え（α-β剪定の効率を上げる）===
function sortMoves(moves) {
  moves.sort((a, b) => {
    const va = (a.captured ? PIECE_VALUES[a.captured] * 2 : 0)
             + (a.promote  ? 60 : 0)
             + ((historyTable[histKey(a)] || 0));
    const vb = (b.captured ? PIECE_VALUES[b.captured] * 2 : 0)
             + (b.promote  ? 60 : 0)
             + ((historyTable[histKey(b)] || 0));
    return vb - va;
  });
}

// === 静止探索（取り合いを最後まで読んでから評価）===
// 駒取りが続く局面での評価ブレを防ぐ
function quiesce(alpha, beta, player) {
  if (timeoutFlag) return evaluate();

  const standPat = evaluate();

  if (player === 'black') {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    // 捕獲手のみ（価値の高い順）
    const captures = getPseudoLegal(player)
      .filter(m => m.captured > 0)
      .sort((a, b) => PIECE_VALUES[b.captured] - PIECE_VALUES[a.captured]);

    for (const move of captures) {
      const st = saveState();
      executeMove(move, player);
      if (isInCheck(player)) { restoreState(st); continue; }
      const val = quiesce(alpha, beta, 'white');
      restoreState(st);
      if (val >= beta) return beta;
      if (val > alpha) alpha = val;
    }
    return alpha;

  } else {
    if (standPat <= alpha) return alpha;
    if (standPat < beta) beta = standPat;

    const captures = getPseudoLegal(player)
      .filter(m => m.captured > 0)
      .sort((a, b) => PIECE_VALUES[b.captured] - PIECE_VALUES[a.captured]);

    for (const move of captures) {
      const st = saveState();
      executeMove(move, player);
      if (isInCheck(player)) { restoreState(st); continue; }
      const val = quiesce(alpha, beta, 'black');
      restoreState(st);
      if (val <= alpha) return alpha;
      if (val < beta) beta = val;
    }
    return beta;
  }
}

// === アルファベータ探索 ===
function alphaBeta(depth, alpha, beta, player) {
  nodeCount++;
  if (nodeCount % 1000 === 0 && Date.now() - searchStartTime > TIME_LIMIT_MS) {
    timeoutFlag = true;
  }
  if (timeoutFlag) return evaluate();

  // 末端ノード → 静止探索へ（駒取りがあれば読み続ける）
  if (depth === 0) return quiesce(alpha, beta, player);

  const moves = getLegalMoves(player);
  if (moves.length === 0) {
    return player === 'black'
      ? -90000 + (AI_DEPTH - depth)
      :  90000 - (AI_DEPTH - depth);
  }

  sortMoves(moves);

  if (player === 'black') {
    let maxVal = -Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'white');
      restoreState(st);
      if (val > maxVal) maxVal = val;
      if (val > alpha) {
        alpha = val;
        // 静かな手（捕獲でない）でβ超えなら履歴を更新
        if (!move.captured) {
          historyTable[histKey(move)] = (historyTable[histKey(move)] || 0) + depth * depth;
        }
      }
      if (beta <= alpha) break; // β剪定
    }
    return maxVal;
  } else {
    let minVal = Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'black');
      restoreState(st);
      if (val < minVal) minVal = val;
      if (val < beta) {
        beta = val;
        if (!move.captured) {
          historyTable[histKey(move)] = (historyTable[histKey(move)] || 0) + depth * depth;
        }
      }
      if (beta <= alpha) break; // α剪定
    }
    return minVal;
  }
}

// 持ち駒の総数を数える
function totalHandPieces() {
  let n = 0;
  for (let p = 1; p <= 7; p++) n += hands.black[p] + hands.white[p];
  return n;
}

// 局面の複雑度に応じた探索深さを返す
// 持ち駒が増えると打ち手が爆発するため深さを下げて速度を保つ
function getSearchDepth() {
  const h = totalHandPieces();
  if (h >= 10) return 3; // 持ち駒10枚以上 → 深さ3
  if (h >= 6)  return 3; // 持ち駒 6〜9枚  → 深さ3
  return AI_DEPTH;       // 持ち駒 0〜5枚  → 深さ4
}

// === AIの最善手を返す ===
function getBestMove() {
  // 定跡があれば即座に返す（高速・人間らしい序盤）
  const bookMove = getBookMove();
  if (bookMove) return bookMove;

  const moves = getLegalMoves('white');
  if (moves.length === 0) return null;

  sortMoves(moves);

  searchStartTime = Date.now();
  timeoutFlag = false;
  nodeCount = 0;

  const depth = getSearchDepth(); // 局面複雑度に応じた深さ

  let bestMove = moves[0];
  let bestScore = Infinity;

  for (const move of moves) {
    if (timeoutFlag) break;
    const st = saveState();
    executeMove(move, 'white');
    const score = alphaBeta(depth - 1, -Infinity, Infinity, 'black');
    restoreState(st);
    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

// ゲームリセット時に履歴をクリア
function resetHistory() {
  historyTable = {};
}
