import { Controller, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MobileTokenService } from './mobile-token.service';

@Controller('mobile-token')
@UseGuards(JwtAuthGuard)
export class MobileTokenController {
  constructor(private readonly mobileTokenService: MobileTokenService) {}

  /** Returns a fresh single-use token for the logged-in user. */
  @Post('generate')
  generate(@Request() req: { user: { id: string } }) {
    return this.mobileTokenService.generateToken(req.user.id);
  }
}
