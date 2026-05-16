// backend/src/modules/dashboard/dashboard.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { Customer } from '../../entities/customer.entity';
import { Product } from '../../entities/product.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

  async getDashboardData(userId: string, dateRange?: { start: Date; end: Date }): Promise<any> {
    const now = new Date();
    const startDate = dateRange?.start || new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = dateRange?.end || now;

    const orders = await this.orderRepository.find({
      where: {
        userId,
        createdAt: Between(startDate, endDate),
      },
    });

    const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === OrderStatus.PENDING).length;
    const deliveredOrders = orders.filter(o => o.status === OrderStatus.DELIVERED).length;
    const cancelledOrders = orders.filter(o => o.status === OrderStatus.CANCELLED).length;

    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Daily sales for chart
    const dailySales = this.getDailySales(orders, startDate, endDate);

    // Top products
    const productSales = new Map();
    orders.forEach(order => {
      order.items.forEach(item => {
        const current = productSales.get(item.productId) || { name: item.productName, quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.price * item.quantity;
        productSales.set(item.productId, current);
      });
    });
    const topProducts = Array.from(productSales.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Customer stats
    const totalCustomers = await this.customerRepository.count({ where: { userId } });
    const repeatCustomers = await this.customerRepository.count({
      where: { userId, totalOrders: MoreThan(1) },
    });

    return {
      summary: {
        totalRevenue,
        totalOrders,
        pendingOrders,
        deliveredOrders,
        cancelledOrders,
        averageOrderValue,
        totalCustomers,
        repeatCustomers,
        repeatRate: totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0,
      },
      charts: {
        dailySales,
        topProducts,
      },
      recentOrders: orders.slice(0, 10),
    };
  }

  private getDailySales(orders: Order[], startDate: Date, endDate: Date): Array<{ date: string; revenue: number; count: number }> {
    const dailyMap = new Map();
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dailyMap.set(dateStr, { revenue: 0, count: 0 });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    orders.forEach(order => {
      const dateStr = order.createdAt.toISOString().split('T')[0];
      const existing = dailyMap.get(dateStr);
      if (existing) {
        existing.revenue += order.totalAmount;
        existing.count += 1;
        dailyMap.set(dateStr, existing);
      }
    });

    return Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data }));
  }
}
