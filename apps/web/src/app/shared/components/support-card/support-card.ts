import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCoffee } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { SUPPORT_URL } from '../../../core/support';

/** A short thank-you note with the "Buy me a coffee" link. */
@Component({
  selector: 'mb-support-card',
  imports: [NgIcon, TranslatePipe, ...HlmButtonImports],
  providers: [provideIcons({ lucideCoffee })],
  template: `
    <section
      class="mb-panel flex flex-wrap items-center gap-4 p-4"
      aria-labelledby="mb-support-title"
    >
      <div class="min-w-0 flex-1">
        <h2 id="mb-support-title" class="font-semibold">
          {{ 'support.title' | translate }}
        </h2>
        <p class="text-muted-foreground text-sm">
          {{ 'support.text' | translate }}
        </p>
      </div>
      <a
        hlmBtn
        variant="outline"
        data-support-link
        target="_blank"
        rel="noopener noreferrer"
        [href]="url"
      >
        <ng-icon name="lucideCoffee" size="16" aria-hidden="true" />
        {{ 'support.button' | translate }}
      </a>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportCard {
  protected readonly url = SUPPORT_URL;
}
