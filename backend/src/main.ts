import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  
  app.getHttpAdapter().get('/health', (req, res) => {
    res.send({ status: 'ok', message: 'F-Commerce API is running!' });
  });
  
  await app.listen(process.env.PORT || 3000);
  console.log(`Backend running on port ${process.env.PORT || 3000}`);
}

bootstrap();
