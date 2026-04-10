'use strict';

// === 駒定数 ===
const FU=1, KY=2, KE=3, GI=4, KI=5, KA=6, HI=7, OU=8;
const TO=9, NY=10, NK=11, NG=12, UM=13, RY=14;

const PIECE_CHAR = ['','歩','香','桂','銀','金','角','飛','玉','と','杏','圭','全','馬','竜'];
const PIECE_VALUES = [0, 100, 400, 450, 640, 690, 890, 1040, 15000, 600, 600, 600, 680, 1150, 1300];

// 成り前→成り後
const PROMOTE_MAP = {1:9, 2:10, 3:11, 4:12, 6:13, 7:14};
// 成り後→成り前（持ち駒に戻るとき）
const DEMOTE_MAP  = {9:1, 10:2, 11:3, 12:4, 13:6, 14:7};

// === ゲーム状態 ===
let board = [];
let hands = { black: new Array(15).fill(0), white: new Array(15).fill(0) };
let currentPlayer = 'black';
let gameOver = false;
let winner = null;
let kifuLog = [];

function initBoard() {
  board = [
    [-KY,-KE,-GI,-KI,-OU,-KI,-GI,-KE,-KY],
    [  0,-HI,  0,  0,  0,  0,  0,-KA,  0],
    [-FU,-FU,-FU,-FU,-FU,-FU,-FU,-FU,-FU],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [ FU, FU, FU, FU, FU, FU, FU, FU, FU],
    [  0, KA,  0,  0,  0,  0,  0, HI,  0],
    [ KY, KE, GI, KI, OU, KI, GI, KE, KY]
  ];
  hands = { black: new Array(15).fill(0), white: new Array(15).fill(0) };
  currentPlayer = 'black';
  gameOver = false;
  winner = null;
  kifuLog = [];
}

// === ユーティリティ ===
function sign(player) { return player === 'black' ? 1 : -1; }
function opponent(player) { return player === 'black' ? 'white' : 'black'; }
function isOwn(piece, player) { return player === 'black' ? piece > 0 : piece < 0; }
function inBounds(r, c) { return r >= 0 && r <= 8 && c >= 0 && c <= 8; }
function inPromZone(row, player) { return player === 'black' ? row <= 2 : row >= 6; }

// 行き所のない駒チェック（成りが必須の位置）
function mustPromote(absP, toRow, player) {
  if (player === 'black') {
    if (absP === FU || absP === KY) return toRow === 0;
    if (absP === KE) return toRow <= 1;
  } else {
    if (absP === FU || absP === KY) return toRow === 8;
    if (absP === KE) return toRow >= 7;
  }
  return false;
}

// 成れる駒かどうか
function canPromotePiece(absP) {
  // FU(1),KY(2),KE(3),GI(4),KA(6),HI(7) のみ成れる
  return absP <= 7 && absP !== KI;
}

// === 指し手生成（1マスから） ===
function generateMovesFromSquare(row, col, player) {
  const piece = board[row][col];
  if (!isOwn(piece, player)) return [];
  const absP = Math.abs(piece);
  const d = player === 'black' ? -1 : 1; // 前進方向
  const moves = [];

  function tryAdd(tr, tc) {
    if (!inBounds(tr, tc)) return;
    const target = board[tr][tc];
    if (isOwn(target, player)) return;
    const capturedAbs = target !== 0 ? Math.abs(target) : 0;
    const mustProm = mustPromote(absP, tr, player);
    const canProm = canPromotePiece(absP) && (inPromZone(tr, player) || inPromZone(row, player));
    if (mustProm) {
      moves.push({ from:{row,col}, to:{row:tr,col:tc}, piece:absP, promote:true, drop:false, captured:capturedAbs });
    } else {
      moves.push({ from:{row,col}, to:{row:tr,col:tc}, piece:absP, promote:false, drop:false, captured:capturedAbs });
      if (canProm) {
        moves.push({ from:{row,col}, to:{row:tr,col:tc}, piece:absP, promote:true, drop:false, captured:capturedAbs });
      }
    }
  }

  // スライド駒（香・角・飛・馬・竜）
  function slide(dr, dc) {
    for (let r = row + dr, c = col + dc; inBounds(r, c); r += dr, c += dc) {
      if (isOwn(board[r][c], player)) break;
      tryAdd(r, c);
      if (board[r][c] !== 0) break; // 相手駒で停止
    }
  }

  switch (absP) {
    case FU: tryAdd(row + d, col); break;
    case KY: slide(d, 0); break;
    case KE: tryAdd(row + 2*d, col - 1); tryAdd(row + 2*d, col + 1); break;
    case GI:
      tryAdd(row+d, col-1); tryAdd(row+d, col); tryAdd(row+d, col+1);
      tryAdd(row-d, col-1); tryAdd(row-d, col+1);
      break;
    case KI: case TO: case NY: case NK: case NG:
      // 金将と同じ動き
      tryAdd(row+d, col-1); tryAdd(row+d, col); tryAdd(row+d, col+1);
      tryAdd(row,   col-1);                     tryAdd(row,   col+1);
      tryAdd(row-d, col);
      break;
    case KA: slide(-1,-1); slide(-1,1); slide(1,-1); slide(1,1); break;
    case HI: slide(-1,0);  slide(1,0);  slide(0,-1); slide(0,1); break;
    case OU:
      [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
        .forEach(([dr,dc]) => tryAdd(row+dr, col+dc));
      break;
    case UM: // 馬：角の動き＋縦横1マス
      slide(-1,-1); slide(-1,1); slide(1,-1); slide(1,1);
      [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => tryAdd(row+dr, col+dc));
      break;
    case RY: // 竜：飛の動き＋斜め1マス
      slide(-1,0); slide(1,0); slide(0,-1); slide(0,1);
      [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => tryAdd(row+dr, col+dc));
      break;
  }
  return moves;
}

// === 打ち指し手生成 ===
function generateDropMoves(player) {
  const hand = hands[player];
  const moves = [];
  // OU(8)は打てない。成り駒も打てない（持ち駒は1-7のみ）
  for (let p = 1; p <= 7; p++) {
    if (hand[p] === 0) continue;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0) continue;
        // 行き所のない駒は打てない
        if (mustPromote(p, r, player)) continue;
        // 二歩禁止
        if (p === FU) {
          const fuVal = player === 'black' ? FU : -FU;
          let nifu = false;
          for (let rr = 0; rr < 9; rr++) {
            if (board[rr][c] === fuVal) { nifu = true; break; }
          }
          if (nifu) continue;
        }
        moves.push({ from:null, to:{row:r,col:c}, piece:p, promote:false, drop:true, captured:0 });
      }
    }
  }
  return moves;
}

// === 王手判定 ===
function isInCheck(player) {
  // 玉の位置を探す
  const kingVal = player === 'black' ? OU : -OU;
  let kr = -1, kc = -1;
  outer: for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === kingVal) { kr = r; kc = c; break outer; }
    }
  }
  if (kr === -1) return true; // 玉がいない（バグ防止）

  // 相手が玉のマスに指せるか確認
  const opp = opponent(player);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!isOwn(board[r][c], opp)) continue;
      const ms = generateMovesFromSquare(r, c, opp);
      if (ms.some(m => m.to.row === kr && m.to.col === kc)) return true;
    }
  }
  return false;
}

// === 状態の保存・復元 ===
function saveState() {
  return {
    board: board.map(r => r.slice()),
    hands: { black: hands.black.slice(), white: hands.white.slice() }
  };
}

function restoreState(st) {
  board = st.board.map(r => r.slice());
  hands = { black: st.hands.black.slice(), white: st.hands.white.slice() };
}

// === 指し手の実行（AI探索でも使用） ===
function executeMove(move, player) {
  const s = sign(player);
  if (move.drop) {
    board[move.to.row][move.to.col] = s * move.piece;
    hands[player][move.piece]--;
  } else {
    const toPiece = board[move.to.row][move.to.col];
    if (toPiece !== 0) {
      // 捕獲した駒は成りを解除して持ち駒に
      const demoted = DEMOTE_MAP[Math.abs(toPiece)] || Math.abs(toPiece);
      hands[player][demoted]++;
    }
    board[move.from.row][move.from.col] = 0;
    board[move.to.row][move.to.col] = s * (move.promote ? PROMOTE_MAP[move.piece] : move.piece);
  }
}

// === 疑似合法手の生成（王手放置を含む） ===
function getPseudoLegal(player) {
  const moves = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (isOwn(board[r][c], player)) {
        moves.push(...generateMovesFromSquare(r, c, player));
      }
    }
  }
  moves.push(...generateDropMoves(player));
  return moves;
}

// === 合法手の生成（王手放置・打ち歩詰め除外） ===
function getLegalMoves(player) {
  const pseudo = getPseudoLegal(player);
  const legal = [];
  for (const move of pseudo) {
    const st = saveState();
    executeMove(move, player);

    let ok = !isInCheck(player);

    // 打ち歩詰め禁止チェック
    if (ok && move.drop && move.piece === FU && isInCheck(opponent(player))) {
      const oppPseudo = getPseudoLegal(opponent(player));
      let oppHasEscape = false;
      for (const om of oppPseudo) {
        const st2 = saveState();
        executeMove(om, opponent(player));
        if (!isInCheck(opponent(player))) oppHasEscape = true;
        restoreState(st2);
        if (oppHasEscape) break;
      }
      if (!oppHasEscape) ok = false; // 打ち歩詰め
    }

    restoreState(st);
    if (ok) legal.push(move);
  }
  return legal;
}

// === 実際の指し手適用（棋譜記録・詰み判定つき） ===
function applyMove(move) {
  // 棋譜に記録（標準形式：☗７七歩、☖２三角成、☗６五桂打）
  const ROW_KANJI   = ['一','二','三','四','五','六','七','八','九'];
  const COL_FULLWIDTH = ['','１','２','３','４','５','６','７','８','９'];
  const kifuCol = COL_FULLWIDTH[9 - move.to.col];
  const kifuRow = ROW_KANJI[move.to.row];
  const prefix = currentPlayer === 'black' ? '☗' : '☖';
  let suffix;
  if (move.drop) {
    suffix = '打';
  } else {
    const fromKifCol = 9 - move.from.col;
    const fromKifRow = move.from.row + 1;
    suffix = (move.promote ? '成' : '') + `(${fromKifCol}${fromKifRow})`;
  }
  kifuLog.push(`${prefix}${kifuCol}${kifuRow}${PIECE_CHAR[move.piece]}${suffix}`);

  executeMove(move, currentPlayer);
  currentPlayer = opponent(currentPlayer);

  // 詰み判定
  if (getLegalMoves(currentPlayer).length === 0) {
    gameOver = true;
    winner = opponent(currentPlayer);
  }
}
