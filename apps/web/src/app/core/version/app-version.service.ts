import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { apiUrl } from '../api/api-url';
import type { VersionInfo } from '../api/api.types';

/** The build the API reports (`X.Y.Z+<commit>`); null until known or when it cannot be asked. */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  readonly info = toSignal(
    inject(HttpClient)
      .get<VersionInfo>(apiUrl('/version'))
      .pipe(catchError(() => of(null))),
    { initialValue: null },
  );
}
