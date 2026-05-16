// backend/src/entities/facebook-page.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { FacebookComment } from './facebook-comment.entity';

@Entity('facebook_pages')
export class FacebookPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  facebookPageId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  accessToken: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  coverUrl: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  settings: {
    autoCreateOrders: boolean;
    autoReplyComments: boolean;
    replyTemplate: string;
    keywords: string[];
  };

  @ManyToOne(() => User, user => user.facebookPages)
  user: User;

  @Column()
  userId: string;

  @OneToMany(() => FacebookComment, comment => comment.page)
  comments: FacebookComment[];

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
