import { Play, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { convertVocabWithAI } from '../services/aiService';

function formatDefaultSetTitle() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `Bộ từ ${day}/${month}/${year}`;
}

export default function AddVocabModal({
  isSaving,
  onSaveAndStart,
  onClose,
}) {
  const [title, setTitle] = useState('');
  const [rawInput, setRawInput] = useState('');
  const [previewItems, setPreviewItems] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const defaultTitle = formatDefaultSetTitle();
  const validCount = previewItems.filter(
    (item) => item.en_word?.trim() && item.vi_meaning?.trim()
  ).length;

  async function handleConvertWithAI() {
    setErrorMessage('');
    setStatusMessage('');
    setIsConverting(true);
    try {
      const items = await convertVocabWithAI(rawInput);
      setPreviewItems(items);
      setStatusMessage(
        `Đã chuyển đổi ${items.length} từ vựng. Kiểm tra nhanh bên dưới rồi bấm "Lưu bộ từ & Bắt đầu luyện".`
      );
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsConverting(false);
    }
  }

  function handleAddManualRow() {
    setErrorMessage('');
    setPreviewItems((prev) => [
      ...prev,
      { en_word: '', vi_meaning: '', emoji: '📘', part_of_speech: null },
    ]);
  }

  function handleUpdateItem(index, field, value) {
    setPreviewItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function handleRemoveItem(index) {
    setPreviewItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmitSet() {
    setErrorMessage('');
    const validItems = previewItems.filter(
      (item) => item.en_word?.trim() && item.vi_meaning?.trim()
    );
    if (validItems.length === 0) {
      setErrorMessage('Cần ít nhất 1 từ có đủ tiếng Anh và nghĩa tiếng Việt.');
      return;
    }

    try {
      await onSaveAndStart({
        title: title.trim() || defaultTitle,
        items: validItems,
      });
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Tạo bộ từ vựng mới"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Tạo bộ từ vựng mới</h2>
            <p className="panel-subtitle">
              Danh sách từ chỉ được lưu thành 1 bộ hoàn chỉnh lên Supabase khi bạn bấm Lưu.
            </p>
          </div>
          <button
            type="button"
            className="btn-icon-close"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {errorMessage && <div className="alert alert-error">{errorMessage}</div>}
          {statusMessage && <div className="alert alert-success">{statusMessage}</div>}

          <section className="modal-section">
            <h3>1. Nhập từ vựng</h3>
            <div className="setup-inputs">
              <label className="field">
                <span>Tên bộ từ (tùy chọn)</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Mặc định: ${defaultTitle}`}
                />
              </label>

              <label className="field">
                <span>Danh sách từ tiếng Anh (dấu phẩy hoặc xuống dòng)</span>
                <textarea
                  rows={3}
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={'Ví dụ: apple, banana, mother, father\nhoặc mỗi từ một dòng...'}
                />
              </label>

              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-ai"
                  onClick={handleConvertWithAI}
                  disabled={isConverting || !rawInput.trim()}
                >
                  <Sparkles size={18} />
                  {isConverting ? 'Đang chuyển đổi AI...' : 'Chuyển đổi bằng AI'}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleAddManualRow}
                >
                  <Plus size={18} />
                  + Thêm từ thủ công
                </button>
              </div>
            </div>
          </section>

          <section className="modal-section">
            <div className="list-section-header">
              <div>
                <h3>2. Xem trước &amp; chỉnh sửa ({validCount}/{previewItems.length})</h3>
                <p className="panel-subtitle">
                  Kiểm tra nhanh emoji, từ tiếng Anh và nghĩa tiếng Việt trước khi lưu cả bộ.
                </p>
              </div>
            </div>

            {previewItems.length === 0 ? (
              <div className="empty-list-box">
                <p>
                  Chưa có từ xem trước. Dán danh sách ở trên rồi bấm &quot;Chuyển đổi bằng AI&quot; hoặc &quot;+ Thêm từ thủ công&quot;.
                </p>
              </div>
            ) : (
              <div className="vocab-edit-list">
                {previewItems.map((item, index) => (
                  <div className="vocab-edit-row" key={`preview-${index}`}>
                    <input
                      type="text"
                      className="input-emoji"
                      value={item.emoji || ''}
                      onChange={(e) => handleUpdateItem(index, 'emoji', e.target.value)}
                      aria-label="Emoji"
                      title="Emoji"
                    />
                    <input
                      type="text"
                      className="input-en"
                      value={item.en_word || ''}
                      onChange={(e) => handleUpdateItem(index, 'en_word', e.target.value)}
                      placeholder="Từ tiếng Anh"
                    />
                    <input
                      type="text"
                      className="input-vi"
                      value={item.vi_meaning || ''}
                      onChange={(e) => handleUpdateItem(index, 'vi_meaning', e.target.value)}
                      placeholder="Nghĩa tiếng Việt"
                    />
                    <button
                      type="button"
                      className="btn-icon-danger"
                      onClick={() => handleRemoveItem(index)}
                      aria-label="Xóa dòng"
                      title="Xóa dòng"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-primary btn-start-game"
            disabled={isSaving || validCount === 0}
            onClick={handleSubmitSet}
          >
            <Play size={18} />
            {isSaving ? 'Đang lưu bộ từ...' : 'Lưu bộ từ & Bắt đầu luyện'}
          </button>
        </div>
      </div>
    </div>
  );
}
