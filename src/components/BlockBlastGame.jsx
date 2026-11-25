import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  BookPlus,
  CheckCircle2,
  Flame,
  Gamepad2,
  HelpCircle,
  History,
  Lightbulb,
  Lock,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trophy,
  Unlock,
} from 'lucide-react';
import { generateGameFeedback } from '../services/aiService';

const GRID_SIZE = 8;
const BEST_SCORE_KEY = 'vocab_block_blast_best_score';

const PIECE_COLORS = ['coral', 'amber', 'emerald', 'sky', 'violet', 'rose'];

const PIECE_SHAPES = [
  [[1]],
  [[1, 1]],
  [[1], [1]],
  [[1, 1, 1]],
  [[1], [1], [1]],
  [[1, 1, 1, 1]],
  [[1], [1], [1], [1]],
  [
    [1, 1],
    [1, 1],
  ],
  [
    [1, 0],
    [1, 1],
  ],
  [
    [0, 1],
    [1, 1],
  ],
  [
    [1, 1],
    [1, 0],
  ],
  [
    [1, 1],
    [0, 1],
  ],
  [
    [1, 1, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ],
];

function createEmptyGrid() {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
}

function createRandomPiece(seed = 0) {
  const shape = PIECE_SHAPES[Math.floor(Math.random() * PIECE_SHAPES.length)];
  const color = PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)];
  return {
    id: `${Date.now()}-${seed}-${Math.random().toString(36).slice(2, 7)}`,
    shape,
    color,
  };
}

function generateTrayPieces() {
  return [createRandomPiece(0), createRandomPiece(1), createRandomPiece(2)];
}

function canPlacePiece(grid, shape, topRow, leftCol) {
  for (let r = 0; r < shape.length; r += 1) {
    for (let c = 0; c < shape[r].length; c += 1) {
      if (!shape[r][c]) continue;
      const targetRow = topRow + r;
      const targetCol = leftCol + c;
      if (
        targetRow < 0 ||
        targetRow >= GRID_SIZE ||
        targetCol < 0 ||
        targetCol >= GRID_SIZE ||
        grid[targetRow][targetCol] !== null
      ) {
        return false;
      }
    }
  }
  return true;
}

function canAnyPieceFit(grid, tray) {
  return tray.some((piece) => {
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        if (canPlacePiece(grid, piece.shape, r, c)) {
          return true;
        }
      }
    }
    return false;
  });
}

function getAnchorOrigin(shape, hoverRow, hoverCol) {
  const height = shape.length;
  const width = shape[0].length;
  return {
    topRow: hoverRow - Math.floor(height / 2),
    leftCol: hoverCol - Math.floor(width / 2),
  };
}

function getCompletedLinesAfterPlacement(grid, shape, topRow, leftCol, color) {
  const nextGrid = grid.map((row) => [...row]);
  let cellsPlaced = 0;

  for (let r = 0; r < shape.length; r += 1) {
    for (let c = 0; c < shape[r].length; c += 1) {
      if (!shape[r][c]) continue;
      nextGrid[topRow + r][leftCol + c] = color;
      cellsPlaced += 1;
    }
  }

  const fullRows = [];
  const fullCols = [];

  for (let r = 0; r < GRID_SIZE; r += 1) {
    if (nextGrid[r].every((cell) => cell !== null)) {
      fullRows.push(r);
    }
  }

  for (let c = 0; c < GRID_SIZE; c += 1) {
    let full = true;
    for (let r = 0; r < GRID_SIZE; r += 1) {
      if (nextGrid[r][c] === null) {
        full = false;
        break;
      }
    }
    if (full) {
      fullCols.push(c);
    }
  }

  for (const r of fullRows) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      nextGrid[r][c] = null;
    }
  }

  for (const c of fullCols) {
    for (let r = 0; r < GRID_SIZE; r += 1) {
      nextGrid[r][c] = null;
    }
  }

  return { nextGrid, fullRows, fullCols, cellsPlaced };
}

function normalizeAnswer(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatMaskedWord(word, revealedCount) {
  const chars = word.trim().split('');
  let lettersShown = 0;
  return chars
    .map((char) => {
      if (char === ' ' || char === '-') return char;
      if (lettersShown < revealedCount) {
        lettersShown += 1;
        return char;
      }
      return '_';
    })
    .join(' ');
}

export default function BlockBlastGame({
  vocabSet,
  items,
  savedSets,
  onSelectSavedSet,
  onNewGame,
  onOpenVocabModal,
  onSwitchToFreePlay,
}) {
  const hasVocabMode = items.length > 0;

  const [grid, setGrid] = useState(createEmptyGrid);
  const [tray, setTray] = useState(generateTrayPieces);
  const [isPlacementUnlocked, setIsPlacementUnlocked] = useState(!hasVocabMode);
  const [isEnded, setIsEnded] = useState(false);

  const [wordIndex, setWordIndex] = useState(0);
  const [answerInput, setAnswerInput] = useState('');
  const [answerFeedback, setAnswerFeedback] = useState(null);
  const [revealedHints, setRevealedHints] = useState(0);

  const [hoverCell, setHoverCell] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [clearingFlash, setClearingFlash] = useState({ rows: [], cols: [] });

  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    const saved = Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
    return Number.isFinite(saved) ? saved : 0;
  });
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [linesCleared, setLinesCleared] = useState(0);
  const [correctWords, setCorrectWords] = useState(0);
  const [missedWords, setMissedWords] = useState([]);
  const [bannerText, setBannerText] = useState('');

  const [endReason, setEndReason] = useState('');
  const [aiFeedback, setAiFeedback] = useState('');
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [setSelectError, setSetSelectError] = useState('');

  const gridRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (hasVocabMode && !isPlacementUnlocked && !isEnded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [hasVocabMode, isPlacementUnlocked, isEnded, wordIndex]);

  useEffect(() => {
    if (score > bestScore) {
      setBestScore(score);
      localStorage.setItem(BEST_SCORE_KEY, String(score));
    }
  }, [score, bestScore]);

  const currentWord = hasVocabMode ? items[wordIndex] || null : null;
  const activePiece = dragState?.piece || null;

  let previewInfo = null;
  if (!isEnded && isPlacementUnlocked && activePiece && hoverCell) {
    const { topRow, leftCol } = getAnchorOrigin(
      activePiece.shape,
      hoverCell.row,
      hoverCell.col
    );
    const valid = canPlacePiece(grid, activePiece.shape, topRow, leftCol);
    const cells = new Set();

    for (let r = 0; r < activePiece.shape.length; r += 1) {
      for (let c = 0; c < activePiece.shape[r].length; c += 1) {
        if (!activePiece.shape[r][c]) continue;
        const targetRow = topRow + r;
        const targetCol = leftCol + c;
        if (
          targetRow >= 0 &&
          targetRow < GRID_SIZE &&
          targetCol >= 0 &&
          targetCol < GRID_SIZE
        ) {
          cells.add(`${targetRow}-${targetCol}`);
        }
      }
    }

    let clearRows = [];
    let clearCols = [];
    if (valid) {
      const result = getCompletedLinesAfterPlacement(
        grid,
        activePiece.shape,
        topRow,
        leftCol,
        activePiece.color
      );
      clearRows = result.fullRows;
      clearCols = result.fullCols;
    }

    previewInfo = {
      valid,
      cells,
      clearRows,
      clearCols,
    };
  }

  const finishGame = useCallback(
    async (reason, statsOverride = {}) => {
      setIsEnded(true);
      setIsPlacementUnlocked(false);
      setEndReason(reason);
      setHoverCell(null);
      setDragState(null);
      dragRef.current = null;

      if (!hasVocabMode) {
        setAiFeedback('');
        setIsLoadingFeedback(false);
        return;
      }

      setIsLoadingFeedback(true);
      const summary = {
        setTitle: vocabSet?.title,
        topic: vocabSet?.topic,
        score: statsOverride.score ?? score,
        linesCleared: statsOverride.linesCleared ?? linesCleared,
        totalWords: items.length,
        correctWords: statsOverride.correctWords ?? correctWords,
        missedWords: statsOverride.missedWords ?? missedWords,
        maxCombo: statsOverride.maxCombo ?? maxCombo,
      };

      const text = await generateGameFeedback(summary);
      setAiFeedback(text);
      setIsLoadingFeedback(false);
    },
    [hasVocabMode, vocabSet, score, linesCleared, items.length, correctWords, missedWords, maxCombo]
  );

  const placePieceAt = useCallback(
    (piece, row, col) => {
      if (isEnded || !isPlacementUnlocked || !piece) return;

      const { topRow, leftCol } = getAnchorOrigin(piece.shape, row, col);
      if (!canPlacePiece(grid, piece.shape, topRow, leftCol)) {
        return;
      }

      const { nextGrid, fullRows, fullCols, cellsPlaced } =
        getCompletedLinesAfterPlacement(
          grid,
          piece.shape,
          topRow,
          leftCol,
          piece.color
        );

      const clearedCount = fullRows.length + fullCols.length;
      const nextCombo = clearedCount > 0 ? combo + 1 : 0;
      const nextMaxCombo = Math.max(maxCombo, nextCombo);
      const linePoints = clearedCount > 0 ? clearedCount * 15 * nextCombo : 0;
      const gainedScore = cellsPlaced + linePoints;
      const nextScore = score + gainedScore;
      const nextLinesCleared = linesCleared + clearedCount;

      setGrid(nextGrid);
      setScore(nextScore);
      setCombo(nextCombo);
      setMaxCombo(nextMaxCombo);
      setLinesCleared(nextLinesCleared);

      if (clearedCount > 0) {
        setClearingFlash({ rows: fullRows, cols: fullCols });
        setTimeout(() => setClearingFlash({ rows: [], cols: [] }), 320);
        setBannerText(
          nextCombo > 1
            ? `COMBO x${nextCombo}! Phá ${clearedCount} hàng/cột (+${gainedScore})`
            : `BLOCK BLAST! +${gainedScore}`
        );
      } else {
        setBannerText('');
      }

      setHoverCell(null);

      const nextTray = tray.map((p) =>
        p.id === piece.id ? createRandomPiece() : p
      );
      setTray(nextTray);

      if (hasVocabMode) {
        if (wordIndex + 1 >= items.length) {
          finishGame('Bạn đã hoàn thành toàn bộ từ vựng trong bộ!', {
            score: nextScore,
            linesCleared: nextLinesCleared,
            maxCombo: nextMaxCombo,
          });
          return;
        }

        if (!canAnyPieceFit(nextGrid, nextTray)) {
          finishGame('Lưới 8x8 không còn chỗ đặt bất kỳ khối nào trong khay!', {
            score: nextScore,
            linesCleared: nextLinesCleared,
            maxCombo: nextMaxCombo,
          });
          return;
        }

        setIsPlacementUnlocked(false);
        setWordIndex((prev) => prev + 1);
        setAnswerFeedback(null);
        setRevealedHints(0);
        return;
      }

      if (!canAnyPieceFit(nextGrid, nextTray)) {
        finishGame('Lưới 8x8 không còn chỗ đặt bất kỳ khối nào trong khay!', {
          score: nextScore,
          linesCleared: nextLinesCleared,
          maxCombo: nextMaxCombo,
        });
      }
    },
    [
      isEnded,
      isPlacementUnlocked,
      grid,
      combo,
      maxCombo,
      score,
      linesCleared,
      tray,
      hasVocabMode,
      wordIndex,
      items.length,
      finishGame,
    ]
  );

  const getCellFromPointer = useCallback((clientX, clientY, pointerType) => {
    const gridEl = gridRef.current;
    if (!gridEl) return null;
    const rect = gridEl.getBoundingClientRect();
    const offsetY = pointerType === 'touch' ? -44 : 0;
    const x = clientX - rect.left;
    const y = clientY + offsetY - rect.top;

    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) {
      return null;
    }

    const col = Math.floor((x / rect.width) * GRID_SIZE);
    const row = Math.floor((y / rect.height) * GRID_SIZE);
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
      return null;
    }
    return { row, col };
  }, []);

  useEffect(() => {
    function handlePointerMove(event) {
      const current = dragRef.current;
      if (!current) return;

      const nextDrag = {
        ...current,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      dragRef.current = nextDrag;
      setDragState(nextDrag);

      const cell = getCellFromPointer(
        event.clientX,
        event.clientY,
        current.pointerType
      );
      setHoverCell(cell);
    }

    function handlePointerUp(event) {
      const current = dragRef.current;
      if (!current) return;

      dragRef.current = null;
      setDragState(null);

      const cell = getCellFromPointer(
        event.clientX,
        event.clientY,
        current.pointerType
      );
      if (cell) {
        placePieceAt(current.piece, cell.row, cell.col);
      }
      setHoverCell(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [getCellFromPointer, placePieceAt]);

  function handlePiecePointerDown(event, piece) {
    if (isEnded || !isPlacementUnlocked) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();

    const initialDrag = {
      piece,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType || 'mouse',
    };
    dragRef.current = initialDrag;
    setDragState(initialDrag);
    setHoverCell(
      getCellFromPointer(event.clientX, event.clientY, initialDrag.pointerType)
    );
  }

  function handleCheckAnswer(event) {
    event.preventDefault();
    if (!currentWord || isPlacementUnlocked || isEnded) return;

    const expected = normalizeAnswer(currentWord.en_word);
    const actual = normalizeAnswer(answerInput);

    if (!actual) return;

    if (actual === expected) {
      const nextCorrect = correctWords + 1;
      const wordPoints = 20 + Math.max(0, 5 - revealedHints) * 2;
      const nextScore = score + wordPoints;

      setCorrectWords(nextCorrect);
      setScore(nextScore);
      setAnswerFeedback({
        type: 'success',
        text: `Chính xác! "${currentWord.en_word}" (+${wordPoints} điểm). Hãy kéo 1 khối vào lưới!`,
      });
      setBannerText(`+${wordPoints} Mở khóa 1 khối!`);
      setAnswerInput('');
      setRevealedHints(0);
      setIsPlacementUnlocked(true);

      if (!canAnyPieceFit(grid, tray)) {
        finishGame('Lưới 8x8 không còn chỗ đặt bất kỳ khối nào trong khay!', {
          score: nextScore,
          correctWords: nextCorrect,
        });
      }
    } else {
      setAnswerFeedback({
        type: 'error',
        text: 'Chưa chính xác! Hãy thử nhập lại hoặc bấm "Gợi ý" / "Bỏ qua".',
      });
    }
  }

  function handleShowHint() {
    if (!currentWord || isPlacementUnlocked || isEnded) return;
    const letterCount = currentWord.en_word.replace(/[\s-]/g, '').length;
    setRevealedHints((prev) => Math.min(prev + 1, Math.max(1, letterCount - 1)));
    inputRef.current?.focus();
  }

  function handleSkipWord() {
    if (!currentWord || isPlacementUnlocked || isEnded) return;
    const nextMissed = [...missedWords, currentWord];
    setMissedWords(nextMissed);
    setAnswerInput('');
    setRevealedHints(0);

    if (wordIndex + 1 >= items.length) {
      finishGame(`Đã hết lượt từ vựng. Đáp án cuối: "${currentWord.en_word}".`, {
        missedWords: nextMissed,
      });
      return;
    }

    setAnswerFeedback({
      type: 'info',
      text: `Đáp án là "${currentWord.en_word}". Nhập đúng từ tiếp theo để mở khóa kéo khối!`,
    });
    setWordIndex((prev) => prev + 1);
    inputRef.current?.focus();
  }

  async function handleSelectSaved(event) {
    const selectedId = event.target.value;
    if (!selectedId) return;
    setSetSelectError('');
    try {
      await onSelectSavedSet(selectedId);
    } catch (error) {
      setSetSelectError(error.message);
    }
  }

  const accuracy =
    hasVocabMode && items.length > 0
      ? Math.round((correctWords / items.length) * 100)
      : 0;

  return (
    <div className="game-shell">
      <div className="game-topbar">
        <div className="topbar-left">
          <div className="brand-inline">
            <span className="brand-logo-sm" aria-hidden="true">
              🧱
            </span>
            <div>
              <strong>Block Blast</strong>
              <span className="mode-pill">
                {hasVocabMode ? vocabSet?.title || 'Luyện từ vựng' : 'Chơi tự do'}
              </span>
            </div>
          </div>
        </div>

        <div className="hud-stats">
          <div className="stat-box">
            <span className="stat-label">Điểm</span>
            <strong className="stat-value">{score}</strong>
          </div>
          <div className="stat-box">
            <span className="stat-label">Kỷ lục</span>
            <strong className="stat-value stat-gold">
              <Trophy size={14} /> {bestScore}
            </strong>
          </div>
          <div className="stat-box">
            <span className="stat-label">Phá hàng</span>
            <strong className="stat-value">{linesCleared}</strong>
          </div>
          {hasVocabMode && (
            <div className="stat-box">
              <span className="stat-label">Từ vựng</span>
              <strong className="stat-value">
                {Math.min(wordIndex + 1, items.length)}/{items.length}
              </strong>
            </div>
          )}
          {combo > 1 && (
            <div className="combo-badge">
              <Flame size={15} /> x{combo}
            </div>
          )}

          {savedSets.length > 0 && (
            <label className="history-select-wrap" title="Chọn bộ từ đã lưu để luyện lại">
              <History size={15} />
              <select
                className="history-select"
                value={hasVocabMode && vocabSet?.id ? vocabSet.id : ''}
                onChange={handleSelectSaved}
                aria-label="Chọn bộ từ đã lưu"
              >
                <option value="" disabled>
                  Bộ từ đã lưu...
                </option>
                {savedSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.title} ({set.item_count} từ)
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn btn-ai btn-sm"
            onClick={onOpenVocabModal}
          >
            <BookPlus size={16} />
            Thêm từ
          </button>

          {hasVocabMode && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSwitchToFreePlay}
            >
              <Gamepad2 size={16} />
              Chơi tự do
            </button>
          )}

          <button type="button" className="btn btn-ghost btn-sm" onClick={onNewGame}>
            <RotateCcw size={16} />
            Ván mới
          </button>
        </div>
      </div>

      {setSelectError && <div className="alert alert-error">{setSelectError}</div>}

      <div className={`game-main ${hasVocabMode || isEnded ? 'has-side-panel' : 'single-board'}`}>
        <div className="board-column">
          <div className="board-wrapper">
            {bannerText && (
              <div className="blast-banner" key={`${bannerText}-${score}`}>
                {bannerText}
              </div>
            )}

            <div ref={gridRef} className="blast-grid">
              {grid.map((row, rIndex) =>
                row.map((cellColor, cIndex) => {
                  const key = `${rIndex}-${cIndex}`;
                  const isPreview = previewInfo?.cells.has(key);
                  const isLineClearPreview =
                    previewInfo?.valid &&
                    (previewInfo.clearRows.includes(rIndex) ||
                      previewInfo.clearCols.includes(cIndex));
                  const isFlashing =
                    clearingFlash.rows.includes(rIndex) ||
                    clearingFlash.cols.includes(cIndex);

                  let cellClass = 'grid-cell';
                  if (cellColor) {
                    cellClass += ` filled color-${cellColor}`;
                  }
                  if (isPreview && activePiece) {
                    cellClass += previewInfo.valid
                      ? ` preview-valid color-${activePiece.color}`
                      : ' preview-invalid';
                  }
                  if (isLineClearPreview) {
                    cellClass += ' line-clear-preview';
                  }
                  if (isFlashing) {
                    cellClass += ' line-flashing';
                  }

                  return <div key={key} className={cellClass} />;
                })
              )}
            </div>
          </div>

          <div className={`tray-card ${!isPlacementUnlocked && hasVocabMode ? 'is-locked' : ''}`}>
            <div className="tray-header">
              <span className="tray-title-status">
                {!hasVocabMode || isPlacementUnlocked ? (
                  <Unlock size={15} className="icon-unlocked" />
                ) : (
                  <Lock size={15} className="icon-locked" />
                )}
                Khay khối gạch
              </span>
              <span className="tray-hint">
                {isEnded
                  ? 'Lượt chơi đã kết thúc'
                  : !hasVocabMode
                    ? 'Kéo thả khối từ khay vào lưới 8x8'
                    : isPlacementUnlocked
                      ? 'Đã mở khóa! Kéo thả 1 khối vào lưới 8x8'
                      : 'Đang khóa — Nhập đúng từ vựng để kéo 1 khối'}
              </span>
            </div>

            <div className="tray-slots">
              {tray.map((piece, index) => {
                const isBeingDragged = dragState?.piece?.id === piece.id;
                const locked = hasVocabMode && !isPlacementUnlocked;

                return (
                  <button
                    key={piece.id}
                    type="button"
                    disabled={locked || isEnded}
                    className={`tray-piece-btn ${
                      locked ? 'is-piece-locked' : ''
                    } ${isBeingDragged ? 'is-dragging-source' : ''}`}
                    onPointerDown={(e) => handlePiecePointerDown(e, piece)}
                  >
                    <span className="piece-index">
                      {locked ? <Lock size={12} /> : index + 1}
                    </span>
                    <div
                      className="piece-mini-grid"
                      style={{
                        gridTemplateColumns: `repeat(${piece.shape[0].length}, 16px)`,
                      }}
                    >
                      {piece.shape.flatMap((row, r) =>
                        row.map((val, c) => (
                          <span
                            key={`${r}-${c}`}
                            className={
                              val ? `mini-cell filled color-${piece.color}` : 'mini-cell'
                            }
                          />
                        ))
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {(hasVocabMode || isEnded) && (
          <aside className="vocab-column">
            {isEnded ? (
              <div className="summary-card">
                <div className="summary-header">
                  <Award size={28} className="summary-icon" />
                  <div>
                    <h2>Tổng kết lượt chơi</h2>
                    <p>{endReason}</p>
                  </div>
                </div>

                <div className="summary-metrics">
                  <div>
                    <span>Điểm số</span>
                    <strong>{score}</strong>
                  </div>
                  <div>
                    <span>Hàng/cột đã xóa</span>
                    <strong>{linesCleared}</strong>
                  </div>
                  {hasVocabMode ? (
                    <div>
                      <span>Tỷ lệ trả lời đúng</span>
                      <strong>
                        {accuracy}% ({correctWords}/{items.length})
                      </strong>
                    </div>
                  ) : (
                    <div>
                      <span>Combo cao nhất</span>
                      <strong>x{maxCombo}</strong>
                    </div>
                  )}
                </div>

                {hasVocabMode && (
                  <div className="ai-feedback-box">
                    <div className="ai-feedback-title">
                      <Sparkles size={16} />
                      Đánh giá &amp; Nhận xét
                    </div>
                    <p>{isLoadingFeedback ? 'Đang tạo nhận xét...' : aiFeedback}</p>
                  </div>
                )}

                {hasVocabMode && missedWords.length > 0 && (
                  <div className="missed-words-box">
                    <h4>Từ cần ôn lại ({missedWords.length})</h4>
                    <div className="word-chips">
                      {missedWords.map((word) => (
                        <span key={word.id || word.en_word} className="word-chip">
                          <span>{word.emoji || '📘'}</span>
                          <strong>{word.en_word}</strong>
                          <span>- {word.vi_meaning}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="summary-actions">
                  <button type="button" className="btn btn-primary" onClick={onNewGame}>
                    <RotateCcw size={18} />
                    {hasVocabMode ? 'Luyện lại bộ này' : 'Chơi lại'}
                  </button>
                  {hasVocabMode ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={onSwitchToFreePlay}
                    >
                      <Gamepad2 size={18} />
                      Chơi tự do
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ai"
                      onClick={onOpenVocabModal}
                    >
                      <BookPlus size={18} />
                      Thêm từ để luyện
                    </button>
                  )}
                </div>
              </div>
            ) : currentWord ? (
              <div className="vocab-challenge-card">
                <div className="vocab-badge-row">
                  <span className="step-pill">
                    Từ {wordIndex + 1} / {items.length}
                  </span>
                  {currentWord.part_of_speech && (
                    <span className="pos-pill">{currentWord.part_of_speech}</span>
                  )}
                </div>

                <div className="vocab-prompt">
                  <div className="vocab-emoji">{currentWord.emoji || '📘'}</div>
                  <div className="vocab-meaning">{currentWord.vi_meaning}</div>
                  <div className="vocab-mask">
                    {formatMaskedWord(currentWord.en_word, revealedHints)}
                  </div>
                </div>

                {answerFeedback && (
                  <div className={`feedback-pill ${answerFeedback.type}`}>
                    {answerFeedback.type === 'success' ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <HelpCircle size={16} />
                    )}
                    <span>{answerFeedback.text}</span>
                  </div>
                )}

                <form onSubmit={handleCheckAnswer} className="vocab-answer-form">
                  <input
                    ref={inputRef}
                    type="text"
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder={
                      isPlacementUnlocked
                        ? 'Đã mở khóa — Hãy kéo 1 khối vào lưới!'
                        : 'Gõ từ tiếng Anh để mở khóa 1 khối...'
                    }
                    disabled={isPlacementUnlocked}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isPlacementUnlocked || !answerInput.trim()}
                  >
                    Kiểm tra
                  </button>
                </form>

                <div className="vocab-helpers">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleShowHint}
                    disabled={isPlacementUnlocked}
                  >
                    <Lightbulb size={15} />
                    Gợi ý chữ cái
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleSkipWord}
                    disabled={isPlacementUnlocked}
                  >
                    <SkipForward size={15} />
                    Bỏ qua
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        )}
      </div>

      {dragState?.piece && (
        <div
          className="drag-floating-piece"
          style={{
            left: dragState.clientX,
            top: dragState.clientY + (dragState.pointerType === 'touch' ? -44 : 0),
          }}
        >
          <div
            className="piece-mini-grid drag-grid-large"
            style={{
              gridTemplateColumns: `repeat(${dragState.piece.shape[0].length}, 26px)`,
            }}
          >
            {dragState.piece.shape.flatMap((row, r) =>
              row.map((val, c) => (
                <span
                  key={`${r}-${c}`}
                  className={
                    val ? `drag-cell filled color-${dragState.piece.color}` : 'drag-cell'
                  }
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
