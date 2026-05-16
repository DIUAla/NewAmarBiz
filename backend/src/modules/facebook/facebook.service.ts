// backend/src/modules/facebook/facebook.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import axios from 'axios';
import { FacebookPage } from '../../entities/facebook-page.entity';
import { FacebookComment, CommentStatus } from '../../entities/facebook-comment.entity';
import { Order } from '../../entities/order.entity';
import { OrderService } from '../order/order.service';

@Injectable()
export class FacebookService {
  private readonly FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

  constructor(
    @InjectRepository(FacebookPage)
    private facebookPageRepository: Repository<FacebookPage>,
    @InjectRepository(FacebookComment)
    private facebookCommentRepository: Repository<FacebookComment>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectQueue('facebook-sync')
    private facebookQueue: Queue,
    private orderService: OrderService,
  ) {}

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<any> {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    const response = await axios.get(`${this.FACEBOOK_GRAPH_API}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      },
    });

    return response.data;
  }

  async getLongLivedAccessToken(shortLivedToken: string): Promise<string> {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    const response = await axios.get(`${this.FACEBOOK_GRAPH_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedToken,
      },
    });

    return response.data.access_token;
  }

  async getUserPages(userId: string, accessToken: string): Promise<any[]> {
    const response = await axios.get(`${this.FACEBOOK_GRAPH_API}/me/accounts`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,category,cover,picture',
      },
    });

    const pages = response.data.data;

    // Save pages to database
    for (const page of pages) {
      await this.saveFacebookPage(userId, page, accessToken);
    }

    return pages;
  }

  async saveFacebookPage(userId: string, pageData: any, accessToken: string): Promise<FacebookPage> {
    let page = await this.facebookPageRepository.findOne({
      where: { facebookPageId: pageData.id, userId },
    });

    if (!page) {
      page = this.facebookPageRepository.create({
        facebookPageId: pageData.id,
        name: pageData.name,
        category: pageData.category,
        coverUrl: pageData.picture?.data?.url,
        userId,
        accessToken: accessToken,
        settings: {
          autoCreateOrders: true,
          autoReplyComments: false,
          replyTemplate: 'Thank you for your order! We will process it shortly.',
          keywords: ['buy', 'order', 'price', 'available', 'interested'],
        },
      });
    } else {
      page.name = pageData.name;
      page.category = pageData.category;
      page.accessToken = accessToken;
    }

    return await this.facebookPageRepository.save(page);
  }

  async syncPageComments(pageId: string, userId: string): Promise<{ synced: number; newComments: number }> {
    const page = await this.facebookPageRepository.findOne({
      where: { id: pageId, userId },
    });

    if (!page) {
      throw new NotFoundException('Facebook page not found');
    }

    // Get recent posts from the page
    const postsResponse = await axios.get(`${this.FACEBOOK_GRAPH_API}/${page.facebookPageId}/posts`, {
      params: {
        access_token: page.accessToken,
        fields: 'id,created_time,message',
        limit: 10,
      },
    });

    let totalNewComments = 0;
    let totalSynced = 0;

    for (const post of postsResponse.data.data) {
      const comments = await this.getPostComments(post.id, page.accessToken);
      
      for (const comment of comments) {
        const existingComment = await this.facebookCommentRepository.findOne({
          where: { facebookCommentId: comment.id },
        });

        if (!existingComment) {
          const newComment = await this.saveComment(page.id, post.id, comment);
          totalNewComments++;
          
          // Auto-create order if enabled and comment contains keywords
          if (page.settings.autoCreateOrders && this.shouldCreateOrder(comment.message, page.settings.keywords)) {
            await this.createOrderFromComment(newComment, userId, page);
          }
        }
        totalSynced++;
      }
    }

    // Update last sync time
    page.lastSyncAt = new Date();
    await this.facebookPageRepository.save(page);

    return { synced: totalSynced, newComments: totalNewComments };
  }

  async getPostComments(postId: string, accessToken: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.FACEBOOK_GRAPH_API}/${postId}/comments`, {
        params: {
          access_token: accessToken,
          fields: 'id,from,message,created_time,attachment,comments',
          order: 'reverse_chronological',
          limit: 50,
        },
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching comments:', error);
      return [];
    }
  }

  async saveComment(pageId: string, postId: string, commentData: any): Promise<FacebookComment> {
    const comment = this.facebookCommentRepository.create({
      facebookCommentId: commentData.id,
      facebookPostId: postId,
      fromName: commentData.from?.name || 'Unknown',
      fromId: commentData.from?.id,
      message: commentData.message,
      attachment: commentData.attachment ? {
        type: commentData.attachment.type,
        url: commentData.attachment.url,
      } : null,
      pageId,
      commentedAt: new Date(commentData.created_time),
      status: CommentStatus.PENDING,
    });

    // Extract order information from comment
    comment.extractedData = this.extractOrderInfo(commentData.message);
    
    return await this.facebookCommentRepository.save(comment);
  }

  extractOrderInfo(message: string): any {
    const extracted = {
      productName: null,
      quantity: 1,
      variant: null,
      phone: null,
      address: null,
      confidence: 0,
    };

    const lowerMessage = message.toLowerCase();

    // Extract product name (common patterns)
    const productPatterns = [
      /(?:order|want|need|buy)\s+(?:a|an|one)?\s+([^,.!?]+)/i,
      /([^,.!?]+)\s+(?:price|cost|how much)/i,
      /interested in\s+([^,.!?]+)/i,
    ];

    for (const pattern of productPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        extracted.productName = match[1].trim();
        extracted.confidence += 0.3;
        break;
      }
    }

    // Extract quantity
    const quantityMatch = message.match(/(\d+)\s*(?:pcs|piece|qty|quantity)/i);
    if (quantityMatch) {
      extracted.quantity = parseInt(quantityMatch[1]);
      extracted.confidence += 0.2;
    }

    // Extract phone number (Bangladeshi format)
    const phonePatterns = [
      /01[3-9]\d{8}/,
      /(\+8801[3-9]\d{8})/,
      /(8801[3-9]\d{8})/,
    ];

    for (const pattern of phonePatterns) {
      const match = message.match(pattern);
      if (match) {
        extracted.phone = match[0];
        extracted.confidence += 0.3;
        break;
      }
    }

    // Extract variant/color/size
    const variantPatterns = [
      /(?:color|colour)\s*:\s*(\w+)/i,
      /(?:size)\s*:\s*(\w+)/i,
      /(?:variant)\s*:\s*(\w+)/i,
    ];

    for (const pattern of variantPatterns) {
      const match = message.match(pattern);
      if (match) {
        extracted.variant = match[1];
        extracted.confidence += 0.2;
        break;
      }
    }

    extracted.confidence = Math.min(extracted.confidence, 1);

    return extracted;
  }

  shouldCreateOrder(message: string, keywords: string[]): boolean {
    const lowerMessage = message.toLowerCase();
    return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  }

  async createOrderFromComment(comment: FacebookComment, userId: string, page: FacebookPage): Promise<Order | null> {
    const extracted = comment.extractedData;
    
    if (extracted.confidence < 0.4) {
      comment.status = CommentStatus.IGNORED;
      await this.facebookCommentRepository.save(comment);
      return null;
    }

    try {
      // Find or create customer based on Facebook profile
      const orderData = {
        customer: {
          name: comment.fromName,
          phone: extracted.phone || 'Pending',
          address: extracted.address || 'Need to collect address',
          city: 'Dhaka',
          area: 'Unknown',
        },
        items: [
          {
            productId: 'temp',
            productName: extracted.productName || 'Product from Facebook',
            quantity: extracted.quantity || 1,
            price: 0, // Will be updated after product matching
            sku: 'FB-' + Date.now(),
          },
        ],
        totalAmount: 0,
        facebookCommentId: comment.facebookCommentId,
        facebookPostId: comment.facebookPostId,
      };

      // Try to match product in catalog
      const matchedProduct = await this.matchProductToComment(extracted.productName, userId);
      if (matchedProduct) {
        orderData.items[0].productId = matchedProduct.id;
        orderData.items[0].productName = matchedProduct.name;
        orderData.items[0].price = matchedProduct.price;
        orderData.totalAmount = matchedProduct.price * (extracted.quantity || 1);
        orderData.items[0].sku = matchedProduct.sku;
      }

      const order = await this.orderService.createOrder(userId, orderData);
      
      // Update comment with order reference
      comment.orderId = order.id;
      comment.status = CommentStatus.ORDER_CREATED;
      await this.facebookCommentRepository.save(comment);

      // Auto-reply if enabled
      if (page.settings.autoReplyComments) {
        await this.replyToComment(comment.facebookCommentId, page.accessToken, page.settings.replyTemplate);
      }

      return order;
    } catch (error) {
      console.error('Error creating order from comment:', error);
      comment.status = CommentStatus.PENDING;
      await this.facebookCommentRepository.save(comment);
      return null;
    }
  }

  async matchProductToComment(productName: string | null, userId: string): Promise<any | null> {
    if (!productName) return null;

    // Simple product matching - can be enhanced with NLP
    const products = await this.orderRepository
      .createQueryBuilder('order')
      .select('DISTINCT order.items')
      .where('order."userId" = :userId', { userId })
      .getRawMany();

    const allProducts = [];
    for (const row of products) {
      if (row.items && Array.isArray(row.items)) {
        allProducts.push(...row.items);
      }
    }

    const uniqueProducts = Array.from(new Map(allProducts.map(p => [p.productId, p])).values());
    
    // Fuzzy matching
    const searchTerm = productName.toLowerCase();
    const matchedProduct = uniqueProducts.find(p => 
      p.productName?.toLowerCase().includes(searchTerm) || 
      searchTerm.includes(p.productName?.toLowerCase())
    );

    return matchedProduct || null;
  }

  async replyToComment(commentId: string, accessToken: string, message: string): Promise<void> {
    try {
      await axios.post(`${this.FACEBOOK_GRAPH_API}/${commentId}/comments`, {
        access_token: accessToken,
        message: message,
      });
    } catch (error) {
      console.error('Error replying to comment:', error);
    }
  }

  async getUnprocessedComments(pageId: string, userId: string): Promise<FacebookComment[]> {
    return await this.facebookCommentRepository.find({
      where: {
        pageId,
        status: CommentStatus.PENDING,
      },
      relations: ['page'],
      order: { commentedAt: 'ASC' },
    });
  }

  async processCommentManually(commentId: string, userId: string, action: 'create_order' | 'ignore'): Promise<FacebookComment> {
    const comment = await this.facebookCommentRepository.findOne({
      where: { id: commentId },
      relations: ['page'],
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (action === 'create_order') {
      const order = await this.createOrderFromComment(comment, userId, comment.page);
      if (order) {
        comment.status = CommentStatus.ORDER_CREATED;
        comment.orderId = order.id;
      }
    } else {
      comment.status = CommentStatus.IGNORED;
    }

    await this.facebookCommentRepository.save(comment);
    return comment;
  }

  async startAutoSync(pageId: string, userId: string, intervalMinutes: number = 15): Promise<void> {
    const page = await this.facebookPageRepository.findOne({
      where: { id: pageId, userId },
    });

    if (!page) {
      throw new NotFoundException('Facebook page not found');
    }

    // Add recurring job to queue
    await this.facebookQueue.add(
      'sync-page',
      { pageId, userId },
      {
        repeat: { every: intervalMinutes * 60 * 1000 },
        jobId: `sync-${pageId}`,
      },
    );
  }

  async stopAutoSync(pageId: string): Promise<void> {
    const job = await this.facebookQueue.getRepeatableJobs();
    const syncJob = job.find(j => j.id === `sync-${pageId}`);
    if (syncJob) {
      await this.facebookQueue.removeRepeatableByKey(syncJob.key);
    }
  }

  async getCommentAnalytics(pageId: string, userId: string, days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const comments = await this.facebookCommentRepository.find({
      where: {
        pageId,
        commentedAt: MoreThan(startDate),
      },
      relations: ['order'],
    });

    const totalComments = comments.length;
    const convertedOrders = comments.filter(c => c.status === CommentStatus.ORDER_CREATED).length;
    const conversionRate = totalComments > 0 ? (convertedOrders / totalComments) * 100 : 0;

    // Daily comment count
    const dailyComments: { [key: string]: number } = {};
    comments.forEach(comment => {
      const date = comment.commentedAt.toISOString().split('T')[0];
      dailyComments[date] = (dailyComments[date] || 0) + 1;
    });

    // Top customers by comments
    const customerComments: { [key: string]: { name: string; count: number; orders: number } } = {};
    comments.forEach(comment => {
      if (!customerComments[comment.fromId]) {
        customerComments[comment.fromId] = {
          name: comment.fromName,
          count: 0,
          orders: 0,
        };
      }
      customerComments[comment.fromId].count++;
      if (comment.status === CommentStatus.ORDER_CREATED) {
        customerComments[comment.fromId].orders++;
      }
    });

    const topCustomers = Object.entries(customerComments)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      summary: {
        totalComments,
        convertedOrders,
        conversionRate: conversionRate.toFixed(2),
        averageDailyComments: (totalComments / days).toFixed(1),
      },
      dailyComments,
      topCustomers,
      autoCreateEnabled: comments[0]?.page?.settings?.autoCreateOrders || false,
    };
  }
}
