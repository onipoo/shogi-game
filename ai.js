'use strict';

const MAX_THINK_MS = 30000; // 思考時間の上限
const MIN_THINK_MS =  2000; // 思考時間の下限
let TIME_LIMIT_MS  =  8000; // getBestMove内で局面に応じて動的に設定される

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

// === Zobristハッシュ（置換表用） ===
// xorshift32による決定論的PRNG（再現性のため固定シード）
let _zs = 0x9E3779B9;
function _zrand() {
  _zs ^= _zs << 13; _zs ^= (_zs >>> 17); _zs ^= _zs << 5;
  return _zs | 0;
}

// 盤上: ZOBRIST_BOARD[マス(0-80) * 29 + 駒インデックス(1-28)]
// 駒インデックス: p>0→p(1-14), p<0→14+(-p)(15-28)
const ZOBRIST_BOARD  = new Int32Array(81 * 29);
// 持ち駒: [駒種(0-7)][枚数(0-18)] ※枚数0は0（寄与なし）
const ZOBRIST_HAND_B = new Int32Array(8 * 19);
const ZOBRIST_HAND_W = new Int32Array(8 * 19);
let ZOBRIST_SIDE = 0;

(function _initZobrist() {
  for (let i = 0; i < 81 * 29; i++) ZOBRIST_BOARD[i] = _zrand();
  for (let p = 1; p <= 7; p++) {
    ZOBRIST_HAND_B[p * 19] = 0; // 枚数0 → ハッシュ寄与なし
    ZOBRIST_HAND_W[p * 19] = 0;
    for (let cnt = 1; cnt <= 18; cnt++) {
      ZOBRIST_HAND_B[p * 19 + cnt] = _zrand();
      ZOBRIST_HAND_W[p * 19 + cnt] = _zrand();
    }
  }
  ZOBRIST_SIDE = _zrand();
})();

function _pieceIdx(p) { return p > 0 ? p : 14 - p; } // +1..+14→1..14, -1..-14→15..28

function computeZobrist(player) {
  let h = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p !== 0) h ^= ZOBRIST_BOARD[(r * 9 + c) * 29 + _pieceIdx(p)];
    }
  }
  for (let p = 1; p <= 7; p++) {
    const bc = hands.black[p], wc = hands.white[p];
    if (bc > 0) h ^= ZOBRIST_HAND_B[p * 19 + bc];
    if (wc > 0) h ^= ZOBRIST_HAND_W[p * 19 + wc];
  }
  if (player === 'white') h ^= ZOBRIST_SIDE;
  return h | 0; // 32bit符号付きに正規化
}

// === 置換表（Transposition Table） ===
const TT_SIZE       = 1 << 17; // 131072エントリー
const TT_MASK       = TT_SIZE - 1;
const TT_EXACT      = 0;
const TT_LOWERBOUND = 1; // 失敗高（真値 ≥ score）
const TT_UPPERBOUND = 2; // 失敗低（真値 ≤ score）

const TT_HASH  = new Int32Array(TT_SIZE); // ハッシュ（0=空き）
const TT_SCORE = new Int32Array(TT_SIZE);
const TT_DEPTH = new Int8Array(TT_SIZE);
const TT_FLAG  = new Uint8Array(TT_SIZE);
const TT_MOVE  = new Int32Array(TT_SIZE); // エンコード済み最善手

// 指し手エンコード: 打ち→bit17=1|駒(4b)|行先行(4b)|行先列(4b), 盤上→移動元行(4b)|列(4b)|行先行(4b)|列(4b)|成(1b)
function _encodeMv(m) {
  if (!m) return 0;
  if (m.drop) return (1 << 17) | (m.piece << 8) | (m.to.row << 4) | m.to.col;
  return (m.from.row << 13) | (m.from.col << 9) | (m.to.row << 5) | (m.to.col << 1) | (m.promote ? 1 : 0);
}

function _findTtMove(encoded, moves) {
  if (!encoded) return null;
  if (encoded & (1 << 17)) {
    const piece = (encoded >> 8) & 0xF;
    const toRow = (encoded >> 4) & 0xF;
    const toCol =  encoded       & 0xF;
    return moves.find(m => m.drop && m.piece === piece && m.to.row === toRow && m.to.col === toCol) || null;
  }
  const fromRow = (encoded >> 13) & 0xF;
  const fromCol = (encoded >>  9) & 0xF;
  const toRow   = (encoded >>  5) & 0xF;
  const toCol   = (encoded >>  1) & 0xF;
  const promote = (encoded & 1) === 1;
  return moves.find(m => !m.drop && m.from.row === fromRow && m.from.col === fromCol &&
    m.to.row === toRow && m.to.col === toCol && m.promote === promote) || null;
}

function ttGet(hash, depth, alpha, beta) {
  const idx = hash & TT_MASK;
  if (TT_HASH[idx] !== hash)       return null; // ミス or 衝突
  if (TT_DEPTH[idx] < depth)       return null; // 探索深さ不足
  const score = TT_SCORE[idx];
  const flag  = TT_FLAG[idx];
  if (flag === TT_EXACT)                        return score;
  if (flag === TT_LOWERBOUND && score >= beta)  return score;
  if (flag === TT_UPPERBOUND && score <= alpha) return score;
  return null;
}

function ttPut(hash, depth, score, flag, move) {
  const idx = hash & TT_MASK;
  // 既存エントリより今回の方が深い場合のみ上書き（浅い結果で良いデータを消さない）
  if (TT_HASH[idx] !== 0 && TT_HASH[idx] !== hash && TT_DEPTH[idx] > depth) return;
  TT_HASH[idx]  = hash;
  TT_SCORE[idx] = score;
  TT_DEPTH[idx] = depth;
  TT_FLAG[idx]  = flag;
  TT_MOVE[idx]  = _encodeMv(move);
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
// ttHint: 置換表から得た最善手（TT_MOVEのエンコード値）
function sortMoves(moves, ttHintEncoded = 0) {
  const ttHint = ttHintEncoded ? _findTtMove(ttHintEncoded, moves) : null;

  moves.sort((a, b) => {
    // 置換表のヒント手を最優先
    if (a === ttHint) return -1;
    if (b === ttHint) return  1;

    // MVV-LVA: 取られる駒の価値 - 取る駒の価値（安い駒で高い駒を取る手を優先）
    const aCapVal = a.captured ? PIECE_VALUES[a.captured] : 0;
    const bCapVal = b.captured ? PIECE_VALUES[b.captured] : 0;
    const aAttVal = a.captured ? PIECE_VALUES[a.drop ? a.piece : Math.abs(board[a.from.row][a.from.col])] : 0;
    const bAttVal = b.captured ? PIECE_VALUES[b.drop ? b.piece : Math.abs(board[b.from.row][b.from.col])] : 0;

    const va = aCapVal * 10 - aAttVal
             + (a.promote ? 60 : 0)
             + (historyTable[histKey(a)] || 0);
    const vb = bCapVal * 10 - bAttVal
             + (b.promote ? 60 : 0)
             + (historyTable[histKey(b)] || 0);
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

  // 置換表チェック
  const hash = computeZobrist(player);
  const ttScore = ttGet(hash, depth, alpha, beta);
  if (ttScore !== null) return ttScore;

  const moves = getLegalMoves(player);
  if (moves.length === 0) {
    // 浅い位置（depthが大きい）での詰みを優先する
    const mateVal = player === 'black' ? -90000 - depth : 90000 + depth;
    ttPut(hash, depth, mateVal, TT_EXACT, null);
    return mateVal;
  }

  // 置換表のヒント手を先頭に置いてソート
  sortMoves(moves, TT_MOVE[hash & TT_MASK]);

  const origAlpha = alpha;
  const origBeta  = beta;
  let bestMove = moves[0];

  if (player === 'black') {
    let maxVal = -Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'white');
      restoreState(st);
      if (val > maxVal) { maxVal = val; bestMove = move; }
      if (val > alpha) {
        alpha = val;
        // 静かな手（捕獲でない）でβ超えなら履歴を更新
        if (!move.captured) {
          historyTable[histKey(move)] = (historyTable[histKey(move)] || 0) + depth * depth;
        }
      }
      if (beta <= alpha) break; // β剪定
    }
    if (!timeoutFlag) {
      const flag = maxVal >= beta ? TT_LOWERBOUND : maxVal <= origAlpha ? TT_UPPERBOUND : TT_EXACT;
      ttPut(hash, depth, maxVal, flag, bestMove);
    }
    return maxVal;
  } else {
    let minVal = Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'black');
      restoreState(st);
      if (val < minVal) { minVal = val; bestMove = move; }
      if (val < beta) {
        beta = val;
        if (!move.captured) {
          historyTable[histKey(move)] = (historyTable[histKey(move)] || 0) + depth * depth;
        }
      }
      if (beta <= alpha) break; // α剪定
    }
    if (!timeoutFlag) {
      const flag = minVal <= alpha ? TT_UPPERBOUND : minVal >= origBeta ? TT_LOWERBOUND : TT_EXACT;
      ttPut(hash, depth, minVal, flag, bestMove);
    }
    return minVal;
  }
}

// 合法手数から基本思考時間を決める
function calcBaseThinkTime(numMoves) {
  if (numMoves <=  5) return MIN_THINK_MS; // ほぼ強制手
  if (numMoves <= 20) return  5000;
  if (numMoves <= 50) return  8000;
  if (numMoves <= 80) return 12000;
  return 15000;                            // 非常に複雑な局面
}

// === AIの最善手を返す（反復深化＋アダプティブ思考時間）===
function getBestMove() {
  // 定跡があれば即座に返す（高速・人間らしい序盤）
  const bookMove = getBookMove();
  if (bookMove) return bookMove;

  const moves = getLegalMoves('white');
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0]; // 1手しかなければ即指し

  sortMoves(moves);

  // 局面の複雑さに応じた基本思考時間を設定
  TIME_LIMIT_MS   = calcBaseThinkTime(moves.length);
  searchStartTime = Date.now();
  timeoutFlag     = false;
  nodeCount       = 0;

  let bestMove    = moves[0];
  let prevBestKey = null;

  // 深さ1から順に時間内で深くする
  for (let depth = 1; depth <= 10; depth++) {
    if (Date.now() - searchStartTime >= TIME_LIMIT_MS) break;
    timeoutFlag = false; // 新しい深さの探索を開始

    // 前のイテレーションのbestMoveを先頭に（反復深化の効率化）
    const bestIdx = moves.indexOf(bestMove);
    if (bestIdx > 0) { moves.splice(bestIdx, 1); moves.unshift(bestMove); }

    let iterBest = null;
    let iterBestScore = Infinity;

    for (const move of moves) {
      if (timeoutFlag) break;
      const st = saveState();
      executeMove(move, 'white');
      const score = alphaBeta(depth - 1, -Infinity, Infinity, 'black');
      restoreState(st);
      if (score < iterBestScore) {
        iterBestScore = score;
        iterBest = move;
      }
    }

    // 完了した深さの結果のみ採用
    if (!timeoutFlag && iterBest) {
      const key = histKey(iterBest);
      if (prevBestKey !== null && key !== prevBestKey) {
        // ベスト手が変わった → 局面が不安定 → 思考時間を最大1.5倍延長
        TIME_LIMIT_MS = Math.min(Math.round(TIME_LIMIT_MS * 1.5), MAX_THINK_MS);
      }
      prevBestKey = key;
      bestMove    = iterBest;
    }
  }

  return bestMove;
}

// ゲームリセット時に履歴と置換表をクリア
function resetHistory() {
  historyTable = {};
  TT_HASH.fill(0); // hash=0 を空きスロットのセンチネルとして使用
}
