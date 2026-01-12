const { DriveClient, RateLimitError } = require('../../src/api/driveClient');

describe('DriveClient', () => {
  let mockAuthClient;
  let mockDrive;

  beforeEach(() => {
    mockAuthClient = {
      getClient: jest.fn().mockReturnValue({})
    };
  });

  describe('rate limiting', () => {
    it('should throw RateLimitError after max retries on 429', async () => {
      const client = new DriveClient(mockAuthClient);

      // mock the drive api to always return 429
      client.drive = {
        files: {
          list: jest.fn().mockRejectedValue({ code: 429 })
        }
      };

      await expect(client.listFiles()).rejects.toThrow(RateLimitError);
    });

    it('should retry on 5xx errors', async () => {
      const client = new DriveClient(mockAuthClient);

      let attempts = 0;
      client.drive = {
        files: {
          list: jest.fn().mockImplementation(() => {
            attempts++;
            if (attempts < 3) {
              return Promise.reject({ code: 500 });
            }
            return Promise.resolve({ data: { files: [] } });
          })
        }
      };

      const result = await client.listFiles();

      expect(attempts).toBe(3);
      expect(result.data.files).toEqual([]);
    });
  });

  describe('listFiles', () => {
    it('should call drive api with correct parameters', async () => {
      const client = new DriveClient(mockAuthClient);

      const mockList = jest.fn().mockResolvedValue({
        data: {
          files: [{ id: '1', name: 'test.txt' }],
          nextPageToken: 'token123'
        }
      });

      client.drive = {
        files: { list: mockList }
      };

      const result = await client.listFiles({ pageSize: 50 });

      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        pageSize: 50,
        q: 'trashed = false'
      }));
      expect(result.data.files.length).toBe(1);
    });

    it('should handle pagination token', async () => {
      const client = new DriveClient(mockAuthClient);

      const mockList = jest.fn().mockResolvedValue({ data: { files: [] } });
      client.drive = { files: { list: mockList } };

      await client.listFiles({ pageToken: 'token_xyz' });

      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({
        pageToken: 'token_xyz'
      }));
    });
  });

  describe('error handling', () => {
    it('should propagate non-retryable errors', async () => {
      const client = new DriveClient(mockAuthClient);

      client.drive = {
        files: {
          list: jest.fn().mockRejectedValue({ code: 404, message: 'Not found' })
        }
      };

      await expect(client.listFiles()).rejects.toMatchObject({
        code: 404
      });
    });
  });

  describe('request throttling', () => {
    it('should track request count', async () => {
      const client = new DriveClient(mockAuthClient);

      client.drive = {
        files: {
          list: jest.fn().mockResolvedValue({ data: { files: [] } })
        }
      };

      await client.listFiles();
      await client.listFiles();
      await client.listFiles();

      expect(client.getRequestCount()).toBe(3);
    });
  });
});
