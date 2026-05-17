import { Controller, Post, Get, Delete, Param, Body, UseGuards, Req, Query } from '@nestjs/common';
import { FacebookService } from './facebook.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('facebook')
@UseGuards(JwtAuthGuard)
export class FacebookController {
  constructor(private readonly facebookService: FacebookService) {}

  @Get('auth-url')
  getAuthUrl(@Query('redirectUri') redirectUri: string) {
    const appId = process.env.FACEBOOK_APP_ID;
    const redirectUri_ = redirectUri || `${process.env.FRONTEND_URL}/facebook/callback`;
    
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri_)}&scope=pages_manage_posts,pages_read_engagement,pages_manage_metadata&response_type=code`;
    
    return { authUrl };
  }

  @Post('callback')
  async handleCallback(@Body() body: { code: string; redirectUri: string }) {
    const tokenData = await this.facebookService.exchangeCodeForToken(body.code, body.redirectUri);
    return tokenData;
  }

  @Get('pages')
  async getUserPages(@Req() req: any, @Query('accessToken') accessToken: string) {
    const pages = await this.facebookService.getUserPages(req.user.id, accessToken);
    return { pages };
  }

  @Post('pages/:pageId/sync')
  async syncPageComments(@Req() req: any, @Param('pageId') pageId: string) {
    const result = await this.facebookService.syncPageComments(pageId, req.user.id);
    return result;
  }

  @Get('pages/:pageId/comments')
  async getUnprocessedComments(@Req() req: any, @Param('pageId') pageId: string) {
    const comments = await this.facebookService.getUnprocessedComments(pageId, req.user.id);
    return { comments };
  }

  @Post('comments/:commentId/process')
  async processComment(@Req() req: any, @Param('commentId') commentId: string, @Body() body: { action: 'create_order' | 'ignore' }) {
    const comment = await this.facebookService.processCommentManually(commentId, req.user.id, body.action);
    return { comment };
  }

  @Post('pages/:pageId/auto-sync')
  async startAutoSync(@Req() req: any, @Param('pageId') pageId: string, @Body() body: { intervalMinutes?: number }) {
    await this.facebookService.startAutoSync(pageId, req.user.id, body.intervalMinutes);
    return { message: 'Auto-sync started', interval: body.intervalMinutes || 15 };
  }

  @Delete('pages/:pageId/auto-sync')
  async stopAutoSync(@Req() req: any, @Param('pageId') pageId: string) {
    await this.facebookService.stopAutoSync(pageId);
    return { message: 'Auto-sync stopped' };
  }

  @Get('pages/:pageId/analytics')
  async getAnalytics(@Req() req: any, @Param('pageId') pageId: string, @Query('days') days?: string) {
    const analytics = await this.facebookService.getCommentAnalytics(pageId, req.user.id, days ? parseInt(days) : 30);
    return analytics;
  }
}
