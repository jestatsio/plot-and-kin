import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@datastax/astra-db-ts';
import { AstraStore, INDEX_FIELDS, PASSAGE_COLLECTION, RECORD_COLLECTION } from '../src/storage.js';
import { PKError, type PKRecord, type RecordKind } from '../src/types.js';

const ENDPOINT = 'https://test-database-us-east-2.apps.astra.datastax.com';
const TOKEN = 'AstraCS:test-only-token';
type StoredRecord = PKRecord & { $lexical?: string };
type Descriptor = { name: string; definition: { indexing?: { allow?: string[] }; lexical?: { enabled: boolean } } };
const descriptor = (name: string): Descriptor => ({ name, definition: { indexing: { allow: [...INDEX_FIELDS] }, ...(name === PASSAGE_COLLECTION ? { lexical: { enabled: true } } : {}) } });
const makeRecord = (kind: RecordKind = 'source', id = 'record-1', projectId = 'project-1'): PKRecord => ({ _id: id, projectId, kind, revision: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', data: kind === 'passage' ? { text: 'Rosedale Street house' } : { title: 'Historical source' } });

/** Models SDK command/results, not Astra ranking or its server-side implementation. */
function fakeDb(initial: Descriptor[] = [descriptor(RECORD_COLLECTION), descriptor(PASSAGE_COLLECTION)]) {
  const descriptions = structuredClone(initial);
  const records = new Map<string, StoredRecord[]>();
  const handles = new Map<string, ReturnType<typeof collectionHandle>>();
  function collectionHandle(name: string) {
    records.set(name, []);
    const matches = (record: StoredRecord, filter: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => record[key as keyof StoredRecord] === value);
    return {
      insertOne: vi.fn(async (record: StoredRecord) => {
        const rows = records.get(name)!;
        if (rows.some(row => row._id === record._id)) throw new Error('DOCUMENT_ALREADY_EXISTS');
        rows.push(structuredClone(record));
        return { insertedId: record._id };
      }),
      findOne: vi.fn(async (filter: Record<string, unknown>) => structuredClone(records.get(name)!.find(record => matches(record, filter)) ?? null)),
      find: vi.fn((filter: Record<string, unknown>, options?: { sort?: { $lexical: string }; limit?: number }) => ({
        toArray: async () => structuredClone(records.get(name)!.filter(record => matches(record, filter)).slice(0, options?.limit)),
      })),
      replaceOne: vi.fn(async (filter: Record<string, unknown>, replacement: Omit<StoredRecord, '_id'>) => {
        const rows = records.get(name)!;
        const index = rows.findIndex(record => matches(record, filter));
        if (index < 0) return { matchedCount: 0, modifiedCount: 0 };
        rows[index] = { ...structuredClone(replacement), _id: rows[index]!._id };
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
  }
  const collection = vi.fn((name: string) => {
    if (!handles.has(name)) handles.set(name, collectionHandle(name));
    return handles.get(name)!;
  });
  const db = {
    listCollections: vi.fn(async (options?: { nameOnly?: boolean }) => options?.nameOnly ? descriptions.map(item => item.name) : structuredClone(descriptions)),
    createCollection: vi.fn(async (name: string, definition: Descriptor['definition']) => { descriptions.push({ name, definition: structuredClone(definition) }); return collection(name); }),
    collection,
  };
  const store = new AstraStore(ENDPOINT, TOKEN, 'default_keyspace', db as unknown as Db);
  return { store, db, records, descriptions, collection };
}

describe('Astra setup and capability contract', () => {
  it('creates only dedicated collections with selective indexes and probes lexical support', async () => {
    const { store, db, descriptions } = fakeDb([{ name: 'documents', definition: {} }]);
    expect(await store.initialize()).toEqual({ collections: ['pk_records', 'pk_passages'], lexical: true });
    expect(db.createCollection.mock.calls).toEqual([
      [RECORD_COLLECTION, { indexing: { allow: INDEX_FIELDS } }],
      [PASSAGE_COLLECTION, { indexing: { allow: INDEX_FIELDS }, lexical: { enabled: true } }],
    ]);
    expect(descriptions[0]).toEqual({ name: 'documents', definition: {} });
    expect(db.collection.mock.calls.every(([name]) => [RECORD_COLLECTION, PASSAGE_COLLECTION].includes(name))).toBe(true);
    expect(db.collection(PASSAGE_COLLECTION).find).toHaveBeenCalledWith({ projectId: '__pk_capability_probe__' }, { sort: { $lexical: 'capability probe' }, limit: 1 });
    expect(db.listCollections).toHaveBeenNthCalledWith(1, { nameOnly: true });
  });
  it('does not recreate or mutate existing collections', async () => {
    const { store, db } = fakeDb([descriptor(RECORD_COLLECTION), descriptor(PASSAGE_COLLECTION), { name: 'documents', definition: {} }]);
    await store.initialize();
    expect(db.createCollection).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalledWith('documents');
  });
  it('creates only the missing dedicated collection', async () => {
    const { store, db } = fakeDb([descriptor(RECORD_COLLECTION)]);
    await store.initialize();
    expect(db.createCollection).toHaveBeenCalledTimes(1);
    expect(db.createCollection.mock.calls[0]?.[0]).toBe(PASSAGE_COLLECTION);
  });
  it('reports missing collections without changing the database during diagnosis', async () => {
    const { store, db } = fakeDb([descriptor(RECORD_COLLECTION)]);
    await expect(store.diagnose()).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
    expect(db.createCollection).not.toHaveBeenCalled();
  });
  it.each([{}, { indexing: { allow: ['projectId'] } }])('rejects incompatible selective index configuration %j', async definition => {
    const { store, db } = fakeDb([{ name: RECORD_COLLECTION, definition }, descriptor(PASSAGE_COLLECTION)]);
    await expect(store.diagnose()).rejects.toMatchObject({ code: 'INCOMPATIBLE_SCHEMA' });
    expect(db.createCollection).not.toHaveBeenCalled();
  });
  it('detects disabled lexical indexing before attempting a capability probe', async () => {
    const disabled = descriptor(PASSAGE_COLLECTION); disabled.definition.lexical = { enabled: false };
    const { store, db } = fakeDb([descriptor(RECORD_COLLECTION), disabled]);
    await expect(store.diagnose()).rejects.toMatchObject({ code: 'LEXICAL_UNAVAILABLE' });
    expect(db.collection).not.toHaveBeenCalled();
  });
  it('fails lexical capability checks safely when the deployed API rejects the preview feature', async () => {
    const { store, db } = fakeDb();
    db.collection(PASSAGE_COLLECTION).find.mockImplementationOnce(() => ({ toArray: async () => { throw new Error(`Feature unavailable for ${ENDPOINT} using ${TOKEN}`); } }));
    let failure: unknown;
    try { await store.diagnose(); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'STORAGE_ERROR' });
    expect(String(failure)).not.toContain(TOKEN);
    expect(String(failure)).not.toContain(ENDPOINT);
  });
  it('redacts setup failures and keeps known domain errors intact', async () => {
    const { store, db } = fakeDb();
    db.listCollections.mockRejectedValueOnce(new Error(`Unauthorized: ${TOKEN}`));
    await expect(store.initialize()).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    const expected = new PKError('TEST_DOMAIN_ERROR', 'Safe known error');
    db.listCollections.mockRejectedValueOnce(expected);
    await expect(store.diagnose()).rejects.toBe(expected);
  });
  it('validates endpoint, token, and keyspace before addressing any collection', () => {
    const { db } = fakeDb();
    for (const [endpoint, token, keyspace] of [[ENDPOINT, '', 'default_keyspace'], [ENDPOINT, TOKEN, '../other'], ['https://example.com', TOKEN, 'default_keyspace']]) {
      expect(() => new AstraStore(endpoint!, token!, keyspace!, db as unknown as Db)).toThrow(PKError);
    }
    expect(db.collection).not.toHaveBeenCalled();
  });
});

describe('Astra record commands, isolation, and error contracts', () => {
  it('routes records and passages separately, supplies lexical text, and hides the wire field on reads', async () => {
    const { store, db } = fakeDb();
    const source = makeRecord('source', 'source'); const passage = makeRecord('passage', 'passage');
    await store.insert(source); await store.insert(passage);
    expect(db.collection(RECORD_COLLECTION).insertOne).toHaveBeenCalledWith(source);
    expect(db.collection(PASSAGE_COLLECTION).insertOne).toHaveBeenCalledWith({ ...passage, $lexical: 'Rosedale Street house' });
    expect(await store.get('project-1', 'source')).toEqual(source);
    expect(await store.get('project-1', 'passage')).toEqual(passage);
    expect(db.collection(RECORD_COLLECTION).findOne).toHaveBeenCalledWith({ _id: 'passage', projectId: 'project-1' });
    expect(db.collection(PASSAGE_COLLECTION).findOne).toHaveBeenCalledWith({ _id: 'passage', projectId: 'project-1' });
    expect(await store.get('other-project', 'passage')).toBeUndefined();
  });
  it('short-circuits successful primary reads without querying the passage collection', async () => {
    const { store, db } = fakeDb(); const source = makeRecord(); await store.insert(source);
    db.collection.mockClear();
    expect(await store.get(source.projectId, source._id)).toEqual(source);
    expect(db.collection.mock.calls).toEqual([[RECORD_COLLECTION]]);
  });
  it('lists both collections only when unfiltered and scopes all SDK filters by project', async () => {
    const { store, db } = fakeDb();
    await store.insert(makeRecord('source', 'source'));
    await store.insert(makeRecord('passage', 'passage'));
    await store.insert(makeRecord('passage', 'foreign', 'other-project'));
    expect((await store.list('project-1')).map(r => r._id).sort()).toEqual(['passage', 'source']);
    db.collection(RECORD_COLLECTION).find.mockClear(); db.collection(PASSAGE_COLLECTION).find.mockClear();
    expect(await store.list('project-1', 'passage')).toEqual([makeRecord('passage', 'passage')]);
    expect(db.collection(RECORD_COLLECTION).find).not.toHaveBeenCalled();
    expect(db.collection(PASSAGE_COLLECTION).find).toHaveBeenCalledWith({ projectId: 'project-1', kind: 'passage' });
    expect(await store.list('project-1', 'source')).toEqual([makeRecord('source', 'source')]);
    expect(db.collection(RECORD_COLLECTION).find).toHaveBeenCalledWith({ projectId: 'project-1', kind: 'source' });
  });
  it('uses project-scoped lexical sorting and bounded search limits', async () => {
    const { store, db } = fakeDb(); const passage = makeRecord('passage'); await store.insert(passage);
    expect(await store.search('project-1', 'Rosedale')).toEqual([passage]);
    const find = db.collection(PASSAGE_COLLECTION).find;
    expect(find).toHaveBeenLastCalledWith({ projectId: 'project-1' }, { sort: { $lexical: 'Rosedale' }, limit: 20 });
    await store.search('project-1', 'Rosedale', 500);
    expect(find).toHaveBeenLastCalledWith({ projectId: 'project-1' }, { sort: { $lexical: 'Rosedale' }, limit: 100 });
    await store.search('project-1', 'Rosedale', 0);
    expect(find).toHaveBeenLastCalledWith({ projectId: 'project-1' }, { sort: { $lexical: 'Rosedale' }, limit: 1 });
    expect(await store.search('other-project', 'Rosedale')).toEqual([]);
  });
  it('sends compare-and-swap identity, kind, project, and revision in one replacement command', async () => {
    const { store, db } = fakeDb(); const original = makeRecord('passage'); await store.insert(original);
    const next = { ...original, revision: 2, data: { text: 'Corrected directory entry' } };
    expect(await store.replace(next, 1)).toBe(true);
    const { _id, ...replacement } = { ...next, $lexical: next.data.text };
    expect(db.collection(PASSAGE_COLLECTION).replaceOne).toHaveBeenCalledWith({ _id, projectId: 'project-1', kind: 'passage', revision: 1 }, replacement);
    expect(await store.replace(next, 1)).toBe(false);
    expect(await store.replace({ ...next, projectId: 'other-project', revision: 3 }, 2)).toBe(false);
    expect(await store.get('project-1', original._id)).toEqual(next);
  });
  it('rejects revision jumps locally before attempting replacement', async () => {
    const { store, db } = fakeDb();
    expect(await store.replace({ ...makeRecord(), revision: 3 }, 1)).toBe(false);
    expect(db.collection).not.toHaveBeenCalled();
  });
  it.each(['DOCUMENT_ALREADY_EXISTS', 'Document already exists', 'duplicate record key'])('classifies known duplicate errors without echoing details: %s', async message => {
    const { store, db } = fakeDb(); db.collection(RECORD_COLLECTION).insertOne.mockRejectedValueOnce(new Error(`${message}: ${TOKEN}`));
    await expect(store.insert(makeRecord())).rejects.toMatchObject({ code: 'CONFLICT', message: 'Record already exists' });
  });
  it('redacts unknown thrown values and read failures', async () => {
    const { store, db } = fakeDb();
    db.collection(RECORD_COLLECTION).findOne.mockRejectedValueOnce({ sensitiveToken: TOKEN });
    await expect(store.get('project-1', 'missing')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    db.collection(PASSAGE_COLLECTION).find.mockImplementationOnce(() => ({ toArray: async () => { throw new Error(`Connection lost ${TOKEN}`); } }));
    await expect(store.search('project-1', 'address')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
  });
  it('rejects invalid identities, revisions, and oversized records without contacting Astra', async () => {
    const { store, db } = fakeDb();
    for (const invalid of [{ ...makeRecord(), _id: '' }, { ...makeRecord(), projectId: '' }, { ...makeRecord(), revision: 0 }, { ...makeRecord(), revision: 1.5 }, { ...makeRecord(), data: { text: 'x'.repeat(500_000) } }]) {
      await expect(store.insert(invalid)).rejects.toMatchObject({ code: 'INVALID_RECORD' });
    }
    expect(db.collection).not.toHaveBeenCalled();
  });
  it('encodes an absent passage text as empty lexical input', async () => {
    const { store, db } = fakeDb(); const passage = { ...makeRecord('passage'), data: {} }; await store.insert(passage);
    expect(db.collection(PASSAGE_COLLECTION).insertOne).toHaveBeenCalledWith({ ...passage, $lexical: '' });
  });
});
