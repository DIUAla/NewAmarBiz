// backend/src/workers/facebook-sync.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { FacebookService } from '../modules/facebook/facebook.service';

@Processor('facebook-sync')
export class FacebookSyncProcessor {
  constructor(private readonly facebookService: FacebookService) {}

  @Process('sync-page')
  async handlePageSync(job: Job<{ pageId: string; userId: string }>) {
    const { pageId, userId } = job.data;
    console.log(`Syncing Facebook page ${pageId} for user ${userId}`);
    
    try {
      const result = await this.facebookService.syncPageComments(pageId, userId);
      console.log(`Sync completed: ${result.newComments} new comments, ${result.synced} total synced`);
      return result;
    } catch (error) {
      console.error(`Error syncing page ${pageId}:`, error);
      throw error;
    }
  }
}
