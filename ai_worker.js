'use strict';

importScripts('board.js', 'opening.js', 'ai.js');

self.onmessage = function(e) {
  const d = e.data;
  board         = d.board.map(r => [...r]);
  hands         = { black: [...d.hands.black], white: [...d.hands.white] };
  currentPlayer = d.currentPlayer;
  gameOver      = false;
  winner        = null;
  kifuLog       = [...d.kifuLog];
  TIME_LIMIT_MS = d.timeLimit;

  const move = getBestMove();
  self.postMessage(move);
};
