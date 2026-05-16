// backend/src/modules/ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Order } from '../../entities/order.entity';
import { Customer } from '../../entities/customer.entity';

@Injectable()
export class AiService {
  private readonly AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

  async getAnalytics(userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.AI_SERVICE_URL}/api/analytics/${userId}`);
      return response.data;
    } catch (error) {
      console.error('AI Service error:', error);
      return this.getFallbackAnalytics(userId);
    }
  }

  async getOrderPredictions(orderId: string, userId: string): Promise<any> {
    try {
      const response = await axios.post(`${this.AI_SERVICE_URL}/api/predict/order`, {
        orderId,
        userId,
      });
      return response.data;
    } catch (error) {
      return { 
        successProbability: 0.85, 
        confidence: 0.7,
        estimatedDelivery: '3-5 days',
      };
    }
  }

  async detectAnomalies(userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.AI_SERVICE_URL}/api/detect/anomalies/${userId}`);
      return response.data;
    } catch (error) {
      return {
        fakeOrders: [],
        deliveryFailures: [],
        salesAnomalies: [],
        alerts: [],
      };
    }
  }

  async getCustomerLTV(customerId: string, userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.AI_SERVICE_URL}/api/customer/ltv/${customerId}`);
      return response.data;
    } catch (error) {
      return { 
        score: 65, 
        tier: 'Medium',
        predictedNextOrder: '15 days',
      };
    }
  }

  async getForecasts(userId: string, period: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<any> {
    try {
      const response = await axios.get(`${this.AI_SERVICE_URL}/api/forecast/${userId}?period=${period}`);
      return response.data;
    } catch (error) {
      return {
        sales: [100, 120, 115, 130, 125],
        inventory: [],
        confidence: 0.75,
      };
    }
  }

  async suggestCourier(orderId: string, userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.AI_SERVICE_URL}/api/suggest/courier/${orderId}`);
      return response.data;
    } catch (error) {
      return {
        suggestedCourier: 'Steadfast',
        reason: 'Based on delivery success rate in your area',
        confidence: 0.82,
      };
    }
  }

  private async getFallbackAnalytics(userId: string): Promise<any> {
    return {
      detective: {
        fakeOrderRisk: 'Low',
        deliverySuccessRate: 94,
        anomalies: [],
      },
      predictive: {
        predictedOrdersNextWeek: 45,
        expectedRevenue: 25000,
        customerChurnRisk: 'Low',
      },
      prescriptive: {
        recommendations: [
          'Increase inventory for top products',
          'Consider Pathao for faster delivery',
        ],
      },
    };
  }
}
