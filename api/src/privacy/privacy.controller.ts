import { Controller, Get, Header } from '@nestjs/common';
import { PRIVACY_POLICY_HTML } from './privacy.page';

/**
 * Public privacy policy page.
 *
 * The controller intentionally declares NO guard. This backend applies JWT
 * auth per-controller (`@UseGuards(JwtAuthGuard)`) — there is no global auth
 * guard — so a guard-free controller is public by default and no opt-out
 * decorator is needed. There is also no global route prefix, so this resolves
 * at exactly `/privacy` (never `/api/privacy`). The HTML is bundled as a string
 * (no filesystem read, no build-time asset copy) so it is served reliably in
 * every environment, including the Azure zip deployment.
 */
@Controller()
export class PrivacyController {
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  getPrivacyPolicy(): string {
    return PRIVACY_POLICY_HTML;
  }
}
