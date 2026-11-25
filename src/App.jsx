import { useCallback, useEffect, useState } from 'react';
import AddVocabModal from './components/AddVocabModal';
import BlockBlastGame from './components/BlockBlastGame';
import { shuffleArray } from './lib/shuffle';
import {
  activateVocabSet,
  createAndActivateVocabSet,
  getVocabSets,
} from './services/vocabService';

function getTodayIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export default function App() {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeSet, setActiveSet] = useState(null);
  const [savedSets, setSavedSets] = useState([]);
  const [practiceItems, setPracticeItems] = useState([]);
  const [shuffledItems, setShuffledItems] = useState([]);
  const [gameKey, setGameKey] = useState(0);
  const [isSavingSet, setIsSavingSet] = useState(false);

  const refreshSavedSets = useCallback(async () => {
    try {
      const setsList = await getVocabSets();
      setSavedSets(setsList);
    } catch {
      setSavedSets([]);
    }
  }, []);

  useEffect(() => {
    refreshSavedSets();
  }, [refreshSavedSets]);

  async function handleSelectSavedSet(setId) {
    const result = await activateVocabSet(setId);
    setActiveSet(result.set);
    setPracticeItems(result.items);
    setShuffledItems(shuffleArray(result.items));
    setGameKey((prev) => prev + 1);
    await refreshSavedSets();
  }

  async function handleSaveAndStart({ title, items }) {
    setIsSavingSet(true);
    try {
      const result = await createAndActivateVocabSet({
        title,
        topic: null,
        studyDate: getTodayIsoDate(),
        items,
      });
      setActiveSet(result.set);
      setPracticeItems(result.items);
      setShuffledItems(shuffleArray(result.items));
      setGameKey((prev) => prev + 1);
      setIsAddModalOpen(false);
      await refreshSavedSets();
    } finally {
      setIsSavingSet(false);
    }
  }

  function handleSwitchToFreePlay() {
    setActiveSet(null);
    setPracticeItems([]);
    setShuffledItems([]);
    setGameKey((prev) => prev + 1);
  }

  function handleNewGame() {
    if (practiceItems.length > 0) {
      setShuffledItems(shuffleArray(practiceItems));
    }
    setGameKey((prev) => prev + 1);
  }

  return (
    <div className="app-container">
      <main className="app-main">
        <BlockBlastGame
          key={gameKey}
          vocabSet={activeSet}
          items={shuffledItems}
          savedSets={savedSets}
          onSelectSavedSet={handleSelectSavedSet}
          onNewGame={handleNewGame}
          onOpenVocabModal={() => setIsAddModalOpen(true)}
          onSwitchToFreePlay={handleSwitchToFreePlay}
        />
      </main>

      {isAddModalOpen && (
        <AddVocabModal
          isSaving={isSavingSet}
          onSaveAndStart={handleSaveAndStart}
          onClose={() => setIsAddModalOpen(false)}
        />
      )}
    </div>
  );
}
