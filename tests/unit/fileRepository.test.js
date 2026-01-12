const { createTestDb } = require('../helpers/testDb');
const FileRepository = require('../../src/persistence/fileRepository');

describe('FileRepository', () => {
  let dbManager;
  let repo;

  beforeEach(async () => {
    dbManager = await createTestDb();
    repo = new FileRepository(dbManager);
  });

  afterEach(() => {
    dbManager.close();
  });

  describe('upsert', () => {
    it('should insert a new file', () => {
      const file = {
        id: 'file123',
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 1024,
        parents: ['folder1'],
        modifiedTime: '2024-01-15T10:00:00Z'
      };

      repo.upsert(file);
      const result = repo.findById('file123');

      expect(result).not.toBeNull();
      expect(result.id).toBe('file123');
      expect(result.name).toBe('test.txt');
      expect(result.mimeType).toBe('text/plain');
      expect(result.size).toBe(1024);
      expect(result.parentId).toBe('folder1');
    });

    it('should update existing file', () => {
      const file = {
        id: 'file123',
        name: 'test.txt',
        mimeType: 'text/plain'
      };

      repo.upsert(file);
      repo.upsert({ ...file, name: 'renamed.txt' });

      const result = repo.findById('file123');
      expect(result.name).toBe('renamed.txt');
    });
  });

  describe('upsertBatch', () => {
    it('should insert multiple files', () => {
      const files = [
        { id: 'f1', name: 'file1.txt' },
        { id: 'f2', name: 'file2.txt' },
        { id: 'f3', name: 'file3.txt' }
      ];

      repo.upsertBatch(files);

      expect(repo.count()).toBe(3);
      expect(repo.findById('f1').name).toBe('file1.txt');
      expect(repo.findById('f2').name).toBe('file2.txt');
    });
  });

  describe('findByParentId', () => {
    it('should find all children of a folder', () => {
      repo.upsertBatch([
        { id: 'f1', name: 'file1.txt', parents: ['parent1'] },
        { id: 'f2', name: 'file2.txt', parents: ['parent1'] },
        { id: 'f3', name: 'file3.txt', parents: ['parent2'] }
      ]);

      const children = repo.findByParentId('parent1');
      expect(children.length).toBe(2);
    });
  });

  describe('getAll', () => {
    it('should support pagination', () => {
      const files = Array.from({ length: 15 }, (_, i) => ({
        id: `f${i}`,
        name: `file${i}.txt`
      }));
      repo.upsertBatch(files);

      const page1 = repo.getAll(10, 0);
      const page2 = repo.getAll(10, 10);

      expect(page1.length).toBe(10);
      expect(page2.length).toBe(5);
    });
  });

  describe('deleteById', () => {
    it('should delete a file', () => {
      repo.upsert({ id: 'file123', name: 'test.txt' });

      const deleted = repo.deleteById('file123');

      expect(deleted).toBe(1);
      expect(repo.findById('file123')).toBeNull();
    });
  });
});
