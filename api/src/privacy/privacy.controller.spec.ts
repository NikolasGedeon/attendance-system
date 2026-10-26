import { PrivacyController } from './privacy.controller';

describe('PrivacyController', () => {
  const controller = new PrivacyController();

  it('serves a self-contained HTML privacy policy', () => {
    const html = controller.getPrivacyPolicy();
    expect(typeof html).toBe('string');
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(
      true,
    );
    expect(html).toContain('Marfields Attendance Privacy Policy');
    expect(html).toContain('Marfields Enterprises Ltd');
    expect(html).toContain('info@marfields.com');
    expect(html).toContain('31 July 2026');
  });

  it('includes the key required disclosures', () => {
    const html = controller.getPrivacyPolicy();
    expect(html).toContain('does not continuously track');
    expect(html).toContain('International data processing');
    expect(html).toContain('Children');
    expect(html).toContain('Microsoft Azure');
  });

  it('contains no external scripts or invented data', () => {
    const html = controller.getPrivacyPolicy();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('HE74913'); // invented reg. number removed
    expect(html).not.toContain('Waywin Plaza'); // invented address removed
  });
});
