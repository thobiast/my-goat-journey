// Landing-only illustrative identities. Order controls presentation, not associations.
export const habitCatalog = [
  { id: 'read-book', pillar: 'mind', placement: 'initial' },
  { id: 'walk', pillar: 'body', placement: 'initial' },
  { id: 'eat-fruit', pillar: 'nutrition', placement: 'initial' },
  { id: 'floss', pillar: 'hygiene', placement: 'initial' },
  { id: 'exercise', pillar: 'body', placement: 'additional' },
  { id: 'push-ups', pillar: 'body', placement: 'additional' },
  { id: 'meditate', pillar: 'mind', placement: 'additional' },
  { id: 'practice-english', pillar: 'mind', placement: 'additional' },
  { id: 'stretch', pillar: 'body', placement: 'additional' },
  { id: 'organize-desk', pillar: 'mind', placement: 'additional' },
  { id: 'write-journal', pillar: 'mind', placement: 'additional' },
  { id: 'practice-guitar', pillar: 'mind', placement: 'additional' },
  { id: 'make-bed', pillar: 'mind', placement: 'additional' },
  { id: 'add-vegetables', pillar: 'nutrition', placement: 'additional' },
  { id: 'prepare-snack', pillar: 'nutrition', placement: 'additional' },
  { id: 'prepare-clothes', pillar: 'mind', placement: 'additional' },
];

// The selected idea comes first, followed by these defaults, up to four visible habits.
export const defaultDemoIds = ['read-book', 'walk', 'eat-fruit', 'floss'];
