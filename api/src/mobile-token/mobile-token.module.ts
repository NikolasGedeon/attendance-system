import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MobileTokenController } from './mobile-token.controller';
import { MobileTokenService } from './mobile-token.service';

@Module({
  imports: [PrismaModule],
  controllers: [MobileTokenController],
  providers: [MobileTokenService],
})
export class MobileTokenModule {}
