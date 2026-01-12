const logger = require('../utils/logger');

const JOB_TYPES = {
  FULL_SYNC: 'full_sync',
  INCREMENTAL_SYNC: 'incremental_sync',
  SYNC_PAGE: 'sync_page',
  DOWNLOAD_FILE: 'download_file'
};

function createSyncPageHandler(driveClient, fileRepository, checkpointRepository) {
  return async (payload, job) => {
    const { syncId, pageToken, filesProcessed = 0 } = payload;

    logger.debug('Processing sync page', { syncId, pageToken: pageToken?.substring(0, 20) });

    const response = await driveClient.listFiles({
      pageToken: pageToken || undefined
    });

    const files = response.data.files || [];

    if (files.length > 0) {
      fileRepository.upsertBatch(files);
    }

    const newTotal = filesProcessed + files.length;
    const checkpoint = checkpointRepository.findBySyncId(syncId);

    if (checkpoint) {
      checkpointRepository.updateProgress(
        checkpoint.id,
        response.data.nextPageToken || null,
        newTotal
      );
    }

    return {
      filesProcessed: files.length,
      totalProcessed: newTotal,
      hasMore: !!response.data.nextPageToken,
      nextPageToken: response.data.nextPageToken
    };
  };
}

function createFullSyncHandler(driveClient, fileRepository, checkpointRepository, jobRepository) {
  return async (payload, job) => {
    const { syncId } = payload;

    logger.info('Starting full sync', { syncId });

    let pageToken = null;
    let totalFiles = 0;
    let pageCount = 0;

    const checkpoint = checkpointRepository.findBySyncId(syncId);
    if (checkpoint && checkpoint.pageToken) {
      pageToken = checkpoint.pageToken;
      totalFiles = checkpoint.filesProcessed || 0;
      logger.info('Resuming sync from checkpoint', {
        syncId,
        filesProcessed: totalFiles
      });
    }

    do {
      const response = await driveClient.listFiles({
        pageToken: pageToken || undefined
      });

      const files = response.data.files || [];

      if (files.length > 0) {
        fileRepository.upsertBatch(files);
        totalFiles += files.length;
      }

      pageCount++;
      pageToken = response.data.nextPageToken;

      if (checkpoint) {
        checkpointRepository.updateProgress(checkpoint.id, pageToken, totalFiles);
      }

      logger.debug('Sync progress', {
        syncId,
        page: pageCount,
        filesInPage: files.length,
        totalFiles
      });

    } while (pageToken);

    if (checkpoint) {
      checkpointRepository.markCompleted(checkpoint.id, totalFiles);
    }

    logger.info('Full sync completed', { syncId, totalFiles, pages: pageCount });

    return { totalFiles, pages: pageCount };
  };
}

function createIncrementalSyncHandler(driveClient, fileRepository, checkpointRepository) {
  return async (payload, job) => {
    const { syncId, startPageToken } = payload;

    logger.info('Starting incremental sync', { syncId });

    let pageToken = startPageToken;
    let totalChanges = 0;
    let newStartToken = null;

    const checkpoint = checkpointRepository.findBySyncId(syncId);
    if (checkpoint && checkpoint.pageToken) {
      pageToken = checkpoint.pageToken;
      totalChanges = checkpoint.filesProcessed || 0;
    }

    do {
      const response = await driveClient.getChanges(pageToken);
      const changes = response.data.changes || [];

      for (const change of changes) {
        if (change.removed) {
          // file was deleted
          logger.debug('File removed', { fileId: change.fileId });
        } else if (change.file && !change.file.trashed) {
          fileRepository.upsert(change.file);
        }
        totalChanges++;
      }

      pageToken = response.data.nextPageToken;
      newStartToken = response.data.newStartPageToken;

      if (checkpoint) {
        checkpointRepository.updateProgress(checkpoint.id, pageToken || newStartToken, totalChanges);
      }

    } while (pageToken);

    if (checkpoint) {
      checkpointRepository.markCompleted(checkpoint.id, totalChanges);
    }

    logger.info('Incremental sync completed', { syncId, totalChanges });

    return { totalChanges, newStartPageToken: newStartToken };
  };
}

module.exports = {
  JOB_TYPES,
  createSyncPageHandler,
  createFullSyncHandler,
  createIncrementalSyncHandler
};
