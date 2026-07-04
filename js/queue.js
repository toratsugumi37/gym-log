// 전송 실패한 세트를 localStorage에 쌓아뒀다가 재전송하기 위한 대기열.

export function createQueue(storage, key = 'gymlog.pending') {
  const load = () => JSON.parse(storage.getItem(key) || '[]');
  const save = (items) => storage.setItem(key, JSON.stringify(items));
  return {
    all: () => load(),
    push(record) {
      const items = load();
      items.push(record);
      save(items);
    },
    remove(id) {
      save(load().filter((r) => r.id !== id));
    },
    size: () => load().length,
  };
}
