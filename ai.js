'use strict';

// 探索深さ（4手読み = 1級〜初段レベル相当）
const AI_DEPTH = 4;
// 思考時間上限（ミリ秒）
const TIME_LIMIT_MS = 55000;

let searchStartTime = 0;
let timeoutFlag = false;
let nodeCount = 0;

// === 評価関数 ===

// 歩の前進ボーナステーブル（先手視点）
// 先手歩: row 6が初期位置、row 0に近づくほど高評価
const FU_ADV_BLACK = [30, 25, 20, 15, 10, 5, 0, 0, 0];
// 後手歩: row 2が初期位置、row 8に近づくほど高評価
const FU_ADV_WHITE = [0, 0, 0, 5, 10, 15, 20, 25, 30];

// 角・飛の活躍評価（中段にいるほど良い）
const CENTER_BONUS = [0, 0, 5, 10, 15, 10, 5, 0, 0];

function evaluate() {
  let score = 0;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p === 0) continue;
      const absP = Math.abs(p);
      const isBlack = p > 0;
      let val = PIECE_VALUES[absP];

      // 歩の前進ボーナス
      if (absP === FU) {
        val += isBlack ? FU_ADV_BLACK[r] : FU_ADV_WHITE[r];
      }
      // 角・飛の活躍ボーナス（縦方向の中段評価）
      if (absP === KA || absP === HI) {
        val += CENTER_BONUS[r];
      }

      score += isBlack ? val : -val;
    }
  }

  // 持ち駒の価値（盤上の90%として計上）
  for (let p = 1; p <= 7; p++) {
    score += hands.black[p] * PIECE_VALUES[p] * 0.9;
    score -= hands.white[p] * PIECE_VALUES[p] * 0.9;
  }

  return score;
}

// === 手の並び替え（有効なα-β剪定のため）===
function sortMoves(moves) {
  moves.sort((a, b) => {
    // 駒取り > 成り > 通常の順に優先
    const va = (a.captured ? PIECE_VALUES[a.captured] : 0) + (a.promote ? 50 : 0);
    const vb = (b.captured ? PIECE_VALUES[b.captured] : 0) + (b.promote ? 50 : 0);
    return vb - va;
  });
}

// === アルファベータ探索 ===
function alphaBeta(depth, alpha, beta, player) {
  // 時間切れチェック（1000ノードごとに確認）
  nodeCount++;
  if (nodeCount % 1000 === 0 && Date.now() - searchStartTime > TIME_LIMIT_MS) {
    timeoutFlag = true;
  }
  if (timeoutFlag) return evaluate();

  // 葉ノード: 静的評価
  if (depth === 0) {
    // 王手がかかっている場合のみ詰みチェック
    if (isInCheck(player) && getLegalMoves(player).length === 0) {
      return player === 'black' ? -90000 : 90000;
    }
    return evaluate();
  }

  const moves = getLegalMoves(player);
  if (moves.length === 0) {
    // 詰み: 相手の勝ち（浅い詰みほど高評価）
    return player === 'black'
      ? -90000 + (AI_DEPTH - depth)
      :  90000 - (AI_DEPTH - depth);
  }

  sortMoves(moves);

  if (player === 'black') {
    // 先手: スコアを最大化
    let maxVal = -Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'white');
      restoreState(st);
      if (val > maxVal) maxVal = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break; // β剪定
    }
    return maxVal;
  } else {
    // 後手(AI): スコアを最小化
    let minVal = Infinity;
    for (const move of moves) {
      const st = saveState();
      executeMove(move, player);
      const val = alphaBeta(depth - 1, alpha, beta, 'black');
      restoreState(st);
      if (val < minVal) minVal = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break; // α剪定
    }
    return minVal;
  }
}

// === AIの最善手を返す ===
function getBestMove() {
  const moves = getLegalMoves('white');
  if (moves.length === 0) return null;

  sortMoves(moves);

  // タイムアウト管理の初期化
  searchStartTime = Date.now();
  timeoutFlag = false;
  nodeCount = 0;

  let bestMove = moves[0]; // 時間切れでも最低1手は返す
  let bestScore = Infinity;

  for (const move of moves) {
    if (timeoutFlag) break; // 時間切れなら現時点の最善手を返す
    const st = saveState();
    executeMove(move, 'white');
    const score = alphaBeta(AI_DEPTH - 1, -Infinity, Infinity, 'black');
    restoreState(st);
    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}
