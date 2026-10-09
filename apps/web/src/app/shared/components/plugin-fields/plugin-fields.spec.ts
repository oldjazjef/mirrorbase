import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideTranslateService } from '@ngx-translate/core';
import type { FieldDescriptor } from '../../../core/api/api.types';
import { zodValidator } from '../../forms/zod-validator';
import { initialValues, pluginFormSchema } from '../../plugins/plugin-schema';
import { PluginFields } from './plugin-fields';

/**
 * A plugin the web app has never heard of. If its form renders and validates, a new database type
 * needs no change in the web app - the promise of the plugin design.
 */
const MADE_UP: FieldDescriptor[] = [
  {
    key: 'endpoint',
    type: 'text',
    label: { en: 'Endpoint URL' },
    required: true,
    help: { en: 'Where it lives' },
  },
  {
    key: 'timeout',
    type: 'number',
    label: { en: 'Timeout' },
    default: 30,
    min: 1,
    max: 300,
  },
  {
    key: 'token',
    type: 'password',
    secret: true,
    label: { en: 'API token' },
    required: true,
  },
  {
    key: 'region',
    type: 'select',
    label: { en: 'Region' },
    options: [
      { value: 'eu', label: { en: 'Europe' } },
      { value: 'us', label: { en: 'United States' } },
    ],
  },
  { key: 'tls', type: 'boolean', label: { en: 'Use TLS' } },
  {
    key: 'cacheDir',
    type: 'path',
    label: { en: 'Cache folder' },
    advanced: true,
  },
];

@Component({
  imports: [PluginFields],
  template: `<mb-plugin-fields
    [fields]="fields"
    [form]="form()"
    [savedSecrets]="saved()"
    [forgotten]="forgotten()"
    (forget)="forgot = $event"
  />`,
})
class Host {
  fields = MADE_UP;
  saved = signal<string[]>([]);
  forgotten = signal<string[]>([]);
  forgot = '';
  form = signal(build([]));
}

function build(savedSecrets: string[]): FormGroup {
  const values = initialValues(MADE_UP, {}, 'x');
  delete (values as Record<string, unknown>)['name'];
  return new FormGroup(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        new FormControl(value, { nonNullable: true }),
      ]),
    ),
    {
      validators: zodValidator(
        pluginFormSchema(MADE_UP, { savedSecrets }).omit({ name: true }),
      ),
    },
  );
}

function render() {
  TestBed.configureTestingModule({ providers: [provideTranslateService()] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

describe('PluginFields', () => {
  it('draws a control for every declared type, labelled, without knowing the plugin', () => {
    const { el } = render();
    const labels = [...el.querySelectorAll('label')].map((l) =>
      l.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        'Endpoint URL *',
        'Timeout',
        'API token *',
        'Region',
        'Use TLS',
      ]),
    );
    expect(
      el.querySelector('input#mb-field-endpoint')?.getAttribute('type'),
    ).toBe('text');
    expect(el.querySelector('input#mb-field-token')?.getAttribute('type')).toBe(
      'password',
    );
    expect(
      el.querySelector('input#mb-field-token')?.getAttribute('autocomplete'),
    ).toBe('new-password');
    expect(el.querySelector('input#mb-field-tls')?.getAttribute('type')).toBe(
      'checkbox',
    );
    expect(el.querySelector('select#mb-field-region')).not.toBeNull();
    expect(
      [...el.querySelectorAll('select#mb-field-region option')].map((o) =>
        o.textContent?.trim(),
      ),
    ).toEqual(['connections.form.selectDefault', 'Europe', 'United States']);
    expect(el.textContent).toContain('Where it lives');
  });

  it('shows a default as the placeholder', () => {
    const { el } = render();
    expect(
      el.querySelector('input#mb-field-timeout')?.getAttribute('placeholder'),
    ).toBe('30');
  });

  it('keeps advanced fields behind a disclosure', () => {
    const { fixture, el } = render();
    expect(el.querySelector('#mb-field-cacheDir')).toBeNull();
    (
      el.querySelector(
        'button[aria-controls="mb-advanced-fields"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(el.querySelector('#mb-field-cacheDir')).not.toBeNull();
  });

  it('shows the Zod message under a field once it was touched', () => {
    const { fixture, host, el } = render();
    host.form().controls['endpoint']?.markAsTouched();
    host.form().updateValueAndValidity();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'validation.required',
    );
  });

  it('offers to forget a saved password and says so once forgotten', () => {
    const { fixture, host, el } = render();
    host.saved.set(['token']);
    host.form.set(build(['token']));
    fixture.detectChanges();
    expect(
      el.querySelector('input#mb-field-token')?.getAttribute('placeholder'),
    ).toBe('connections.form.passwordKept');
    (el.querySelector('button[class*="px-0"]') as HTMLButtonElement).click();
    expect(host.forgot).toBe('token');
    host.forgotten.set(['token']);
    fixture.detectChanges();
    expect(el.textContent).toContain('connections.form.passwordForgotten');
  });
});
