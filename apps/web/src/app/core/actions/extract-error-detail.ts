import { apiErrorText, type ErrorText } from '../api/api-error';

/**
 * The reason of a failed HTTP call as a translatable text, appended to a failure toast: told
 * from the API's error **code** (`errors.api.<code>`) or, without a known code, from the HTTP
 * status. `undefined` for a failure that was no HTTP call.
 */
export function extractErrorDetail(error: unknown): ErrorText | undefined {
  return apiErrorText(error);
}
