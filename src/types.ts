export type RecordKind = 'project' | 'run' | 'source' | 'passage' | 'entity' | 'claim' | 'decision' | 'log' | 'processing' | 'operation';
export interface PKRecord<T extends Record<string, unknown> = Record<string, unknown>> {
  _id: string;
  projectId: string;
  kind: RecordKind;
  revision: number;
  createdAt: string;
  updatedAt: string;
  data: T;
}
export interface RecordStore {
  projects?(): Promise<PKRecord[]>;
  insert(record: PKRecord): Promise<void>;
  get(projectId: string, id: string): Promise<PKRecord | undefined>;
  list(projectId: string, kind?: RecordKind): Promise<PKRecord[]>;
  replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
  search(projectId: string, query: string, limit?: number): Promise<PKRecord[]>;
}
export interface BlobRef { hash: string; size: number }
export interface BlobStore {
  put(bytes: Uint8Array): Promise<BlobRef>;
  read(hash: string): Promise<Uint8Array>;
  verify(hash: string): Promise<boolean>;
}
export class PKError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PKError'; }
}
export function requireText(value: unknown, label: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new PKError('INVALID_INPUT', `${label} must be nonempty text of at most ${max} characters`);
  return value.trim();
}
