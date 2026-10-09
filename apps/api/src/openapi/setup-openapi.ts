import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { Env } from '../config/env';
import { UNLOCK_SCHEME } from './security-schemes';

/** Machine-readable document. Also the input for generating frontend API types. */
export const OPENAPI_JSON_PATH = 'api/openapi.json';

/** Interactive reference, rendered by Scalar. */
export const OPENAPI_REFERENCE_PATH = 'api/reference';

interface JsonResponse {
  json(body: unknown): unknown;
}

/**
 * Builds the OpenAPI document and serves it as JSON and as the Scalar reference. No Swagger UI.
 *
 * There is no login: every data request carries the unlock token the PIN lock hands out
 * (`POST /api/pin/unlock`), sent in the `x-dbreplicator-unlock` header.
 */
export function setupOpenApi(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('DB Replicator API')
      .setDescription(
        [
          'Copy databases between servers: saved connections, database plugins, runs and their log.',
          '',
          'Every data request needs the unlock token from `POST /api/pin/unlock` in `x-dbreplicator-unlock`.',
          'Passwords are never returned.',
        ].join('\n'),
      )
      .setVersion('0.1.0')
      .addServer(config.get('PUBLIC_API_URL', { infer: true }))
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'x-dbreplicator-unlock',
          description: 'The unlock token returned by `POST /api/pin/unlock`.',
        },
        UNLOCK_SCHEME,
      )
      .build(),
    {
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey}_${methodKey}`,
    },
  );

  app.use(`/${OPENAPI_JSON_PATH}`, (_req: unknown, res: JsonResponse) => {
    res.json(document);
  });

  app.use(
    `/${OPENAPI_REFERENCE_PATH}`,
    apiReference({
      // Scalar renders client-side from jsDelivr; set `cdn` to a self-hosted copy if blocked.
      url: `/${OPENAPI_JSON_PATH}`,
      pageTitle: 'DB Replicator API',
      authentication: { preferredSecurityScheme: UNLOCK_SCHEME },
    }),
  );
}
