export class DatasetError extends Error {
  constructor(
    public readonly code: 'stale-revision' | 'historical-conflict',
    message = code === 'stale-revision'
      ? 'Stale dataset revision'
      : 'Historical commitment conflict',
  ) {
    super(message);
    this.name = 'DatasetError';
  }
}
