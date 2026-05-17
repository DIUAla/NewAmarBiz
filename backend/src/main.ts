import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  
  app.getHttpAdapter().get('/health', (req, res) => {
    res.send({ status: 'ok', message: 'API is working!' });
  });
  
  await app.listen(3000);
  console.log('Backend running');
}

bootstrap();
