import { isSupabaseConfigured, supabase } from '../lib/supabase';

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Chưa cấu hình VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong file .env.'
    );
  }
}

export async function getVocabItemsBySetId(setId) {
  assertSupabase();
  const { data, error } = await supabase
    .from('vocab_items')
    .select('id, set_id, en_word, vi_meaning, emoji, part_of_speech, sort_order, created_at')
    .eq('set_id', setId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`Không thể tải danh sách từ vựng: ${error.message}`);
  }

  return data ?? [];
}

export async function getActiveVocabSet() {
  assertSupabase();

  let { data: activeSet, error: activeError } = await supabase
    .from('vocab_sets')
    .select('id, title, topic, study_date, is_active, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    throw new Error(`Không thể tải bộ từ đang chạy: ${activeError.message}`);
  }

  if (!activeSet) {
    const { data: latestSet, error: latestError } = await supabase
      .from('vocab_sets')
      .select('id, title, topic, study_date, is_active, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      throw new Error(`Không thể tải bộ từ mới nhất: ${latestError.message}`);
    }

    activeSet = latestSet;
  }

  if (!activeSet) {
    return { set: null, items: [] };
  }

  const items = await getVocabItemsBySetId(activeSet.id);
  return { set: activeSet, items };
}

export async function getVocabSets() {
  assertSupabase();

  const { data, error } = await supabase
    .from('vocab_sets')
    .select('id, title, topic, study_date, is_active, created_at, vocab_items(count)')
    .order('study_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Không thể tải lịch sử bộ từ: ${error.message}`);
  }

  return (data ?? []).map((set) => ({
    id: set.id,
    title: set.title,
    topic: set.topic,
    study_date: set.study_date,
    is_active: set.is_active,
    created_at: set.created_at,
    item_count: set.vocab_items?.[0]?.count ?? 0,
  }));
}

export async function createAndActivateVocabSet({ title, topic, studyDate, items }) {
  assertSupabase();

  const cleanTitle = title.trim();
  const cleanTopic = topic?.trim() || null;
  const normalizedItems = items
    .map((item) => ({
      en_word: item.en_word?.trim() || '',
      vi_meaning: item.vi_meaning?.trim() || '',
      emoji: item.emoji?.trim() || '📘',
      part_of_speech: item.part_of_speech?.trim() || null,
    }))
    .filter((item) => item.en_word && item.vi_meaning);

  if (!cleanTitle) {
    throw new Error('Vui lòng nhập tên bộ từ vựng.');
  }

  if (normalizedItems.length === 0) {
    throw new Error('Bộ từ cần ít nhất 1 từ hợp lệ có cả tiếng Anh và nghĩa tiếng Việt.');
  }

  const { data: createdSet, error: setError } = await supabase
    .from('vocab_sets')
    .insert({
      title: cleanTitle,
      topic: cleanTopic,
      study_date: studyDate || new Date().toISOString().slice(0, 10),
      is_active: false,
    })
    .select('id, title, topic, study_date, is_active, created_at')
    .single();

  if (setError) {
    throw new Error(`Không thể lưu bộ từ: ${setError.message}`);
  }

  const rowsToInsert = normalizedItems.map((item, index) => ({
    set_id: createdSet.id,
    en_word: item.en_word,
    vi_meaning: item.vi_meaning,
    emoji: item.emoji,
    part_of_speech: item.part_of_speech,
    sort_order: index,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from('vocab_items')
    .insert(rowsToInsert)
    .select('id, set_id, en_word, vi_meaning, emoji, part_of_speech, sort_order, created_at');

  if (itemsError) {
    throw new Error(`Không thể lưu danh sách từ vựng: ${itemsError.message}`);
  }

  const { error: rpcError } = await supabase.rpc('set_active_vocab_set', {
    target_set_id: createdSet.id,
  });

  if (rpcError) {
    throw new Error(`Đã lưu bộ từ nhưng không kích hoạt được: ${rpcError.message}`);
  }

  return {
    set: { ...createdSet, is_active: true },
    items: insertedItems ?? [],
  };
}

export async function activateVocabSet(setId) {
  assertSupabase();

  const { error: rpcError } = await supabase.rpc('set_active_vocab_set', {
    target_set_id: setId,
  });

  if (rpcError) {
    throw new Error(`Không thể kích hoạt bộ từ: ${rpcError.message}`);
  }

  const { data: activeSet, error: setError } = await supabase
    .from('vocab_sets')
    .select('id, title, topic, study_date, is_active, created_at')
    .eq('id', setId)
    .single();

  if (setError) {
    throw new Error(`Không thể tải thông tin bộ từ vừa chọn: ${setError.message}`);
  }

  const items = await getVocabItemsBySetId(setId);
  return { set: activeSet, items };
}
