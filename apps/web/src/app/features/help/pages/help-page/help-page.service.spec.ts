import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { HELP_SECTIONS } from '../../help-content';
import { HelpPageService, matches, normalise } from './help-page.service';

describe('search helpers', () => {
  it('ignores case and accents', () => {
    expect(normalise('Prüfung')).toBe('prufung');
    expect(matches('Gespeicherte Verbindungen', 'verbindung gespeich')).toBe(
      true,
    );
  });

  it('needs every word', () => {
    expect(matches('copy a database', 'copy docker')).toBe(false);
  });
});

describe('HelpPageService', () => {
  function setup(): HelpPageService {
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), HelpPageService],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      help: {
        sections: Object.fromEntries(
          HELP_SECTIONS.map((s) => [
            s.id,
            {
              title: s.id === 'log' ? 'Read the log' : 'Other',
              purpose: 'x',
              steps: {},
              tips: {},
            },
          ]),
        ),
        faq: { items: {} },
      },
    });
    translate.use('en');
    return TestBed.inject(HelpPageService);
  }

  it('numbers the sections in order', () => {
    const numbers = setup()
      .sections()
      .map((s) => s.number);
    expect(numbers).toEqual(HELP_SECTIONS.map((_, i) => i + 1));
  });

  it('narrows the guide to what matches the search', () => {
    const service = setup();
    service.query.set('read the log');
    expect(service.visibleSections().map((s) => s.id)).toEqual(['log']);
    service.query.set('');
    expect(service.visibleSections()).toHaveLength(HELP_SECTIONS.length);
  });
});
