import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type { Plugin, TransferPlan } from '../api/api.types';

/** The installed database plugins, asked once. The forms and pickers are drawn from these. */
@Injectable({ providedIn: 'root' })
export class PluginsService {
  private readonly http = inject(HttpClient);
  readonly resource = httpResource<Plugin[]>(() => apiUrl('/plugins'));

  readonly plugins = computed<readonly Plugin[]>(() =>
    this.resource.hasValue() ? this.resource.value() : [],
  );

  find(id: string): Plugin | undefined {
    return this.plugins().find((plugin) => plugin.id === id);
  }

  /** How data would travel from one plugin to another. */
  plan(source: string, target: string): Promise<TransferPlan> {
    return firstValueFrom(
      this.http.get<TransferPlan>(apiUrl('/plugins/transfer-plan'), {
        params: { source, target },
      }),
    );
  }
}
