import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideCircleCheck,
  lucideLoaderCircle,
} from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmDialogImports } from '@mirrorbase/ui/dialog';
import { HlmInputImports } from '@mirrorbase/ui/input';
import { HlmLabelImports } from '@mirrorbase/ui/label';
import { apiErrorCode } from '../../../core/api/api-error';
import type {
  Connection,
  FieldValue,
  Plugin,
  TestResult,
} from '../../../core/api/api.types';
import { ConnectionsService } from '../../../core/connections/connections.service';
import { PluginsService } from '../../../core/plugins/plugins.service';
import { zodValidator } from '../../forms/zod-validator';
import { LocalizedPipe } from '../../plugins/localized.pipe';
import {
  initialValues,
  pluginFormSchema,
  toPayload,
} from '../../plugins/plugin-schema';
import { PluginFields } from '../plugin-fields';

/** What a "new connection" starts from, e.g. a Docker container the person picked. */
export interface ConnectionPrefill {
  readonly pluginId: string;
  readonly name: string;
  readonly config: Readonly<Record<string, FieldValue>>;
  readonly dockerName?: string;
}

/**
 * Create or edit a saved connection. Pick a database type (a plugin), fill in the form the
 * plugin declares, test it, save. A password left blank keeps the saved one; "forget" removes it.
 * Used by the Connections page and, to add one on the spot, by the Replicate page.
 */
@Component({
  selector: 'mb-connection-dialog',
  imports: [
    NgIcon,
    ReactiveFormsModule,
    TranslatePipe,
    LocalizedPipe,
    PluginFields,
    ...HlmButtonImports,
    ...HlmDialogImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [
    provideIcons({ lucideCircleAlert, lucideCircleCheck, lucideLoaderCircle }),
  ],
  templateUrl: './connection-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionDialog {
  private readonly connections = inject(ConnectionsService);
  protected readonly plugins = inject(PluginsService);

  readonly open = input(false);
  /** Edit this connection (its type cannot change). */
  readonly connection = input<Connection | null>(null);
  /** Start a new connection from these values. */
  readonly prefill = input<ConnectionPrefill | null>(null);

  readonly closed = output<void>();
  readonly saved = output<Connection>();

  protected readonly pluginId = signal('');
  protected readonly plugin = computed<Plugin | undefined>(() =>
    this.plugins.find(this.pluginId()),
  );
  protected readonly editing = computed(() => this.connection() !== null);
  protected readonly savedSecrets = computed(
    () => this.connection()?.secretKeys ?? [],
  );
  protected readonly forgotten = signal<readonly string[]>([]);
  protected readonly form = signal<FormGroup>(new FormGroup({}));
  protected readonly busy = signal(false);
  protected readonly testing = signal(false);
  protected readonly testRole = signal<'source' | 'target'>('source');
  protected readonly testResult = signal<TestResult | null>(null);
  protected readonly testFailed = signal(false);
  /** Ties the footer's Save button to the form above it. */
  protected readonly formId = 'mb-connection-form';

  protected readonly state = computed<'open' | 'closed'>(() =>
    this.open() ? 'open' : 'closed',
  );
  protected readonly selectable = computed(() => this.plugins.plugins());
  protected readonly testMessageKey = computed(() => {
    const code = this.testResult()?.code;
    return code ? `errors.api.${code}` : null;
  });

  constructor() {
    // (Re)start the form whenever the dialog opens or the database type changes.
    effect(() => {
      if (!this.open()) return;
      const existing = this.connection();
      const prefill = this.prefill();
      const available = this.plugins.plugins();
      untracked(() => {
        const wanted =
          existing?.pluginId ?? prefill?.pluginId ?? this.pluginId();
        const pluginId =
          available.find((p) => p.id === wanted)?.id ?? available[0]?.id ?? '';
        this.pluginId.set(pluginId);
        this.rebuild(existing, prefill);
      });
    });
  }

  protected choosePlugin(id: string): void {
    this.pluginId.set(id);
    this.rebuild(null, null);
  }

  protected forget(key: string): void {
    this.forgotten.update((keys) => [...keys, key]);
    this.rebuild(this.connection(), this.prefill(), true);
  }

  private rebuild(
    existing: Connection | null,
    prefill: ConnectionPrefill | null,
    keepValues = false,
  ): void {
    const plugin = this.plugin();
    if (!plugin) {
      this.form.set(new FormGroup({}));
      return;
    }
    if (!keepValues) {
      this.forgotten.set([]);
      this.testResult.set(null);
      this.testFailed.set(false);
    }
    const sameType = existing?.pluginId === plugin.id ? existing : null;
    const fromPrefill = prefill?.pluginId === plugin.id ? prefill : null;
    const previous = keepValues ? this.form().getRawValue() : null;
    const values =
      previous ??
      initialValues(
        plugin.fields,
        sameType?.config ?? fromPrefill?.config ?? {},
        sameType?.name ?? fromPrefill?.name ?? '',
      );
    const controls = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        new FormControl(value, { nonNullable: true }),
      ]),
    );
    this.form.set(
      new FormGroup(controls, {
        validators: zodValidator(
          pluginFormSchema(plugin.fields, {
            savedSecrets: this.savedSecrets().filter(
              (key) => !this.forgotten().includes(key),
            ),
          }),
        ),
      }),
    );
  }

  protected async test(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin) return;
    this.form().markAllAsTouched();
    if (this.form().invalid) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.testFailed.set(false);
    const savedId = this.connection()?.id;
    try {
      const { config, secrets } = toPayload(
        plugin.fields,
        this.form().getRawValue(),
      );
      this.testResult.set(
        await this.connections.test({
          pluginId: plugin.id,
          config,
          secrets,
          role: this.testRole(),
          ...(savedId && !this.forgotten().length
            ? { connectionId: savedId }
            : {}),
        }),
      );
    } catch (error) {
      this.testFailed.set(true);
      const code = apiErrorCode(error);
      this.testResult.set({ ok: false, ...(code ? { code } : {}) });
    } finally {
      this.testing.set(false);
    }
  }

  protected async save(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin) return;
    const form = this.form();
    form.markAllAsTouched();
    if (form.invalid) return;
    this.busy.set(true);
    try {
      const raw = form.getRawValue() as Record<string, unknown>;
      const { config, secrets } = toPayload(plugin.fields, raw);
      const name = String(raw['name'] ?? '').trim();
      const existing = this.connection();
      const dockerName = this.prefill()?.dockerName;
      const result = existing
        ? await this.connections.update(existing.id, {
            name,
            config,
            secrets,
            clearSecrets: this.forgotten().filter((key) => !(key in secrets)),
          })
        : await this.connections.create({
            name,
            pluginId: plugin.id,
            config,
            secrets,
            ...(dockerName ? { dockerName } : {}),
          });
      this.saved.emit(result);
    } catch {
      // The ActionRunner already told the person why (a taken name, a missing key, …).
    } finally {
      this.busy.set(false);
    }
  }

  protected onStateChanged(state: 'open' | 'closed'): void {
    if (state === 'closed' && this.open()) this.closed.emit();
  }
}
