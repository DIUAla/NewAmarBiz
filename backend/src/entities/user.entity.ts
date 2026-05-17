// backend/src/entities/user.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { Order } from './order.entity';
import { Customer } from './customer.entity';
import { Product } from './product.entity';

export enum UserRole {
  ADMIN = 'admin',
  STAFF = 'staff',
  USER = 'user',
}

export enum SubscriptionPlan {
  FREE = 'free',
  BASIC = 'basic',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column()
  name: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'enum', enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  subscriptionPlan: SubscriptionPlan;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  monthlyOrderLimit: number;

  @Column({ default: 0 })
  ordersThisMonth: number;

  @Column({ type: 'jsonb', nullable: true })
  settings: {
    language: string;
    currency: string;
    notifications: boolean;
  };

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  subscriptionExpiresAt: Date;

  @OneToMany(() => Order, order => order.user)
  orders: Order[];

  @OneToMany(() => Customer, customer => customer.user)
  customers: Customer[];

  @OneToMany(() => Product, product => product.user)
  products: Product[];

  @OneToMany(() => FacebookPage, page => page.user)
facebookPages: FacebookPage[];
}
